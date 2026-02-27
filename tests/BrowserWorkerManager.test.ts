import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWorkerManager } from '../src/BrowserWorkerManager.js';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  fork: vi.fn(),
}));

describe('BrowserWorkerManager', () => {
  let manager: BrowserWorkerManager;
  let mockClient: any;
  let mockWorker: ChildProcess & EventEmitter;
  let fork: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const childProcess = await import('child_process');
    fork = childProcess.fork;

    mockClient = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      tui: {
        showToast: vi.fn(),
      },
    };

    mockWorker = new EventEmitter() as ChildProcess & EventEmitter;
    (mockWorker as any).send = vi.fn((msg: any, sendHandle?: any, options?: any, callback?: any) => {
      const cb = typeof sendHandle === 'function' ? sendHandle : 
                 typeof options === 'function' ? options : 
                 typeof callback === 'function' ? callback : null;
      if (cb) cb(null);
      return true;
    });
    mockWorker.kill = vi.fn();
    mockWorker.stderr = new EventEmitter() as any;

    fork.mockReturnValue(mockWorker);

    manager = new BrowserWorkerManager(mockClient);
  });

  afterEach(async () => {
    if (manager && mockWorker) {
      mockWorker.kill();
      (manager as any).worker = null;
      (manager as any).pendingRequests.clear();
    }
  });

  it('should handle worker lifecycle and concurrent requests', async () => {
    // Start two concurrent requests
    const request1 = manager.sendRequest({
      type: 'fetch',
      url: 'https://example.com',
      timeout: 30000,
    });

    const request2 = manager.sendRequest({
      type: 'fetch',
      url: 'https://google.com',
      timeout: 30000,
    });

    // Simulate worker ready
    setTimeout(() => {
      mockWorker.emit('message', { type: 'ready' });
    }, 10);

    // Simulate responses
    setTimeout(() => {
      mockWorker.emit('message', {
        id: 'req-1',
        success: true,
        data: 'content1',
      });
      mockWorker.emit('message', {
        id: 'req-2',
        success: true,
        data: 'content2',
      });
    }, 20);

    const [result1, result2] = await Promise.all([request1, request2]);

    // Verify worker started with correct config
    expect(fork).toHaveBeenCalledWith(
      expect.stringContaining('browser-worker.ts'),
      [],
      expect.objectContaining({
        execPath: 'node',
        execArgv: ['--import', 'tsx'],
      })
    );

    // Verify concurrent requests handled correctly
    expect(result1).toBe('content1');
    expect(result2).toBe('content2');
    expect(fork).toHaveBeenCalledTimes(1); // Worker reused
  });
});
