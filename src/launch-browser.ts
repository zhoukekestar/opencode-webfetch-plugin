import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CDP_PORT = parseInt(process.env.WEBFETCH_CDP_PORT || '9222', 10);
const USER_DATA_DIR = path.resolve(os.homedir(), `.cache/opencode/user-data-${CDP_PORT}`);

async function main() {
  const singletonLock = path.join(USER_DATA_DIR, 'SingletonLock');
  if (fs.existsSync(singletonLock)) {
    fs.unlinkSync(singletonLock);
  }

  const extensionPath = path.resolve('./extensions');
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
      ...(extensions.length > 0 ? [
        '--disable-extensions-except=' + extensions.join(','),
        '--load-extension=' + extensions.join(',')
      ] : []),
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