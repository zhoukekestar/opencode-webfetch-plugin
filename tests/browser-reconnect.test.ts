import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserServer } from '../src/BrowserServer.js';
import { BrowserManager } from '../src/BrowserManager.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getPlaywright() {
  return await import('playwright');
}

function resetBrowserServerSingleton() {
  (BrowserServer as any).instance = null;
  (BrowserServer as any).initPromise = null;
}

async function killBrowserProcess(port: number): Promise<void> {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await execAsync(`ps aux | grep -E "chromium.*--remote-debugging-port=${port}" | grep -v grep`);
      const lines = stdout.trim().split('\n').filter(Boolean);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[1];
        if (pid && /^\d+$/.test(pid)) {
          try {
            await execAsync(`kill -9 ${pid}`);
            console.log(`Killed Chromium process ${pid} on port ${port}`);
          } catch (e) {
            console.log(`Failed to kill process ${pid}: ${e}`);
          }
        }
      }
    } else if (process.platform === 'win32') {
      const { stdout } = await execAsync(`wmic process where "commandline like '%chromium%' and commandline like '%${port}%'" get processid`);
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const pid = line.trim();
        if (pid && /^\d+$/.test(pid)) {
          try {
            await execAsync(`taskkill /F /PID ${pid}`);
            console.log(`Killed Chromium process ${pid} on port ${port}`);
          } catch (e) {
            console.log(`Failed to kill process ${pid}: ${e}`);
          }
        }
      }
    }
  } catch (e) {
    console.log(`No Chromium process found on port ${port} or error: ${e}`);
  }
}

describe('Browser Reconnect Tests', () => {
  beforeAll(() => {
    resetBrowserServerSingleton();
  });

  afterAll(async () => {
    resetBrowserServerSingleton();
    await killBrowserProcess(9222);
  });

  it('should successfully reconnect after browser process is killed', async () => {
    const playwright = await getPlaywright();
    const client = { 
      logger: {
        info: (msg: string) => console.log(`[Info] ${msg}`),
        warn: (msg: string) => console.log(`[Warn] ${msg}`),
        error: (msg: string, err?: any) => console.log(`[Error] ${msg}`, err),
      }
    };
    
    const manager = new BrowserManager(playwright, client);
    
    console.log('Step 1: Initial fetch...');
    const result1 = await manager.fetchWebpage('https://example.com', 30000, { abort: new AbortController().signal } as any);
    expect(result1).toContain('Example Domain');
    console.log('First fetch successful');
    
    console.log('Step 2: Killing browser process on port 9222...');
    await killBrowserProcess(9222);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Step 3: Fetch again after browser killed...');
    const result2 = await manager.fetchWebpage('https://httpbin.org/html', 30000, { abort: new AbortController().signal } as any);
    expect(result2).toContain('httpbin.org');
    console.log('Second fetch successful - browser reconnected!');
    
    await manager.dispose();
  }, 120000);
});