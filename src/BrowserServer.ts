import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { BrowserContext } from 'playwright';

type PlaywrightModule = typeof import('playwright');

const CDP_PORT = 9222;
const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser.lock');
const USER_DATA_DIR = path.resolve(os.homedir(), '.cache/opencode/user-data');

/**
 * Manages a singleton browser instance that multiple processes can connect to.
 * Uses file-based locking to ensure only one process launches the browser.
 */
export class BrowserServer {
  private static instance: BrowserServer | null = null;
  private context: BrowserContext | null = null;
  private readonly playwright: PlaywrightModule;
  private isOwner: boolean = false;

  private constructor(playwright: PlaywrightModule) {
    this.playwright = playwright;
  }

  /**
   * Gets or creates the singleton browser server instance.
   */
  static async getInstance(playwright: PlaywrightModule): Promise<BrowserServer> {
    if (!BrowserServer.instance) {
      BrowserServer.instance = new BrowserServer(playwright);
      await BrowserServer.instance.initialize();
    }
    return BrowserServer.instance;
  }

  /**
   * Initializes the browser connection.
   * Either launches a new browser (if this is the first process) or connects to existing one.
   */
  private async initialize(): Promise<void> {
    // Ensure cache directory exists
    const cacheDir = path.dirname(LOCK_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    // Try to acquire lock and launch browser
    if (await this.tryAcquireLock()) {
      await this.launchBrowser();
    } else {
      // Another process owns the browser, connect to it
      await this.connectToBrowser();
    }
  }

  /**
   * Attempts to acquire the browser lock.
   * Returns true if this process should launch the browser.
   */
  private async tryAcquireLock(): Promise<boolean> {
    try {
      // Check if lock file exists and is still valid
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
        const lockPid = lockData.pid;

        // Check if the process that created the lock is still running
        try {
          process.kill(lockPid, 0); // Signal 0 checks if process exists
          // Process exists, we should connect to it
          return false;
        } catch (e) {
          // Process doesn't exist, remove stale lock
          console.log('Removing stale browser lock file');
          fs.unlinkSync(LOCK_FILE);
        }
      }

      // Create lock file with current process info
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        pid: process.pid,
        port: CDP_PORT,
        timestamp: Date.now()
      }));

      this.isOwner = true;

      // Clean up lock fi when process exits
      process.on('exit', () => {
        if (this.isOwner && fs.existsSync(LOCK_FILE)) {
          try {
            fs.unlinkSync(LOCK_FILE);
          } catch (e) {
            // Ignore errors during cleanup
          }
        }
      });

      return true;
    } catch (e) {
      console.error('Error acquiring browser lock:', e);
      return false;
    }
  }

  /**
   * Launches a new browser instance with CDP enabled.
   */
  private async launchBrowser(): Promise<void> {
    console.log('Launching new browser instance...');

    // Load extensions if available
    const extensionPath = path.resolve(os.homedir(), '.cache/opencode/extensions');
    const extensions: string[] = [];
    if (fs.existsSync(extensionPath)) {
      const dirs = fs.readdirSync(extensionPath).map(d => path.join(extensionPath, d));
      extensions.push(...dirs.filter(d => fs.statSync(d).isDirectory()));
    }

    const launchOptions: Parameters<typeof this.playwright.chromium.launchPersistentContext>[1] = {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--window-size=1280,720',
        `--remote-debugging-port=${CDP_PORT}`,
        ...(extensions.length > 0 ? [
          `--disable-extensions-except=${extensions.join(',')}`,
          `--load-extension=${extensions.join(',')}`
        ] : []),
      ],
      viewport: { width: 1280, height: 720 },
    };

    this.context = await this.playwright.chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);

    // Mask webdriver on all pages
    this.context.on('page', async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        const chrome = (window as any).chrome;
        if (chrome && chrome.runtime && chrome.runtime.onConnect) {
          delete chrome.runtime.onConnect;
        }
      });
    });

    console.log(`Browser launched with CDP on port ${CDP_PORT}`);
  }

  /**
   * Connects to an existing browser instance via CDP.
   */
  private async connectToBrowser(): Promise<void> {
    console.log('Connecting to existing browser instance...');

    const maxRetries = 10;
    const retryDelay = 500;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const browser = await this.playwright.chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
        
        // Get the default context (persistent context)
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          this.context = contexts[0];
          console.log('Connected to existing browser');
          return;
        }
      } catch (e) {
        if (i === maxRetries - 1) {
          throw new Error(`Failed to connect to browser after ${maxRetries} attempts: ${e}`);
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error('Failed to connect to browser: no context available');
  }

  /**
   * Gets the browser context.
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Checks if this process owns the browser.
   */
  isOwnerProcess(): boolean {
    return this.isOwner;
  }

  /**
   * Closes the browser if this process owns it.
   */
  async dispose(): Promise<void> {
    if (this.isOwner && this.context) {
      try {
        await this.context.close();
        console.log('ed');
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
    this.context = null;
  }
}
