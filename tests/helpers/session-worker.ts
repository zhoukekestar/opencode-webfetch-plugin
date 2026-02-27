import { BrowserManager } from '../../src/BrowserManager.js';

async function main() {
  const mode = process.argv[2] || 'set';
  
  try {
    console.log(`Session worker (${mode}) starting...`);
    
    // Load playwright
    const playwright = await import('playwright');
    
    // Mock client
    const mockClient = {
      logger: {
        info: (msg: string) => console.log(`[${mode}] ${msg}`),
        warn: (msg: string) => console.warn(`[${mode}] ${msg}`),
        error: (msg: string, err?: any) => console.error(`[${mode}] ${msg}`, err),
      },
    };

    const manager = new BrowserManager(playwright, mockClient);

    // Mock context
    const context = {
      abort: new AbortController().signal,
      metadata: (data: any) => {},
    } as any;

    if (mode === 'set') {
      // Navigate to httpbin to set a cookie
      const result = await manager.fetchWebpage('https://httpbin.org/cookies/set?test=value123', 30000, context);
      
      if (result && result.length > 0) {
        console.log(`Session set SUCCESS - cookies should be stored`);
        process.exit(0);
      } else {
        console.error(`Session set FAILED`);
        process.exit(1);
      }
    } else if (mode === 'verify') {
      // Check if cookie persists
      const result = await manager.fetchWebpage('https://httpbin.org/cookies', 30000, context);
      
      if (result && result.includes('test') && result.includes('value123')) {
        console.log(`Session verify SUCCESS - cookies persisted across instances`);
        process.exit(0);
      } else {
        console.error(`Session verify FAILED - cookies not found`);
        console.error(`Result: ${result.substring(0, 500)}`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`Session worker (${mode}) ERROR:`, error);
    process.exit(1);
  }
}

main();
