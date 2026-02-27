import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type { BrowserContext } from 'playwright';

type PlaywrightModule = typeof import('playwright');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

const CDP_PORT = parseInt(process.env.WEBFETCH_CDP_PORT || '9222', 10);
const USER_DATA_DIR = path.resolve(os.homedir(), `.cache/opencode/user-data-${CDP_PORT}`);
const LAUNCH_SCRIPT = path.resolve(os.homedir(), '.cache/opencode/launch-browser.ts');

export class BrowserServer {
  private static instance: BrowserServer | null = null;
  private static initPromise: Promise<BrowserServer> | null = null;
  private context: BrowserContext | null = null;
  private readonly playwright: PlaywrightModule;
  private readonly client: any;

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

    this.ensureLaunchScript();

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await this.tryConnect()) {
        return;
      }

      this.client?.logger?.info(`Attempt ${attempt}/3: Starting independent browser process...`);
      
      await this.spawnIndependentBrowser();
      
      const waitTime = Math.floor(Math.random() * 3000) + 2000;
      this.client?.logger?.info(`Waiting ${waitTime}ms for browser to start...`);
      await this.sleep(waitTime);

      if (await this.tryConnect()) {
        return;
      }
    }

    throw new Error('Failed to start or connect to browser after 3 attempts');
  }

  private ensureLaunchScript(): void {
    const scriptContent = `import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CDP_PORT = ${CDP_PORT};
const USER_DATA_DIR = path.resolve(os.homedir(), '.cache/opencode/user-data-${CDP_PORT}');

async function main() {
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

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    ignoreDefaultArgs: ['--remote-debugging-pipe'],
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-allow-origins="*"',
      // '--disable-blink-features=AutomationControlled',
      // '--disable-features=VizDisplayCompositor',
      // '--window-size=1280,720',
      '--remote-debugging-port=' + CDP_PORT,
      // ...(extensions.length > 0 ? [
      //   '--disable-extensions-except=' + extensions.join(','),
      //   '--load-extension=' + extensions.join(',')
      // ] : []),
    ],
    viewport: { width: 1280, height: 720 },
  });

  context.on('page', async (page) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      const chrome = (window as any).chrome;
      if (chrome && chrome.runtime && chrome.runtime.onConnect) {
        delete chrome.runtime.onConnect;
      }
    });
  });

  console.log('Browser launched on port ' + CDP_PORT);
}

main().catch(console.error);
`;

    const scriptDir = path.dirname(LAUNCH_SCRIPT);
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    fs.writeFileSync(LAUNCH_SCRIPT, scriptContent);
  }

  private async spawnIndependentBrowser(): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn('npx', ['tsx', LAUNCH_SCRIPT], {
        cwd: PROJECT_DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: true,
      });
      
      child.unref();
      
      child.on('error', (e) => {
        this.client?.logger?.warn(`Failed to spawn browser: ${e.message}`);
      });

      resolve();
    });
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  async dispose(): Promise<void> {
    this.context = null;
  }
}
