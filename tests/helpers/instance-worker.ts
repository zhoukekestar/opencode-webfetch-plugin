import { BrowserManager } from '../../src/BrowserManager.js';

async function main() {
  const workerId = process.argv[2] || 'unknown';
  
  try {
    console.log(`Worker ${workerId} starting...`);
    
    // Load playwright
    const playwright = await import('playwright');
    
    // Mock client
    const mockClient = {
      logger: {
        info: (msg: string) => console.log(`[${workerId}] ${msg}`),
        warn: (msg: string) => console.warn(`[${workerId}] ${msg}`),
        error: (msg: string, err?: any) => console.error(`[${workerId}] ${msg}`, err),
      },
    };

    const manager = new BrowserManager(playwright, mockClient);

    // Mock context
    const context = {
      abort: new AbortController().signal,
      metadata: (data: any) => {},
    } as any;

    // Fetch a simple page
    const result = await manager.fetchWebpage('https://example.com', 30000, context);
    
    if (result && result.length > 0) {
      console.log(`Worker ${workerId} SUCCESS - fetched ${result.length} bytes`);
      process.exit(0);
    } else {
      console.error(`Worker ${workerId} FAILED - empty result`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Worker ${workerId} ERROR:`, error);
    process.exit(1);
  }
}

main();
