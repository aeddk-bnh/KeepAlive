import { Browser, BrowserContext, Page, Dialog } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { spawn, ChildProcess } from 'child_process';

chromium.use(stealthPlugin());

export interface ExpiryResult {
  isExpired: boolean;
  isLoading?: boolean;
  reason?: string;
  finalUrl: string;
}

interface PersistentSession {
  context: BrowserContext;
  page: Page;
  vncPort: number;
  wsPort: number;
  displayNum: number;
  processes: ChildProcess[]; // Base processes: Xvfb, fluxbox, autocutsel
  vncProcesses: ChildProcess[]; // On-demand: x11vnc, websockify
  vncTimeout?: NodeJS.Timeout;
}

export interface SessionSnapshot {
  targetId: string;
  url: string;
  cookies: string;
  timestamp: string;
}

export interface VncConnectionInfo {
  wsPort: number;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

const randomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min)) + min;

export class BrowserService {
  private sessions: Map<string, PersistentSession> = new Map();
  private nextDisplayNum = 100;
  private nextVncPort = 5900;
  private nextWsPort = 6080;

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getOrCreateSession(targetId: string, cookiesJson: string, url: string): Promise<PersistentSession> {
    if (this.sessions.has(targetId)) {
      const existingSession = this.sessions.get(targetId)!;
      if (existingSession.context.pages().length > 0) {
        return existingSession;
      }
      await this.closeSession(targetId);
    }

    const displayNum = this.nextDisplayNum++;
    const vncPort = this.nextVncPort++;
    const wsPort = this.nextWsPort++;

    const processes: ChildProcess[] = [];

    const xvfb = spawn('Xvfb', [`:${displayNum}`, '-screen', '0', `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}x24`]);
    processes.push(xvfb);
    await this.delay(500);

    const fluxbox = spawn('fluxbox', ['-display', `:${displayNum}`]);
    processes.push(fluxbox);

    const autocutselPrimary = spawn('autocutsel', ['-s', 'PRIMARY', '-display', `:${displayNum}`]);
    processes.push(autocutselPrimary);

    const autocutselClip = spawn('autocutsel', ['-s', 'CLIPBOARD', '-display', `:${displayNum}`]);
    processes.push(autocutselClip);

    const x11vnc = spawn('x11vnc', ['-display', `:${displayNum}`, '-nopw', '-forever', '-shared', '-rfbport', vncPort.toString()]);
    const websockify = spawn('websockify', [wsPort.toString(), `localhost:${vncPort}`]);
    const vncProcesses = [x11vnc, websockify];

    const userDataDir = `/tmp/playwright-profile-${targetId}`;

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-position=0,0', `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`, '--start-maximized'],
      ignoreDefaultArgs: ['--disable-extensions'],
      env: { ...process.env, DISPLAY: `:${displayNum}` },
      viewport: null, // Allow viewport to fill window so the tab bar is visible without scrolling
      permissions: ['clipboard-read', 'clipboard-write']
    });

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

    await context.addCookies(cookies);

    context.on('dialog', async (dialog: Dialog) => {
      console.log(`[Popup Shield] Dismissed browser dialog: ${dialog.type()} - ${dialog.message().slice(0, 50)}`);
      if (dialog.type() === 'beforeunload') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror', () => { /* ignore JS errors from page */ });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const session: PersistentSession = { context, page, vncPort, wsPort, displayNum, processes, vncProcesses: [] };
    this.sessions.set(targetId, session);

    // Initial VNC start
    this.startVncForSession(targetId);

    return session;
  }

  public startVncForSession(targetId: string) {
    const session = this.sessions.get(targetId);
    if (!session) return;

    if (session.vncTimeout) {
      clearTimeout(session.vncTimeout);
    }

    if (session.vncProcesses.length === 0) {
      console.log(`[VNC] Starting x11vnc and websockify for target ${targetId}`);
      const x11vnc = spawn('x11vnc', ['-display', `:${session.displayNum}`, '-nopw', '-forever', '-shared', '-rfbport', session.vncPort.toString()]);
      const websockify = spawn('websockify', [session.wsPort.toString(), `localhost:${session.vncPort}`]);
      session.vncProcesses.push(x11vnc, websockify);
    }

    // Set timeout to kill VNC after 5 minutes of no heartbeat
    session.vncTimeout = setTimeout(() => {
      this.stopVncForSession(targetId);
    }, 5 * 60 * 1000);
  }

  private stopVncForSession(targetId: string) {
    const session = this.sessions.get(targetId);
    if (!session) return;

    if (session.vncProcesses.length > 0) {
      console.log(`[VNC] Stopping x11vnc and websockify for target ${targetId} to free memory`);
      for (const proc of session.vncProcesses) {
        try { proc.kill('SIGTERM'); } catch (e) {}
      }
      session.vncProcesses = [];
    }
  }

  private getActivePage(session: PersistentSession): Page | null {
    const pages = session.context.pages();
    return pages.length > 0 ? pages[0] : null;
  }

  /**
   * TIER 1: Escape key — dismisses most modals/overlays without side effects.
   * TIER 2: Close button detection — finds ×/X/close buttons and clicks them.
   * TIER 3: Cookie/consent banner dismissal.
   * Each tier has its own try-catch so a failure in one doesn't block others.
   */
  async dismissPopups(targetId: string): Promise<{ dismissed: boolean; reason?: string }> {
    const session = this.sessions.get(targetId);
    if (!session) {
      return { dismissed: false, reason: 'Session not found' };
    }
    const page = this.getActivePage(session);
    if (!page) {
      return { dismissed: false, reason: 'No active pages in session' };
    }

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

    // === TIER 3: Dismiss cookie/consent banners (click Accept/Reject/OK — safe) ===
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
      await this.getOrCreateSession(targetId, cookiesJson, url);
      const image = await this.captureSessionScreenshot(targetId);
      return { image };
    } catch (error: any) {
      return { image: '', error: error.message };
    }
  }

  async captureSessionScreenshot(targetId: string): Promise<string> {
    const session = this.sessions.get(targetId);
    if (!session) {
      throw new Error('Session not found');
    }
    const page = this.getActivePage(session);
    if (!page) {
      throw new Error('No active pages in session');
    }

    await page.waitForTimeout(150);
    return (await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
  }

  /**
   * Simulates human-like activity on a persistent tab to keep session alive.
   * Before each activity cycle, popups are auto-dismissed.
   * Actions: dismiss popups → escape key → mouse movement → type & delete → scroll.
   * NEVER submits forms or types in password fields.
   */
  async simulateHumanActivity(targetId: string): Promise<{ success: boolean; reason?: string }> {
    const session = this.sessions.get(targetId);
    if (!session) {
      return { success: false, reason: 'Session not found' };
    }

    // Do not interfere with user activity if VNC is currently active
    if (session.vncProcesses.length > 0) {
      return { success: true, reason: 'VNC is active, skipping simulation to avoid interference' };
    }

    const page = this.getActivePage(session);
    if (!page) {
      return { success: false, reason: 'No active pages in session' };
    }

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

      // === Step 2: Natural scrolling (use page.evaluate for reliable scroll even with overlays) ===
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
      const page = this.getActivePage(session);

      if (!page) {
        return { isExpired: false, reason: 'No active pages in session', finalUrl: url };
      }

      if (forceReload) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
      } else {
        await page.waitForTimeout(1000);
      }

      const finalUrl = page.url();
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

      const bodyText = await page.innerText('body');
      const expiryTextPatterns = ['Session expired', 'Please log in', 'Your session has timed out', 'Please sign in'];
      const hasExpiryText = expiryTextPatterns.some(pattern => bodyText.includes(pattern));

      if (hasExpiryText) {
        return { isExpired: true, reason: 'Found expiry text on page', finalUrl };
      }

      const hasPasswordField = await page.$('input[type="password"]');
      const hasEmailField = await page.$('input[type="email"], input[name*="user" i], input[name*="login" i], input[name*="email" i]');
      const hasLoginButton = await page.$('button[type="submit"], input[type="submit"], button[name*="login" i], button[class*="login" i]');

      if (hasPasswordField && (hasEmailField || hasLoginButton)) {
        return { isExpired: true, reason: 'Found login form', finalUrl };
      }

      if (urlObj.hostname && urlObj.hostname.endsWith('github.dev')) {
        const isConnecting = bodyText.includes('Connecting to your codespace') || bodyText.includes('Setting up your codespace');
        const hasEditor = await page.$('.monaco-workbench');

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
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    const page = this.getActivePage(session);
    if (!page) {
      return { success: false, error: 'No active pages in session' };
    }

    try {
      await page.bringToFront();
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
      if (session.vncTimeout) clearTimeout(session.vncTimeout);
      this.stopVncForSession(targetId);

      try { await session.page.close(); } catch {}
      try { await session.context.close(); } catch {}

      for (const proc of session.processes) {
        try {
          proc.kill('SIGTERM');
        } catch (e) {
          // ignore kill errors
        }
      }

      this.sessions.delete(targetId);
    }
  }

  async close() {
    for (const targetId of this.sessions.keys()) {
      await this.closeSession(targetId);
    }
  }
}

export const browserService = new BrowserService();
