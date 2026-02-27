import { type Plugin, tool } from "@opencode-ai/plugin";
import { fork, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

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

class BrowserWorkerManager {
  private worker: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();
  private client: any;
  private initPromise: Promise<void> | null = null;

  constructor(client: any) {
    this.client = client;
  }

  private async ensureWorker(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.worker) {
      return;
    }

    this.initPromise = this.startWorker();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async startWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.resolve(__dirname, 'browser-worker.ts');
      
      this.client?.logger?.info(`Starting browser worker: ${workerPath}`);
      
      // Use node with tsx to execute TypeScript directly
      this.worker = fork(workerPath, [], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        execPath: 'node',
        execArgv: ['--import', 'tsx'],
      });

      // Forward stderr to logger
      if (this.worker.stderr) {
        this.worker.stderr.on('data', (data) => {
          this.client?.logger?.info(`[Worker] ${data.toString().trim()}`);
        });
      }

      const onReady = (message: any) => {
        if (message && message.type === 'ready') {
          this.worker?.off('message', onReady);
          resolve();
        }
      };

      this.worker.on('message', onReady);

      this.worker.on('message', (message: any) => {
        if (message.type === 'toast') {
          // Forward toast to client
          this.client?.tui?.showToast(message.data);
        } else if (message.id) {
          // Handle response
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            this.pendingRequests.delete(message.id);
            if (message.success) {
              pending.resolve(message.data);
            } else {
              pending.reject(new Error(message.error || 'Unknown worker error'));
            }
          }
        }
      });

      this.worker.on('error', (error) => {
        this.client?.logger?.error('Worker process error:', error);
        reject(error);
      });

      this.worker.on('exit', (code) => {
        this.client?.logger?.warn(`Worker process exited with code ${code}`);
        this.worker = null;
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests.entries()) {
          pending.reject(new Error('Worker process exited'));
        }
        this.pendingRequests.clear();
      });

      // Timeout for worker startup
      setTimeout(() => {
        if (this.initPromise) {
          reject(new Error('Worker startup timeout'));
        }
      }, 10000);
    });
  }

  async sendRequest(request: Omit<WorkerRequest, 'id'>): Promise<any> {
    await this.ensureWorker();

    if (!this.worker) {
      throw new Error('Worker process not available');
    }

    const id = `req-${++this.requestId}`;
    const fullRequest: WorkerRequest = { id, ...request };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.worker!.send(fullRequest, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });

      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, MAX_TIMEOUT + 5000);
    });
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      try {
        await this.sendRequest({ type: 'dispose' });
      } catch (e) {
        this.client?.logger?.warn('Error disposing worker:', e);
      }
      
      this.worker.kill();
      this.worker = null;
    }
    
    this.pendingRequests.clear();
  }
}

let globalWorkerManager: BrowserWorkerManager | null = null;

export const WebfetchPlugin: Plugin = async ({ client }) => {
  const WebfetchTool = tool({
    description: "Fetch a webpage's main content in markdown.",
    args: {
      url: tool.schema.string().describe("The URL to fetch."),
    },
    async execute(params: any, ctx: any) {
      // bun 执行 playwright 会有协议握手的 bug，导致无法连接，所以需要通过 nodejs 来绕过
      // https://github.com/oven-sh/bun/issues/9911
      if (!globalWorkerManager) {
        globalWorkerManager = new BrowserWorkerManager(client);
      }
      
      const manager = globalWorkerManager;
      const timeoutMs = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT);

      const abortHandler = () => {
        manager.dispose().catch(() => undefined);
      };
      ctx.abort.addEventListener("abort", abortHandler, { once: true });

      try {
        let targetUrl = params.url;
        // If it's not a valid URL (e.g., just a string query), convert to Google search
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
        }

        const markdownResult = await manager.sendRequest({
          type: 'fetch',
          url: targetUrl,
          timeout: timeoutMs,
        });

        ctx.metadata({
          title: `Webfetch: ${targetUrl}`,
          metadata: {
            url: targetUrl,
            length: markdownResult.length,
          },
        });

        return markdownResult;
      } catch (error) {
        throw error;
      } finally {
        ctx.abort.removeEventListener("abort", abortHandler);
      }
    },
  });

  return {
    tool: {
      webfetch: WebfetchTool
    }
  };
};

export default WebfetchPlugin;
