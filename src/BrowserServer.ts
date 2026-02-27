import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import type { BrowserContext } from 'playwright';

type PlaywrightModule = typeof import('playwright');

const CDP_PORT = parseInt(process.env.WEBFETCH_CDP_PORT || '9222', 10);
const USER_DATA_DIR = path.resolve(os.homedir(), `.cache/opencode/user-data-${CDP_PORT}`);

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

  private async initialize(): Promise<void> {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    if (await this.tryConnect()) {
      return;
    }

    await this.launchBrowser();
  }

  private async tryConnect(): Promise<boolean> {
    if (!(await this.isPortInUse(CDP_PORT))) {
      return false;
    }

    try {
      await this.connectToBrowser(`http://localhost:${CDP_PORT}`);
      return true;
    } catch (e) {
      this.client?.logger?.warn(`Failed to connect: ${e}`);
      return false;
    }
  }

  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/json/version',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        resolve(res.statusCode === 200);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    });
  }

  private async launchBrowser(): Promise<void> {
    this.client?.logger?.info('Launching new browser instance...');

    const singletonLock = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(singletonLock)) {
      fs.unlinkSync(singletonLock);
    }

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
    this.isOwner = true;

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

  private async connectToBrowser(wsEndpoint: string): Promise<void> {
    this.client?.logger?.info(`Connecting to browser at ${wsEndpoint}...`);

    const browser = await this.playwright.chromium.connectOverCDP(wsEndpoint);
    
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      this.client?.logger?.info('Connected to existing browser');
    } else {
      throw new Error('No context available in connected browser');
    }
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  isOwnerProcess(): boolean {
    return this.isOwner;
  }

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
    this.isOwner = false;
  }
}
