import { Browser, BrowserContext, chromium, Page, Dialog } from 'playwright';

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

export interface SessionSnapshot {
  targetId: string;
  url: string;
  cookies: string;
  timestamp: string;
}

const randomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min)) + min;

export class BrowserService {
  private browser: Browser | null = null;
  private sessions: Map<string, PersistentSession> = new Map();

  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
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

    // --- POPUP RESILIENCE: Grant all permissions to suppress browser prompts ---
    const context = await this.browser!.newContext({
      storageState: { cookies, origins: [] },
      viewport: { width: 1280, height: 800 },
      // Suppress browser-level permission dialogs (notifications, geolocation)
      permissions: [],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    // --- POPUP RESILIENCE: Auto-dismiss native browser dialogs ---
    context.on('dialog', async (dialog: Dialog) => {
      console.log(`[Popup Shield] Dismissed browser dialog: ${dialog.type()} - ${dialog.message().slice(0, 50)}`);
      if (dialog.type() === 'beforeunload') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    const page = await context.newPage();

    // --- POPUP RESILIENCE: Suppress console-based permission popups in some SPAs ---
    page.on('pageerror', () => { /* ignore JS errors from page */ });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const session = { context, page };
    this.sessions.set(targetId, session);
    return session;
  }

  /**
   * TIER 1: Escape key — dismisses most modals/overlays without side effects.
   * TIER 2: Close button detection — finds ×/X/close buttons and clicks them.
   * TIER 3: Cookie/consent banner dismissal.
   * Each tier has its own try-catch so a failure in one doesn't block others.
   */
  async dismissPopups(targetId: string): Promise<{ dismissed: boolean; reason?: string }> {
    const session = this.sessions.get(targetId);
    if (!session || session.page.isClosed()) {
      return { dismissed: false, reason: 'Session not found' };
    }

    const { page } = session;
    let dismissedAny = false;

    // === TIER 1: Press Escape (safe, dismisses 80% of modals) ===
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(randomDelay(300, 600));
    } catch { /* ignore */ }

    // === TIER 2: Click visible close buttons ===
    try {
      const closeSelectors = [
        '[aria-label="Close"]',
        '[aria-label="close"]',
        '[data-dismiss="modal"]',
        '[data-action="close"]',
        'button[title="Close"]',
        'button[aria-label="Dismiss"]',
        '.modal-close',
        '.close-button',
        '.dismiss-btn',
        '.notification-close',
        '[role="dialog"] button:last-of-type',
      ];

      for (const selector of closeSelectors) {
        try {
          const closeBtn = await page.$(selector);
          if (closeBtn && await closeBtn.isVisible()) {
            await closeBtn.click({ timeout: 2000 });
            dismissedAny = true;
            await page.waitForTimeout(randomDelay(200, 400));
          }
        } catch { /* no match or not visible */ }
      }
    } catch { /* ignore */ }

    // === TIER 3: Click × character text inside buttons ===
    try {
      // Find buttons containing the × (multiplication sign) or ✕ character
      const xButtons = await page.$$('button, a, span, div');
      for (const el of xButtons.slice(0, 50)) { // limit to first 50 elements
        try {
          const text = await el.textContent();
          const isSmall = text && text.trim().length <= 3;
          if (isSmall && (text.includes('\u00d7') || text.includes('\u2715') || text.includes('\u2716'))) {
            const isVisible = await el.isVisible();
            if (isVisible) {
              await el.click({ timeout: 1000 });
              dismissedAny = true;
              await page.waitForTimeout(randomDelay(200, 400));
              break; // only close one to avoid misclicks
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    // === TIER 4: Dismiss cookie/consent banners (click Accept/Reject/OK — safe) ===
    try {
      const acceptSelectors = [
        'button[id*="accept"]',
        'button[id*="agree"]',
        'button[class*="accept"]',
        'button[class*="cookie-accept"]',
        '#onetrust-accept-btn-handler',
        '[data-testid="cookie-accept"]',
      ];

      for (const selector of acceptSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            await btn.click({ timeout: 2000 });
            dismissedAny = true;
            await page.waitForTimeout(randomDelay(200, 400));
          }
        } catch { /* no match */ }
      }
    } catch { /* ignore */ }

    return { dismissed: dismissedAny };
  }

  async takeScreenshot(targetId: string, url: string, cookiesJson: string): Promise<{ image: string; error?: string }> {
    try {
      const session = await this.getOrCreateSession(targetId, cookiesJson, url);
      // Try to dismiss popups before screenshot for a clean image
      await this.dismissPopups(targetId);
      await session.page.waitForTimeout(1000);
      const image = (await session.page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
      return { image };
    } catch (error: any) {
      return { image: '', error: error.message };
    }
  }

  /**
   * Simulates human-like activity on a persistent tab to keep session alive.
   * Before each activity cycle, popups are auto-dismissed.
   * Actions: dismiss popups → escape key → mouse movement → type & delete → scroll.
   * NEVER submits forms or types in password fields.
   */
  async simulateHumanActivity(targetId: string): Promise<{ success: boolean; reason?: string }> {
    const session = this.sessions.get(targetId);
    if (!session || session.page.isClosed()) {
      return { success: false, reason: 'Session not found or closed' };
    }

    const { page } = session;

    try {
      // === POPUP RESILIENCE: Clean up before activity ===
      await this.dismissPopups(targetId);

      // === Step 1: Natural mouse movement (to center area, away from edges where popups live) ===
      const startX = randomDelay(300, 700);
      const startY = randomDelay(100, 300);
      const endX = randomDelay(300, 700);
      const endY = randomDelay(300, 500);
      await page.mouse.move(startX, startY, { steps: 10 });
      await page.waitForTimeout(randomDelay(300, 800));
      await page.mouse.move(endX, endY, { steps: randomDelay(15, 30) });
      await page.waitForTimeout(randomDelay(400, 1000));

      // === Step 2: Find a SAFE text input to type in ===
      let safeInput = await this.findSafeInput(page);

      if (safeInput) {
        try {
          // Scroll the element into view first (in case popup pushed it down)
          await safeInput.scrollIntoViewIfNeeded({ timeout: 3000 });

          // Click to focus
          await safeInput.click({ timeout: 2000 });
          await page.waitForTimeout(randomDelay(150, 350));

          // Triple-click to select all existing text
          await safeInput.click({ clickCount: 3, timeout: 2000 });
          await page.waitForTimeout(randomDelay(150, 350));

          // Type "keepalive" then delete it
          const testText = 'keepalive';
          await safeInput.type(testText, { delay: randomDelay(60, 140) });
          await page.waitForTimeout(randomDelay(300, 700));

          // Delete character by character
          for (let i = 0; i < testText.length; i++) {
            await page.keyboard.press('Backspace', { delay: randomDelay(40, 90) });
          }

          // Click somewhere neutral (top-left of page, outside any popup area)
          await page.mouse.click(30, 30);
          await page.waitForTimeout(randomDelay(200, 500));
        } catch (err: any) {
          // If a popup intercepted the click, try Escape + retry once
          try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(randomDelay(500, 1000));
            // Skip typing this cycle — scroll is enough to keep session
          } catch { /* give up on typing */ }
        }
      }

      // === Step 3: Natural scrolling (use page.evaluate for reliable scroll even with overlays) ===
      try {
        const scrollAmount = randomDelay(150, 400);
        const direction = Math.random() > 0.5 ? 1 : -1;
        await page.mouse.wheel(0, scrollAmount * direction);
        await page.waitForTimeout(randomDelay(500, 1500));
        await page.mouse.wheel(0, -(scrollAmount * direction * 0.5));
      } catch { /* scroll may fail on pages with custom scroll — ignore */ }

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
    const searchSelectors = [
      'input[type="search"]',
      'input[role="searchbox"]',
      'input[placeholder*="search" i]',
      'input[placeholder*="tìm kiếm" i]',
      'input[placeholder*="Search" i]',
      '[data-hotkey="s"]',
    ];
    for (const selector of searchSelectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) return el;
      } catch { /* ignore */ }
    }

    const generalInputs = await page.$$('input[type="text"], input:not([type]), textarea');
    for (const input of generalInputs) {
      try {
        const isVisible = await input.isVisible();
        if (!isVisible) continue;

        const type = (await input.getAttribute('type'))?.toLowerCase();
        const name = (await input.getAttribute('name'))?.toLowerCase() || '';
        const id = (await input.getAttribute('id'))?.toLowerCase() || '';
        const placeholder = (await input.getAttribute('placeholder'))?.toLowerCase() || '';

        const isSensitive =
          type === 'password' ||
          name.includes('password') || name.includes('token') || name.includes('secret') ||
          id.includes('password') || id.includes('token') || id.includes('secret') ||
          placeholder.includes('password') || placeholder.includes('token');

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

  async openSessionWindow(targetId: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(targetId);
    if (!session || session.page.isClosed()) {
      return { success: false, error: 'Session not found or closed' };
    }

    try {
      await session.page.bringToFront();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async exportSessionSnapshot(targetId: string, url: string, cookiesJson: string): Promise<{ snapshot?: SessionSnapshot; error?: string }> {
    try {
      await this.getOrCreateSession(targetId, cookiesJson, url);
      return {
        snapshot: {
          targetId,
          url,
          cookies: cookiesJson,
          timestamp: new Date().toISOString()
        }
      };
    } catch (err: any) {
      return { error: err.message };
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
