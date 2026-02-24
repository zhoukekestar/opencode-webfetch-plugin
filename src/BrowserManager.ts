import * as path from 'path';
import * as fs from 'fs';
import { HumanInteractor } from './HumanInteractor.js';
import { Extractor } from './Extractor.js';
import type { BrowserContext, Page } from 'playwright';

type PlaywrightModule = typeof import('playwright');

export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly playwright: PlaywrightModule;

  constructor(playwright: PlaywrightModule) {
    this.playwright = playwright;
  }

  /**
   * Initializes the persistent context if not already done.
   */
  public async ensureContext(): Promise<void> {
    if (this.context && this.page) {
      return;
    }

    const userDataDir = path.resolve(process.cwd(), '.userdata');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    // Launch a persistent browser context, preserving cookies and local storage.
    this.context = await this.playwright.chromium.launchPersistentContext(userDataDir, {
      headless: false, // Default to headful so users can see captchas
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--window-size=1280,720',
      ],
      viewport: { width: 1280, height: 720 },
    });

    // Create a new page or use the default one created by launchPersistentContext
    const pages = this.context.pages();
    if (pages.length > 0) {
      this.page = pages[0];
    } else {
      this.page = await this.context.newPage();
    }

    // Mask webdriver
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      const chrome = (window as any).chrome;
      if (chrome && chrome.runtime && chrome.runtime.onConnect) {
        delete chrome.runtime.onConnect;
      }
    });
  }

  /**
   * Navigates to a URL and tries to extract the content.
   * Prompts the user via terminal if it encounters a captcha or login screen.
   */
  public async fetchWebpage(url: string, timeout: number, abortSignal: AbortSignal): Promise<string> {
    await this.ensureContext();
    if (!this.page) throw new Error('Page not initialized');

    console.log(`\nNavigating to: ${url}`);
    
    // Add a listener to handle abortions
    const onAbort = () => {
      console.log('Operation aborted by user or timeout.');
    };
    abortSignal.addEventListener('abort', onAbort);

    try {
      // Go to the requested URL
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch((e) => {
        console.warn(`Navigation might have timed out or failed partially: ${e.message}`);
      });

      // Basic heuristic to check if human intervention is needed
      const needsHelp = await this.detectBlockers(this.page);
      
      if (needsHelp.blocked) {
        await HumanInteractor.askForHumanHelp(`The page appears to be blocked or requires login.\nReason: ${needsHelp.reason}\nURL: ${this.page.url()}`);
      } else {
        // Wait a little bit for dynamic content if not blocked
        await this.page.waitForTimeout(2000);
      }

      // Allow one more check in case the user didn't fully resolve it, or if it redirected
      const needsHelpAgain = await this.detectBlockers(this.page);
      if (needsHelpAgain.blocked) {
        await HumanInteractor.askForHumanHelp(`Still detected a blocker.\nReason: ${needsHelpAgain.reason}\nPlease complete the action and try again.`);
      }

      // Extract content as Markdown
      console.log('Extracting page content...');
      const markdown = await Extractor.extractMarkdown(this.page, this.page.url());
      return markdown;
    } finally {
      abortSignal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Detects if the current page is blocked by Captcha, Cloudflare, or a Login wall.
   */
  private async detectBlockers(page: Page): Promise<{ blocked: boolean; reason?: string }> {
    try {
      const url = page.url();

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
      console.error('Error detecting blockers:', e);
    }

    return { blocked: false };
  }

  /**
   * Close the browser context safely.
   */
  public async dispose(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
  }
}
