import { chromium } from 'playwright';
await chromium.launchPersistentContext('/Users/zkk/.cache/opencode/user-data-9222', {
    executablePath: '/Users/zkk/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    
    // 1. 关键：禁用默认注入的 pipe 参数
    // ignoreDefaultArgs: ['--remote-debugging-pipe'],

    // ignoreDefaultArgs: true,
    
    // 2. 关键：手动注入端口和跨域允许参数
    args: [
      '--remote-debugging-port=9222',
      '--remote-allow-origins=*', // 必须加，否则 connectOverCDP 握手会失败

      // 强制开启调试日志输出，有助于 Playwright 捕获就绪信号
    '--enable-logging',
    '--v=1',
    ],
    
    headless: false, // 保持有头模式以便观察
  });

console.log('hi')