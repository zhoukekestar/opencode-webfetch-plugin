// // const { chromium } = require('playwright');
import { BrowserServer } from './src/BrowserServer';
import { BrowserManager } from './src/BrowserManager';
async function getPlaywright() {
  return await import('playwright');
}

// function resetBrowserServerSingleton() {
//   BrowserServer.instance = null;
//   BrowserServer.initPromise = null;
// }

const sleep = (ms: any) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

(async () => {
  try {

    // resetBrowserServerSingleton();
     const playwright = await getPlaywright();
     const { chromium } = playwright;
    const client = { logger: console };
    
    const manager = new BrowserManager(playwright, client);
    const c = await manager.fetchWebpage('https://example.com', 30000, { abort: new AbortController().signal } as any);
    console.log(c);


    // const { chromium } = require('playwright');



  console.log('....')


  await sleep(2000);


    console.log('尝试连接...');
    // const playwright = await getPlaywright();
    // const { chromium } = playwright;
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', {
      timeout: 3000 // 设置10秒超时
    });
    console.log('成功连接！');
    
    // 获取已有的上下文和页面
    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log(`当前浏览器共有 ${pages.length} 个标签页`);
    
    await browser.close();
  } catch (err) {
    console.error('连接失败详情：', err);
  }
})();