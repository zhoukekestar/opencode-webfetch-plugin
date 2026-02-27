import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserServer } from '../src/BrowserServer.js';
import { BrowserManager } from '../src/BrowserManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fork } from 'child_process';

const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser-9222.lock');

async function getPlaywright() {
  return await import('playwright');
}

function cleanupLockFile() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (e) {
      // ignore
    }
  }
}

function resetBrowserServerSingleton() {
  (BrowserServer as any).instance = null;
  (BrowserServer as any).initPromise = null;
}

describe('Browser Tests', () => {
  beforeAll(() => {
    cleanupLockFile();
    resetBrowserServerSingleton();
  });

  afterAll(async () => {
    cleanupLockFile();
    resetBrowserServerSingleton();
  });

  it('should fetch two pages concurrently in the same browser instance', async () => {
    const playwright = await getPlaywright();
    const client = { logger: console };
    
    const manager = new BrowserManager(playwright, client);
    
    const [result1, result2] = await Promise.all([
      manager.fetchWebpage('https://example.com', 30000, { abort: new AbortController().signal } as any),
      manager.fetchWebpage('https://httpbin.org/html', 30000, { abort: new AbortController().signal } as any),
    ]);
    
    expect(result1).toContain('Example Domain');
    expect(result2).toContain('httpbin.org');
  });

  it('should share cookies between two independent processes on port 9222', async () => {
    const workerScript = path.join(__dirname, 'helpers', 'cookie-worker.ts');
    
    const runWorker = (action: 'set' | 'get'): Promise<{ port: number; cookies: Record<string, string> }> => {
      return new Promise((resolve, reject) => {
        const child = fork(workerScript, [action], {
          execArgv: ['--import', 'tsx'],
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        
        let stdout = '';
        child.stdout?.on('data', (data) => { stdout += data; });
        child.stderr?.on('data', (data) => { console.log(`[worker stderr] ${data}`); });
        
        child.on('message', (result: { port: number; cookies: Record<string, string> }) => {
          resolve(result);
          child.disconnect();
        });
        
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}: ${stdout}`));
          }
        });
      });
    };
    
    const result1 = await runWorker('set');
    expect(result1.port).toBe(9222);
    expect(result1.cookies).toHaveProperty('test_cookie', 'test_value');
    
    const result2 = await runWorker('get');
    expect(result2.port).toBe(9222);
    expect(result2.cookies).toHaveProperty('test_cookie', 'test_value');
  });
});
