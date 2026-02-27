import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserServer } from '../src/BrowserServer.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser.lock');

describe('BrowserServer - Shared Browser Instance', () => {
  let playwright: any;
  let mockClient: any;

  beforeAll(async () => {
    playwright = await import('playwright');
    mockClient = {
      logger: {
        info: (msg: string) => console.log(`[INFO] ${msg}`),
        warn: (msg: string) => console.warn(`[WARN] ${msg}`),
        error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err),
      },
    };

    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  });

  afterAll(async () => {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  });

  it('should launch browser and store WebSocket endpoint', async () => {
    const server = await BrowserServer.getInstance(playwright, mockClient);
    
    expect(fs.existsSync(LOCK_FILE)).toBe(true);
    const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    expect(lockData.wsEndpoint).toBeTruthy();
    expect(lockData.pid).toBe(process.pid);
    
    expect(server.isOwnerProcess()).toBe(true);
    
    console.log(`Browser launched with WebSocket endpoint: ${lockData.wsEndpoint}`);
    
    await server.dispose();
  }, 60000);

  it('should reuse existing browser instance within same process', async () => {
    (BrowserServer as any).instance = null;
    
    const server1 = await BrowserServer.getInstance(playwright, mockClient);
    expect(server1.isOwnerProcess()).toBe(true);
    
    const server2 = await BrowserServer.getInstance(playwright, mockClient);
    expect(server2).toBe(server1);
    expect(server2.isOwnerProcess()).toBe(true);
    
    console.log('Browser instance reused correctly');
    
    await server1.dispose();
  }, 60000);

  it('should provide valid browser context', async () => {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    (BrowserServer as any).instance = null;
    
    const server = await BrowserServer.getInstance(playwright, mockClient);
    const context = server.getContext();
    
    expect(context).toBeTruthy();
    expect(context).not.toBeNull();
    
    const page = await context!.newPage();
    expect(page).toBeTruthy();
    
    await page.close();
    await server.dispose();
    
    console.log('Browser context is valid');
  }, 60000);

  it('should allow multiple pages without interference', async () => {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    (BrowserServer as any).instance = null;
    
    const server = await BrowserServer.getInstance(playwright, mockClient);
    const context = server.getContext();
    
    const page1 = await context!.newPage();
    const page2 = await context!.newPage();
    const page3 = await context!.newPage();
    
    await Promise.all([
      page1.goto('https://example.com'),
      page2.goto('https://example.org'),
      page3.goto('https://example.net'),
    ]);
    
    expect(page1.url()).toContain('example.com');
    expect(page2.url()).toContain('example.org');
    expect(page3.url()).toContain('example.net');
    
    await page1.close();
    await page2.close();
    await page3.close();
    await server.dispose();
    
    console.log('Multiple pages work without interference');
  }, 120000);
});
