import { type Plugin, tool } from "@opencode-ai/plugin";
import { BrowserWorkerManager } from './BrowserWorkerManager.js';

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

let globalWorkerManager: BrowserWorkerManager | null = null;

export const WebfetchPlugin: Plugin = async ({ client }) => {
  const WebfetchTool = tool({
    description: "Fetch a webpage's main content in markdown.",
    args: {
      url: tool.schema.string().describe("The URL to fetch."),
    },
    async execute(params: any, ctx: any) {
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
