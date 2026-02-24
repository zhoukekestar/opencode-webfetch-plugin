# 针对 Opencode 人机协同交互式浏览器插件的技术调研

## 背景与目标

当前参考项目 `Opencode-Google-AI-Search-Plugin` 展示了如何利用 `@opencode-ai/plugin` 机制封装 Playwright 进行自动化 Google 搜索（无头模式 `headless: true`）。但这种方式面临一个严重问题：**当遇到反爬虫机制（如 Google 的 CAPTCHA）、需要登录才能访问的网页时，Agent 会直接失败（抛出异常）。**

本调研旨在设计一个**支持人机协同、可持久化、高度可控**的 Opencode 浏览器控制插件。Agent（如 LLM）可以通过该插件调度浏览器进行信息检索和操作，同时在遇到拦截或需要授权时，允许人类接管浏览器完成验证或登录操作，随后交还控制权给 Agent。

## 1. 核心技术选型

### 1.1 浏览器引擎控制框架：Playwright 
**推荐使用 Playwright 而非 Puppeteer**。
- **原因**：当前 Opencode 已有通过 `peerDependencies` 使用 Playwright 的基础。Playwright 支持更现代的 Web 特性、多浏览器引擎（Chromium, Firefox, WebKit），且在处理跨域（iframe）和等待机制（Auto-waiting）上比 Puppeteer 更智能。
- **实现方式**：可以继续采用动态导入 `import("playwright")` 结合 `/tmp/node_modules/playwright` 的后备机制。

### 1.2 浏览器运行模式：Persistent Context (持久化上下文) 与有头模式
当前的 Google 搜索插件每次调用启动的是临时会话（无持久化），且是无头模式（`headless: true`）。
针对我们的新需求，需要做以下改动：
- **Headless 模式切换**：默认可以后台运行，但必须支持开启 `headless: false`（有头模式），从而让用户能看到界面进行登录、过验证码等操作。
- **持久化数据 (userDataDir)**：必须使用 `playwright.chromium.launchPersistentContext(userDataDir, options)` 替代普通的 `launch`。这样用户的登录状态、Cookies、LocalStorage 都会被保存到本地硬盘。下次启动 Agent 时，不再需要重新登录。

## 2. 架构设计与交互流程

### 2.1 基础架构
插件应在初始化时维护一个全局单例的 Browser Context（持久化），并在其上暴露一组供 Agent 使用的 Tools (函数集)。

### 2.2 核心暴露工具 (Tools) 规划
针对 Opencode 的 Agent，为了最大化保持 Agent 职责单一且减少不可控的自动化失败（如复杂的 DOM 变化、验证码、登录墙），我们**仅对外暴露一个核心 Tool**：

1. `webfetch(url_or_query)`: 获取指定网页的最终渲染内容或执行搜索。
   - **输入**: 一个 URL，或者一个搜索关键词（插件内部可将其转化为特定搜索引擎的 URL）。
   - **输出**: 该网页（或搜索结果页面）的主体内容，通常转换为高质量的 Markdown 格式，去除了广告、导航栏等噪音。

**设计理念**：所有复杂的中间过程（如登录、重定向、CAPTCHA 人机验证、甚至翻页寻找特定信息）**均不由 Agent 自动处理，而是由插件内部拦截并转移给人类执行**。

### 2.3 人机验证 (Human-in-the-loop) 机制设计
当 Agent 调用 `webfetch` 请求一个页面时，插件内部的执行流程如下：

1. **发起请求**：插件使用 Playwright 打开目标 URL。
2. **状态监测**：插件监听页面加载后的状态。如果检测到以下情况（可通过 URL 变化、特定元素出现等启发式规则判断）：
   - 被重定向到了登录页面（如 `/login`, `auth0.com` 等）。
   - 出现了典型的反爬虫挑战（如 Cloudflare 的 "Checking your browser..."，Google 的 CAPTCHA）。
   - 页面迟迟未加载出���期的主体内容。
3. **人类接管**：
   - 插件主动**挂起**当前 `webfetch` 的 Promise。
   - 插件在 Opencode 终端输出高亮提示：“[需要人类协助] 访问 `https://xxx` 遇到障碍（如登录/验证码）。请在弹出的浏览器窗口中完成操作，获取到最终目标页面后，在终端按回车键继续...”。
   - （可选）如果浏览器窗口在后台，插件尝试将其唤起至前台。
4. **人类操作**：人类在真实的浏览器窗口中输入账号密码、点选验证码、甚至手动点击搜索结果跳转到目标详情页。
5. **恢复与提取**：
   - 人类确认操作完成并在终端按下回车。
   - 插件恢复 Promise 的执行，此时直接提取**当前浏览器所处页面**的 DOM 结构。
   - 将提取的 HTML 通过 `turndown`（结合 Readability 算法）转换为 Markdown，并返回给 Agent。

这种设计将最困难的“导航和越权”交给了人类，而 Agent 只需专注于“提出需求 (`webfetch`)”和“分析结果 (Markdown)”。

## 3. 技术难点与解决方案

### 3.1 动态 Headless 切换的局限
**痛点**：Playwright 启动后无法动态切换无头和有头模式。一直开着有头模式（弹出窗口）会打扰用户正常的编码工作。
**解决方案**：
1. **方案 A (默认有头并最小化)**：使用 `headless: false`，但通过参数/系统命令将其启动时最小化或放置在后台。
2. **方案 B (CDP Attach - 推荐)**：用户自己电脑上开一个开启了 debug 端口的 Chrome (`chrome.exe --remote-debugging-port=9222`)。插件不去 `launch` 浏览器，而是通过 `playwright.chromium.connectOverCDP('http://localhost:9222')` 接入。这样用户平时就在这个 Chrome 里正常上网、保持登录，Agent 在后台操控新建的 Tab。当需要验证时，用户切到该 Tab 即可。

### 3.2 页面内容的 Markdown 提取
为了让大模型 (LLM) 高效阅读网页，不能直接返回完整 HTML（Token 消耗极大且噪音多）。
**解决方案**：
参考原项目，使用 `turndown` 库，并结合 Playwright 的 `page.evaluate()` 清理不必要的 script、style、nav、footer 等标签，提取主体内容的文本。可以结合 Mozilla 的 `Readability.js` 来提取核心正文。

### 3.3 状态管理与防卡死
**痛点**：网络状况差或者死链会导致 Agent 长时间等待。
**解决方案**：
所有的 Tool 调用（`goto`, `click`）必须设置合理的 `timeout`。当发生超时时，捕获异常并告诉 Agent "Timeout occurred"，让 Agent 决定是重试、放弃还是请求人类帮助。

## 5. 总结

实现这样一个支持人机协作的 Opencode 浏览器插件在技术上是完全可行的。最核心的转变在于从**"一次性的无头自动化脚本"**转变为**"长期存活的、由人类和 Agent 共享的持久化浏览器上下文"**。通过赋予 Agent 遇到障碍时主动寻求人类帮助的能力，将极大拓宽该插件在复杂网络环境（反爬、强登录态网站）下的应用边界。