import { describe, it, expect, afterEach } from 'vitest';
import { BrowserWorkerManager } from '../src/BrowserWorkerManager.js';

describe('BrowserWorkerManager', () => {
  let manager: BrowserWorkerManager | null = null;

  afterEach(async () => {
    if (manager) {
      await manager.dispose().catch(() => {});
      manager = null;
    }
  });

  it('should handle worker lifecycle and concurrent requests', async () => {
    const mockClient = {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      tui: {
        showToast: () => {},
      },
    };

    manager = new BrowserWorkerManager(mockClient);

    // Send two concurrent fetch requests
    const [result1, result2] = await Promise.all([
      manager.sendRequest({
        type: 'fetch',
        url: 'https://example.com',
        timeout: 30000,
      }),
      manager.sendRequest({
        type: 'fetch',
        url: 'https://httpbin.org/html',
        timeout: 30000,
      }),
    ]);

    // Verify both requests returned markdown content
    expect(result1).toContain('Example Domain');
    expect(result2).toContain('httpbin');
    
    // Verify worker can be disposed
    await manager.dispose();
  }, 60000);
});
