import { Browser, BrowserContext, chromium, Page } from 'playwright';

export interface ExpiryResult {
  isExpired: boolean;
  isLoading?: boolean;
  reason?: string;
  finalUrl: string;
}

interface PersistentSession {
  context: BrowserContext;
  page: Page;
}

export class BrowserService {
  private browser: Browser | null = null;
  private sessions: Map<string, PersistentSession> = new Map();

  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true
      });
    }
  }

  async getOrCreateSession(targetId: string, cookiesJson: string, url: string): Promise<PersistentSession> {
    if (this.sessions.has(targetId)) {
      const existingSession = this.sessions.get(targetId)!;
      // Recreate if context/page crashed or closed
      if (!existingSession.page.isClosed()) {
        return existingSession;
      }
      this.sessions.delete(targetId);
    }

    if (!this.browser) await this.init();

    const rawCookies = JSON.parse(cookiesJson);
    const validSameSite = ['Strict', 'Lax', 'None'];
    const cookies = rawCookies.map((c: any) => {
      let sameSite = c.sameSite;
      if (sameSite) {
        sameSite = sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase();
      }
      if (!validSameSite.includes(sameSite)) {
        sameSite = 'Lax';
      }
      return { ...c, sameSite };
    });

    const context = await this.browser!.newContext({
      storageState: { cookies, origins: [] },
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    // Initial navigation
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const session = { context, page };
    this.sessions.set(targetId, session);
    return session;
  }

  async takeScreenshot(targetId: string, url: string, cookiesJson: string): Promise<{ image: string; error?: string }> {
    try {
      const session = await this.getOrCreateSession(targetId, cookiesJson, url);

      // Wait a bit to ensure UI is ready (if it's a new or currently rendering page)
      await session.page.waitForTimeout(1000);

      const image = (await session.page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
      return { image };
    } catch (error: any) {
      return { image: '', error: error.message };
    }
  }

  async checkSession(targetId: string, url: string, cookiesJson: string, forceReload: boolean = false): Promise<ExpiryResult> {
    try {
      const session = await this.getOrCreateSession(targetId, cookiesJson, url);

      if (forceReload) {
        await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await session.page.waitForTimeout(5000); // Grace period after reload
      } else {
        // Just let it sit or wait briefly to evaluate current state
        await session.page.waitForTimeout(1000);
      }

      const finalUrl = session.page.url();
      let urlObj;
      try {
        urlObj = new URL(finalUrl);
      } catch (e) {
        urlObj = { pathname: finalUrl };
      }

      const loginPaths = ['/login', '/signin', '/auth/login', 'login.php', 'signin.php'];
      const isRedirectedToLogin = loginPaths.some(p =>
        urlObj.pathname.toLowerCase().endsWith(p) ||
        urlObj.pathname.toLowerCase().endsWith(p + '/')
      );

      if (isRedirectedToLogin) {
        return { isExpired: true, reason: `Redirected to login: ${finalUrl}`, finalUrl };
      }

      const bodyText = await session.page.innerText('body');
      const expiryTextPatterns = ['Session expired', 'Please log in', 'Your session has timed out', 'Please sign in'];
      const hasExpiryText = expiryTextPatterns.some(pattern => bodyText.includes(pattern));

      if (hasExpiryText) {
        return { isExpired: true, reason: 'Found expiry text on page', finalUrl };
      }

      const hasPasswordField = await session.page.$('input[type="password"]');
      const hasEmailField = await session.page.$('input[type="email"], input[name*="user" i], input[name*="login" i], input[name*="email" i]');
      const hasLoginButton = await session.page.$('button[type="submit"], input[type="submit"], button[name*="login" i], button[class*="login" i]');

      if (hasPasswordField && (hasEmailField || hasLoginButton)) {
        return { isExpired: true, reason: 'Found login form', finalUrl };
      }

      if (urlObj.hostname && urlObj.hostname.endsWith('github.dev')) {
        const isConnecting = bodyText.includes('Connecting to your codespace') || bodyText.includes('Setting up your codespace');
        const hasEditor = await session.page.$('.monaco-workbench');

        if (isConnecting || !hasEditor) {
          return { isExpired: false, isLoading: true, reason: 'Codespace is booting (workbench not ready)', finalUrl };
        }
      }

      return { isExpired: false, isLoading: false, finalUrl };
    } catch (error: any) {
      return { isExpired: false, reason: `Navigation/Evaluation error: ${error.message}`, finalUrl: url };
    }
  }

  async closeSession(targetId: string) {
    const session = this.sessions.get(targetId);
    if (session) {
      await session.page.close();
      await session.context.close();
      this.sessions.delete(targetId);
    }
  }

  async close() {
    if (this.browser) {
      for (const session of this.sessions.values()) {
        await session.page.close();
        await session.context.close();
      }
      this.sessions.clear();
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const browserService = new BrowserService();
