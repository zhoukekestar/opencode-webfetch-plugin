import { BrowserManager } from '../../src/BrowserManager.js'

async function main () {
  const action = process.argv[2]

  const playwright = await import('playwright')
  const client = { logger: console }

  const manager = new BrowserManager(playwright, client)
  // const server = await (manager as any).ensureBrowserServer();
  // const context = server.getContext();

  // if (!context) {
  //   process.send?.({ error: 'No context' });
  //   process.exit(1);
  // }

  // const page = await context.newPage();

  // let cookies: Record<string, string> = {};

  let content = await manager.fetchWebpage(action, 3000, {
    abort: new AbortController().signal
  } as any)

  // await page.goto('https://httpbin.org/cookies', { waitUntil: 'domcontentloaded' });
  // await page.waitForTimeout(1000);

  // const content = await page.content();
  // const match = content.match(/{\s*"cookies":\s*({[^}]*})\s*}/)
  // if (match) {
  //   try {
  //     cookies = JSON.parse(match[1])
  //   } catch (e) {
  //     // ignore
  //   }
  // }

  // await page.close()

  process.send?.({
    content
  })

  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
