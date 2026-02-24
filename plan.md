# 开发计划 (Development Plan)

基于 `research.md` 的架构设计，针对支持人机协同的 `Opencode-Google-AI-Search-Plugin`（现更偏向通用网页读取与交互插件），制定以下分步开发计划：

## 第一阶段：项目初始化与依赖配置 (Project Setup & Dependencies)
1. **清理历史代码**：基于原有项目基础，移除特定于“仅限 Google 搜索”的无头代码，为新的单一入口工具做准备。
2. **安装必要依赖**：
   - 确保 `playwright` 依赖配置正确。
   - 安装内容提取和格式化工具：`turndown`, `@mozilla/readability`（可能需要使用 `jsdom` 或在 Playwright 浏览器上下文中直接执行 Readability）。
   - 安装对应的 TypeScript 类型定义文件。

## 第二阶段：浏览器上下文与生命周期管理 (Browser Context Management)
1. **实现 BrowserManager 类**：
   - 管理单例的浏览器实例。
   - **持久化配置**：使用 `playwright.chromium.launchPersistentContext`，并在项目根目录或指定系统临时目录创建一个 `.userdata` 文件夹，用于存储 Cookies 和 LocalStorage。
   - **有头模式**：默认配置 `headless: false`，确保人类可以随时看到页面内容并进行干预。
   - 处理浏览器的启动、页面标签页的创建以及插件关闭时的清理工作。

## 第三阶段：人机协同挂起/恢复机制 (Human-in-the-Loop Mechanism)
1. **终端交互模块**：利用 Node.js 原生的 `readline` 模块，封装一个 `askForHumanHelp(message)` 函数。该函数会阻塞当前 `Promise`，在终端输出提示信息，并等待用户按下回车键。
2. **状态监测与拦截逻辑**：
   - 页面加载 `goto` 时设置合理的超时时间。
   - （可选/基础版）当 Agent 请求页面时，先尝试加载。如果加载超时，或者通过简单的 URL/DOM 探测发现类似 Cloudflare 的盾、登录墙等特征，主动触发 `askForHumanHelp`。
   - （进阶版）考虑到启发式探测可能不完善，始终提供一个兜底机制：即使没检测到验证码，只要获取不到核心内容，就可以让用户决定是否介入。

## 第四阶段：页面内容提取与降噪 (Content Extraction & Formatting)
1. **核心提取逻辑**：在页面加载完成（或人类接管并确认完成后），注入 `@mozilla/readability` 脚本到页面中执行，或者提取 HTML 到 Node 端处理。Readability 能有效去除广告、侧边栏和导航。
2. **Markdown 转换**：将 Readability 提取出的纯净 HTML片段传递给 `turndown`，转换为高质量的 Markdown 文本，极大降低 LLM Token 消耗。

## 第五阶段：核心工具注册与整合 (Opencode Tool Registration)
1. **重构 `src/index.ts`**：
   - 清除原有针对 Google 搜索的多个特定工具。
   - 仅注册一个核心工具：`webfetch`。
   - **工具参数**：`url`（必填，目标网址）和 `query`（可选，如果不提供 URL 则作为搜索引擎的搜索词处理）。
2. **串联流程**：
   - Agent 调用 `webfetch` -> 检查/启动 BrowserManager -> 新建 Tab 打开 URL -> 检测是否需要人类协助 -> （如果需要）终端挂起并等待人类回车 -> 获取页面 DOM -> Readability + Turndown 转换 -> 返回 Markdown 结果给 Agent。

## 第六阶段：测试与调优 (Testing & Refinement)
1. 测试正常网页抓取（如 Wikipedia、GitHub 项目页）。
2. 测试拦截验证网页（手动寻找一个带有 Cloudflare 验证或必须登录的页面，验证挂起机制和回车恢复机制）。
3. 测试异常处理和容错机制（如用户强行关闭了浏览器窗口等情况的处理）。

---

请确认以上开发计划是否符合您的预期？如果确认无误，我们将进入第一阶段的编码工作。