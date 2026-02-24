import { type Plugin, tool } from "@opencode-ai/plugin";
import { BrowserManager } from "./BrowserManager.js";

type PlaywrightModule = typeof import("playwright");

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

let globalManager: BrowserManager | null = null;

export const WebfetchPlugin: Plugin = async () => {
  const WebfetchTool = tool({
    description: "Fetch a webpage's main content and interact with it. Useful for getting information from URLs. If blocked by login or captchas, the tool will automatically pause and prompt the human user to complete the necessary actions, allowing you to access protected content. Use this to read documentation, search results, articles, and explore deep web pages.",
    args: {
      url: tool.schema.string().describe("The URL to fetch. Can also be a search query which will be converted to a Google Search URL."),
      timeout: tool.schema
        .number()
        .min(5)
        .max(120)
        .optional()
        .describe("Timeout in seconds (default: 30, max: 120)"),
    },
    async execute(params: any, ctx: any) {
      if (!globalManager) {
        const playwright = await loadPlaywright();
        globalManager = new BrowserManager(playwright);
      }
      
      const manager = globalManager;
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

        const markdownResult = await manager.fetchWebpage(targetUrl, timeoutMs, ctx.abort);

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

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch (error) {
    try {
      // @ts-ignore
      return await import("/tmp/node_modules/playwright");
    } catch {
      throw new Error(
        "webfetch plugin requires Playwright. Install it with: bun install playwright && bunx playwright install chromium",
        { cause: error },
      );
    }
  }
}

export default WebfetchPlugin;
