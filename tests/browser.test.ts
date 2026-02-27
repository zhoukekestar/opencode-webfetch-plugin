import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserServer } from '../src/BrowserServer.js';
import { BrowserManager } from '../src/BrowserManager.js';
import { fork } from 'child_process';
import * as path from 'path';

async function getPlaywright() {
  return await import('playwright');
}

function resetBrowserServerSingleton() {
  (BrowserServer as any).instance = null;
  (BrowserServer as any).initPromise = null;
}

describe('Browser Tests', () => {
  beforeAll(() => {
    resetBrowserServerSingleton();
  });

  afterAll(async () => {
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

  it('should share browser between two independent processes', async () => {
    const workerScript = path.join(__dirname, 'helpers', 'cookie-worker.ts');
    
    const runWorker = (action: string): Promise<{ content: string }> => {
      return new Promise((resolve, reject) => {
        const child = fork(workerScript, [action], {
          execArgv: ['--import', 'tsx'],
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        
        let stdout = '';
        child.stdout?.on('data', (data) => { stdout += data; });
        child.stderr?.on('data', (data) => { console.log(`[worker stderr] ${data}`); });
        
        child.on('message', (result: { content: string }) => {
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
    
    const res = await runWorker('https://example.com');
    expect(res.content).toContain('Example Domain');

    const [result1, result2] = await Promise.all([runWorker('https://example.com'), runWorker('https://httpbin.org/html')]); 

    // console.log(result1)
    // console.log(result2)
    expect(result1.content).toContain('Example Domain');
    expect(result2.content).toContain('httpbin.org');
    // expect(result1.port).toBe(9222);
    // expect(result1.cookies).toHaveProperty('test_cookie', 'test_value');
    
    // // const result2 = await runWorker('get');
    // expect(result2.port).toBe(9222);
    // expect(result2.cookies).toHaveProperty('test_cookie', 'test_value');
  });
});
