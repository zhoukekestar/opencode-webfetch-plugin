#!/usr/bin/env node
/**
 * Browser Worker Process
 * Runs in Node.js to avoid Bun's connectOverCDP issues
 * Communicates with parent process via IPC
 */

import { BrowserManager } from './BrowserManager.js';

type PlaywrightModule = typeof import('playwright');

interface WorkerRequest {
  id: string;
  type: 'fetch' | 'dispose';
  url?: string;
  timeout?: number;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: string;
  error?: string;
}

let globalManager: BrowserManager | null = null;
let playwright: PlaywrightModule | null = null;

// Mock client for worker process
const workerClient = {
  logger: {
    info: (msg: string) => console.error(`[Worker Info] ${msg}`),
    warn: (msg: string) => console.error(`[Worker Warn] ${msg}`),
    error: (msg: string, err?: any) => console.error(`[Worker Error] ${msg}`, err),
  },
  tui: {
    showToast: (opts: any) => {
      // Send toast request to parent
      sendToParent({ type: 'toast', data: opts });
    }
  }
};

// Mock ToolContext for worker
function createMockContext(): any {
  const abortController = new AbortController();
  return {
    abort: abortController.signal,
    metadata: () => {},
  };
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      'webfetch plugin requires Playwright. Install it with: npm install playwright && npx playwright install chromium',
      { cause: error },
    );
  }
}

async function handleRequest(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (req.type === 'fetch') {
      if (!req.url) {
        throw new Error('URL is required for fetch request');
      }

      if (!globalManager) {
        playwright = await loadPlaywright();
        globalManager = new BrowserManager(playwright, workerClient);
      }

      const timeout = req.timeout || 30000;
      const ctx = createMockContext();
      const markdown = await globalManager.fetchWebpage(req.url, timeout, ctx);

      return {
        id: req.id,
        success: true,
        data: markdown,
      };
    } else if (req.type === 'dispose') {
      if (globalManager) {
        await globalManager.dispose();
        globalManager = null;
      }
      return {
        id: req.id,
        success: true,
      };
    } else {
      throw new Error(`Unknown request type: ${(req as any).type}`);
    }
  } catch (error: any) {
    return {
      id: req.id,
      success: false,
      error: error.message || String(error),
    };
  }
}

function sendToParent(message: any): void {
  if (process.send) {
    process.send(message);
  }
}

// Listen for messages from parent process
process.on('message', async (message: any) => {
  if (message && typeof message === 'object' && message.id) {
    const response = await handleRequest(message as WorkerRequest);
    sendToParent(response);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  if (globalManager) {
    await globalManager.dispose().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (globalManager) {
    await globalManager.dispose().catch(() => {});
  }
  process.exit(0);
});

// Signal ready
sendToParent({ type: 'ready' });
