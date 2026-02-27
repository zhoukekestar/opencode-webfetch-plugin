import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserManager } from '../src/BrowserManager.js';
import { BrowserServer } from '../src/BrowserServer.js';
import type { ToolContext } from '@opencode-ai/plugin';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser.lock');

describe('BrowserManager - Concurrent Requests', () => {
  let playwright: any;
  let mockClient: any;
  let manager: BrowserManager;

  beforeAll(async () => {
    // Clean up any existing lock
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    
    // Reset singleton
    (BrowserServer as any).instance = null;
    
    // Load playwright
    playwright = await import('playwright');
    
    // Mock client with logger
    mockClient = {
      logger: {
        info: (msg: string) => console.log(`[INFO] ${msg}`),
        warn: (msg: string) => console.warn(`[WARN] ${msg}`),
        error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err),
      },
    };

    manager = new BrowserManager(playwright, mockClient);
  });

  afterAll(async () => {
    await manager.dispose();
    
    // Clean up lock file
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  });

  it('should handle multiple concurrent requests in a single instance', async () => {
    const urls = [
      'https://example.com',
      'https://example.org',
      'https://example.net',
    ];

    // Create mock contexts for each request
    const contexts = urls.map((url) => ({
      abort: new AbortController().signal,
      metadata: (data: any) => {},
    })) as ToolContext[];

    // Execute all requests concurrently
    const startTime = Date.now();
    
    try {
      const results = await Promise.all(
        urls.map((url, index) => 
          manager.fetchWebpage(url, 30000, contexts[index])
        )
      );
      const duration = Date.now() - startTime;

      // Verify all requests completed
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });

      console.log(`✓ Completed ${urls.length} concurrent requests in ${duration}ms`);
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  }, 120000);

  it('should handle sequential requests without issues', async () => {
    const urls = [
      'https://example.com',
      'https://example.org',
    ];

    const context = {
      abort: new AbortController().signal,
      metadata: (data: any) => {},
    } as ToolContext;

    // Execute requests sequentially
    for (const url of urls) {
      const result = await manager.fetchWebpage(url, 30000, context);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    }

    console.log(`✓ Completed ${urls.length} sequential requests`);
  }, 120000);

  it('should handle high concurrency (10 requests)', async () => {
    const urls = Array(10).fill('https://example.com');

    const contexts = urls.map(() => ({
      abort: new AbortController().signal,
      metadata: (data: any) => {},
    })) as ToolContext[];

    const startTime = Date.now();
    const results = await Promise.all(
      urls.map((url, index) => 
        manager.fetchWebpage(url, 30000, contexts[index])
      )
    );
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(10);
    results.forEach((result) => {
    expect(result).toBeTruthy();
    });

    console.log(`✓ Completed 10 concurrent requests in ${duration}ms`);
  }, 180000);
});
