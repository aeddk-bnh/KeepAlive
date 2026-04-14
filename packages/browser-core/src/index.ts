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

// Helper: Generate human-like random typing delay
const randomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min)) + min;

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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const session = { context, page };
    this.sessions.set(targetId, session);
    return session;
  }

  async takeScreenshot(targetId: string, url: string, cookiesJson: string): Promise<{ image: string; error?: string }> {
    try {
      const session = await this.getOrCreateSession(targetId, cookiesJson, url);
      await session.page.waitForTimeout(1000);
      const image = (await session.page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
      return { image };
    } catch (error: any) {
      return { image: '', error: error.message };
    }
  }

  /**
   * Simulates human-like activity on a persistent tab to keep session alive.
   * Actions: mouse movement, scroll, type & delete text in a safe input.
   * NEVER submits forms or types in password fields.
   */
  async simulateHumanActivity(targetId: string): Promise<{ success: boolean; reason?: string }> {
    const session = this.sessions.get(targetId);
    if (!session || session.page.isClosed()) {
      return { success: false, reason: 'Session not found or closed' };
    }

    const { page } = session;

    try {
      // --- Step 1: Natural mouse movement ---
      const startX = randomDelay(200, 600);
      const startY = randomDelay(100, 400);
      const endX = randomDelay(200, 600);
      const endY = randomDelay(100, 400);
      await page.mouse.move(startX, startY, { steps: 10 });
      await page.waitForTimeout(randomDelay(300, 800));
      await page.mouse.move(endX, endY, { steps: randomDelay(15, 30) });
      await page.waitForTimeout(randomDelay(400, 1000));

      // --- Step 2: Find a SAFE text input to type in ---
      let safeInput = await this.findSafeInput(page);

      if (safeInput) {
        try {
          // Triple-click to select all existing text (clear the field safely)
          await safeInput.click({ clickCount: 3 });
          await page.waitForTimeout(randomDelay(150, 350));

          // Type "keepalive" then delete it — looks like a real user testing a field
          const testText = 'keepalive';
          await safeInput.type(testText, { delay: randomDelay(60, 140) });
          await page.waitForTimeout(randomDelay(300, 700));

          // Delete character by character with backspace (human-like)
          for (let i = 0; i < testText.length; i++) {
            await page.keyboard.press('Backspace', { delay: randomDelay(40, 90) });
          }

          // Click somewhere neutral to blur
          await page.mouse.click(30, 30);
          await page.waitForTimeout(randomDelay(200, 500));
        } catch {
          // If typing fails for any reason, skip to scroll — don't crash
        }
      }

      // --- Step 3: Natural scrolling ---
      const scrollAmount = randomDelay(150, 400);
      const direction = Math.random() > 0.5 ? 1 : -1;
      await page.mouse.wheel(0, scrollAmount * direction);
      await page.waitForTimeout(randomDelay(500, 1500));

      // Scroll back slightly
      await page.mouse.wheel(0, -(scrollAmount * direction * 0.5));

      return { success: true };
    } catch (err: any) {
      return { success: false, reason: err.message };
    }
  }

  /**
   * Finds a safe text input on the page — prioritizes search boxes,
   * avoids password/token/secret fields, and never picks hidden inputs.
   */
  private async findSafeInput(page: Page): Promise<any | null> {
    // Priority 1: Search boxes (safest — they're designed for arbitrary text)
    const searchSelectors = [
      'input[type="search"]',
      'input[role="searchbox"]',
      'input[placeholder*="search" i]',
      'input[placeholder*="tìm kiếm" i]',
      'input[placeholder*="Search" i]',
      '[data-hotkey="s"]', // GitHub search
    ];
    for (const selector of searchSelectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) return el;
      } catch { /* ignore */ }
    }

    // Priority 2: General text inputs (filter out sensitive ones)
    const generalInputs = await page.$$('input[type="text"], input:not([type]), textarea');
    for (const input of generalInputs) {
      try {
        const isVisible = await input.isVisible();
        if (!isVisible) continue;

        const type = (await input.getAttribute('type'))?.toLowerCase();
        const name = (await input.getAttribute('name'))?.toLowerCase() || '';
        const id = (await input.getAttribute('id'))?.toLowerCase() || '';
        const placeholder = (await input.getAttribute('placeholder'))?.toLowerCase() || '';

        // Skip sensitive fields
        const isSensitive =
          type === 'password' ||
          name.includes('password') || name.includes('token') || name.includes('secret') ||
          id.includes('password') || id.includes('token') || id.includes('secret') ||
          placeholder.includes('password') || placeholder.includes('token');

        // Skip if inside a login form
        const parentForm = await input.$('xpath=ancestor::form');
        const formAction = parentForm ? await parentForm.getAttribute('action') : '';
        const isInLoginForm =
          formAction?.toLowerCase().includes('login') ||
          formAction?.toLowerCase().includes('auth') ||
          formAction?.toLowerCase().includes('signin');

        if (!isSensitive && !isInLoginForm) {
          return input;
        }
      } catch { /* ignore */ }
    }

    return null;
  }

  async checkSession(targetId: string, url: string, cookiesJson: string, forceReload: boolean = false): Promise<ExpiryResult> {
    try {
      const session = await this.getOrCreateSession(targetId, cookiesJson, url);

      if (forceReload) {
        await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await session.page.waitForTimeout(5000);
      } else {
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
