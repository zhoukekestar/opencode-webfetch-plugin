import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { BrowserContext } from 'playwright';

type PlaywrightModule = typeof import('playwright');

const CDP_PORT = 9222;
const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser.lock');
const USER_DATA_DIR = path.resolve(os.homedir(), '.cache/opencode/user-data');

/**
 * Manages a shared browser instance that multiple processes can connect to.
 * One process launches the browser, others connect via WebSocket endpoint.
 * Each process creates its own pages without interfering with others.
 */
export class BrowserServer {
  private static instance: BrowserServer | null = null;
  private static initPromise: Promise<BrowserServer> | null = null;
  private context: BrowserContext | null = null;
  private readonly playwright: PlaywrightModule;
  private readonly client: any;
  private isOwner: boolean = false;

  private constructor(playwright: PlaywrightModule, client: any) {
    this.playwright = playwright;
    this.client = client;
  }

  /**
   * Gets or creates the browser server instance for this process.
   */
  static async getInstance(playwright: PlaywrightModule, client: any): Promise<BrowserServer> {
    if (BrowserServer.initPromise) {
      return BrowserServer.initPromise;
    }

    if (!BrowserServer.instance) {
      BrowserServer.initPromise = (async () => {
        BrowserServer.instance = new BrowserServer(playwright, client);
        await BrowserServer.instance.initialize();
        return BrowserServer.instance;
      })();
      
      try {
        const instance = await BrowserServer.initPromise;
        return instance;
      } finally {
        BrowserServer.initPromise = null;
      }
    }
    return BrowserServer.instance;
  }

  /**
   * Initializes the browser connection.
   */
  private async initialize(): Promise<void> {
    const cacheDir = path.dirname(LOCK_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    const wsEndpoint = this.readWsEndpoint();
    if (wsEndpoint) {
      try {
        await this.connectToBrowser(wsEndpoint);
        return;
      } catch (e) {
        this.client?.logger?.warn('Failed to connect to existing browser, will launch new one');
        if (fs.existsSync(LOCK_FILE)) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    }

    await this.launchBrowser();
  }

  /**
   * Reads the WebSocket endpoint from lock file.
   */
  private readWsEndpoint(): string | null {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
        
        try {
          process.kill(lockData.pid, 0);
          return lockData.wsEndpoint;
        } catch (e) {
          return null;
        }
      }
    } catch (e) {
      this.client?.logger?.error('Error reading WebSocket endpoint:', e);
    }
    return null;
  }

  /**
   * Writes the WebSocket endpoint to lock file.
   */
  private writeWsEndpoint(wsEndpoint: string): void {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        pid: process.pid,
        wsEndpoint,
        timestamp: Date.now()
      }));

      process.on('exit', () => {
        if (this.isOwner && fs.existsSync(LOCK_FILE)) {
          try {
            fs.unlinkSync(LOCK_FILE);
          } catch (e) {
            // Ignore
          }
        }
      });
    } catch (e) {
      this.client?.logger?.error('Error writing WebSocket endpoint:', e);
    }
  }

  /**
   * Launches a new browser instance.
   */
  private async launchBrowser(): Promise<void> {
    this.client?.logger?.info('Launching new browser instance...');
    this.isOwner = true;

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

    const wsEndpoint = `http://localhost:${CDP_PORT}`;
    this.writeWsEndpoint(wsEndpoint);

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

    this.client?.logger?.info(`Browser launched with CDP on port ${CDP_PORT}`);
  }

  /**
   * Connects to an existing browser instance.
   */
  private async connectToBrowser(wsEndpoint: string): Promise<void> {
    this.client?.logger?.info('Connecting to existing browser instance...');

    const browser = await this.playwright.chromium.connectOverCDP(wsEndpoint);
    
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      this.client?.logger?.info('Connected to existing browser');
    } else {
      throw new Error('No context available in connected browser');
    }
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
        this.client?.logger?.info('Browser closed');
      } catch (e) {
        this.client?.logger?.error('Error closing browser:', e);
      }
    }
    this.context = null;
  }
}
