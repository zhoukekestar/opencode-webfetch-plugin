import type { ToolContext } from "@opencode-ai/plugin";

import { HumanInteractor } from './HumanInteractor.js';
import { Extractor } from './Extractor.js';
import { BrowserServer } from './BrowserServer.js';
import type { Page } from 'playwright';

type PlaywrightModule = typeof import('playwright');

export class BrowserManager {
  private readonly playwright: PlaywrightModule;
  private readonly client: any;
  private browserServer: BrowserServer | null = null;

  constructor(playwright: PlaywrightModule, client: any) {
    this.playwright = playwright;
    this.client = client;
  }

  /**
   * Ensures the browser server is initialized.
   */
  private async ensureBrowserServer(): Promise<BrowserServer> {
    if (!this.browserServer) {
      this.browserServer = await BrowserServer.getInstance(this.playwright, this.client);
    }
    return this.browserServer;
  }

  /**
   * Navigates to a URL and tries to extract the content.
   * Prompts the user via terminal if it encounters a captcha or login screen.
   * For concurrent calls, creates new pages in the same context.
   */
  public async fetchWebpage(url: string, timeout: number, ctx: ToolContext): Promise<string> {
    const browserServer = await this.ensureBrowserServer();
    const context = browserServer.getContext();
    
    if (!context) throw new Error('Browser context not initialized');

    // Create a new page for each concurrent request
    const page = await context.newPage();

    this.client?.logger?.info(`Navigating to: ${url}`);
    
    // Add a listener to handle abortions
    const onAbort = () => {
      this.client?.logger?.info('Operation aborted by user or timeout.');
      page.close().catch(() => undefined);
    };
    ctx.abort.addEventListener('abort', onAbort);

    try {
      // Go to the requested URL
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch((e) => {
        this.client?.logger?.warn(`Navigation might have timed out or failed partially: ${e.message}`);
      });

      // too fast
      await page.waitForTimeout(2000);

      // Basic heuristic to check if human intervention is needed
      const needsHelp = await this.detectBlockers(page);
      
      if (needsHelp.blocked) {
        await HumanInteractor.askForHumanHelp(`The page appears to be blocked or requires login.\nReason: ${needsHelp.reason}\nURL: ${page.url()}`, ctx, this.client, () => this.detectBlockers(page));
      } else {
        // Wait a little bit for dynamic content if not blocked
        await page.waitForTimeout(2000);
      }

      // Allow one more check in case the user didn't fully resolve it, or if it redirected
      const needsHelpAgain = await this.detectBlockers(page);
      if (needsHelpAgain.blocked) {
        await HumanInteractor.askForHumanHelp(`Still detected a blocker.\nReason: ${needsHelpAgain.reason}\nPlease complete the action and try again.`, ctx, this.client, () => this.detectBlockers(page));
      }

      // Extract content as Markdown
      this.client?.logger?.info('Extracting page content...');
      const markdown = await Extractor.extractMarkdown(page, page.url());
      return markdown;
    } finally {
      ctx.abort.removeEventListener('abort', onAbort);
      // Close the page after extraction to free resources
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Detects if the current page is blocked by Captcha, Cloudflare, or a Login wall.
   */
  private async detectBlockers(page: Page | null): Promise<{ blocked: boolean; reason?: string }> {
    try {
      if (page == null) return {blocked: false}
      const url = page.url();

      // 0. Check for about:blank (no network connection)
      if (url === 'about:blank') {
        return { blocked: true, reason: 'No network connection. Please check your internet and press Enter to continue.' };
      }

      // 1. Check URL patterns for logins or known captchas
      if (url.includes('/login') || url.includes('/signin') || url.includes('auth0.com')) {
        return { blocked: true, reason: 'Login page detected.' };
      }

      // 2. Check for Cloudflare Turnstile or similar challenge pages
      const isCloudflare = await page.evaluate(() => {
        const title = document.title.toLowerCase();
        const text = document.body.innerText.toLowerCase();
        
        if (title.includes('just a moment') || title.includes('attention required!')) {
          return true;
        }
        if (text.includes('checking your browser before accessing') || text.includes('enable javascript and cookies to continue')) {
          return true;
        }
        return false;
      });

      if (isCloudflare) {
        return { blocked: true, reason: 'Cloudflare challenge detected.' };
      }

      // 3. Check for typical Captcha iframes (reCAPTCHA, hCaptcha)
      const hasCaptcha = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        return iframes.some((f) => {
          const src = f.src.toLowerCase();
          return src.includes('recaptcha') || src.includes('hcaptcha') || src.includes('turnstile');
        });
      });

      if (hasCaptcha) {
        // Sometimes captchas are invisible, but if they are visible, we might be blocked.
        return { blocked: true, reason: 'Captcha iframe detected on page.' };
      }

      // 4. Check for Google "Sorry" page
      if (url.includes('/sorry/')) {
        return { blocked: true, reason: 'Google automated access blocker detected.' };
      }

    } catch (e) {
      this.client?.logger?.error('Error detecting blockers:', e);
    }

    return { blocked: false };
  }

  /**
   * Close the browser if this process owns it.
   */
  public async dispose(): Promise<void> {
    if (this.browserServer) {
      await this.browserServer.dispose();
    }
    this.browserServer = null;
  }
}
