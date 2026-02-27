import { BrowserServer } from '../../src/BrowserServer.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser-9222.lock');

function cleanupLockFile() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (e) {
      // ignore
    }
  }
}

async function main() {
  const action = process.argv[2] as 'set' | 'get';
  
  const playwright = await import('playwright');
  const client = { logger: console };
  
  cleanupLockFile();
  
  const server = await BrowserServer.getInstance(playwright, client);
  const context = server.getContext();
  
  if (!context) {
    process.send?.({ error: 'No context' });
    process.exit(1);
  }
  
  const page = await context.newPage();
  
  let cookies: Record<string, string> = {};
  
  if (action === 'set') {
    await page.goto('https://httpbin.org/cookies/set/test_cookie/test_value', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
  }
  
  await page.goto('https://httpbin.org/cookies', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  const content = await page.content();
  const bodyMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  if (bodyMatch) {
    try {
      const parsed = JSON.parse(bodyMatch[1].trim());
      cookies = parsed.cookies || parsed;
    } catch (e) {
      // ignore
    }
  }
  
  await page.close();
  
  process.send?.({
    port: 9222,
    cookies
  });
  
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
