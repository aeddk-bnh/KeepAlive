import { db } from '@keepalive/database';
import { browserService } from '@keepalive/browser-core';

export class SessionWatcher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🚀 Session Watcher started.');
    this.scheduleNextRun();
  }

  private scheduleNextRun(fastRetry = false) {
    const delay = fastRetry ? 10000 : 60000;
    this.timer = setTimeout(() => this.run(), delay);
  }

  private async run() {
    let hasLoadingTargets = false;
    try {
      const activeTargets = await db.target.findMany({
        where: { isActive: true }
      });

      for (const target of activeTargets) {
        if (target.status === 'LOADING') {
          hasLoadingTargets = true;
        }
        const isStillLoading = await this.processTarget(target);
        if (isStillLoading) {
          hasLoadingTargets = true;
        }
      }
    } catch (err) {
      console.error('Error in Session Watcher run:', err);
    } finally {
      this.scheduleNextRun(hasLoadingTargets);
    }
  }

  // Returns true if the target is still loading
  private async processTarget(target: any): Promise<boolean> {
    const now = new Date();
    const lastRun = target.lastRun ? new Date(target.lastRun) : new Date(0);
    const timeSinceLastRun = now.getTime() - lastRun.getTime();
    const intervalMs = target.refreshInterval * 1000;

    let shouldReload = false;

    if (target.status === 'LOADING') {
      shouldReload = false;
    } else if (intervalMs > 0) {
      if (timeSinceLastRun < intervalMs) {
        return false;
      }
      shouldReload = true;
    } else {
      // For intervalMs === 0, we only check every minute (when fastRetry is false)
      // To avoid spamming checks every 10s when another target is loading:
      if (timeSinceLastRun < 60000) {
         return false;
      }
      shouldReload = false;
    }

    console.log(`Checking target: ${target.url} (Reload: ${shouldReload})`);

    try {
      const result = await browserService.checkSession(target.id, target.url, target.cookies, shouldReload);

      if (result.isExpired) {
        console.warn(`⚠️ SESSION EXPIRED for ${target.url}: ${result.reason}`);
        await db.target.update({
          where: { id: target.id },
          data: { status: 'EXPIRED', lastRun: now }
        });

        await db.activityLog.create({
          data: {
            targetId: target.id,
            level: 'WARN',
            message: `Session Expired: ${result.reason}`
          }
        });
        return false;
      } else if (result.isLoading) {
        console.log(`⏳ Session LOADING for ${target.url}: ${result.reason}`);
        await db.target.update({
          where: { id: target.id },
          data: { status: 'LOADING', lastRun: now }
        });

        // Only log "Loading" if it wasn't already loading to prevent DB spam every 10s
        if (target.status !== 'LOADING') {
          await db.activityLog.create({
            data: {
              targetId: target.id,
              level: 'INFO',
              message: `Loading: ${result.reason}`
            }
          });
        }
        return true;
      } else {
        console.log(`✅ Session ACTIVE for ${target.url}`);
        if (target.status !== 'ACTIVE') {
          await db.activityLog.create({
            data: {
              targetId: target.id,
              level: 'INFO',
              message: `Session Recovered & Active`
            }
          });
        }
        await db.target.update({
          where: { id: target.id },
          data: { status: 'ACTIVE', lastRun: now }
        });
        return false;
      }

    } catch (err: any) {
      console.error(`Error processing target ${target.url}:`, err);
      await db.target.update({
        where: { id: target.id },
        data: { status: 'ERROR', lastRun: now }
      });

      if (target.status !== 'ERROR') {
        await db.activityLog.create({
          data: {
            targetId: target.id,
            level: 'ERROR',
            message: `Browser Error: ${err.message}`
          }
        });
      }
      return false;
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}

export const sessionWatcher = new SessionWatcher();
