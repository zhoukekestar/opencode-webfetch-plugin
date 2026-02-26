# Agent Guidelines for Opencode Google AI Search Plugin

This document provides coding agents with essential information about the project structure, build commands, and code style conventions.

## Project Overview

This is an Opencode plugin that provides a `webfetch` tool for fetching webpage content in markdown format. It uses Playwright for browser automation, handles captchas and login screens through human-in-the-loop interaction, and converts HTML to markdown using Readability and Turndown.

**Key Technologies:**
- TypeScript (ES2022, ESM modules)
- Playwright (peer dependency)
- @opencode-ai/plugin SDK
- JSDOM + Readability for content extraction
- Turndown for HTML-to-Markdown conversion

## Build Commands

### Installation
```bash
bun install
# or
npm install
```

### Build
```bash
bun run build
# or
npm run build
```

This compiles TypeScript from `src/` to `dist/` with ESM output, type declarations, and source maps.

### Clean
```bash
bun run clean
# or
npm run clean
```

Removes the `dist/` folder.

### Playwright Setup
```bash
bun install playwright
npx playwright install chromium
```

**Note:** There are currently no test or lint scripts defined in package.json. If adding tests, use a test runner compatible with ESM modules.

## Project Structure

```
src/
├── index.ts              # Plugin entry point, tool registration
├── BrowserManager.ts     # Browser lifecycle, navigation, blocker detection
├── Extractor.ts          # Content extraction and markdown conversion
└── HumanInteractor.ts    # Human-in-the-loop interaction for captchas/logins
```

## Code Style Guidelines

### Module System
- **Type:** ES2022 modules (`"type": "module"` in package.json)
- **Imports:** Always use `.js` extension for local imports (TypeScript ESM requirement)
  ```typescript
  import { BrowserManager } from "./BrowserManager.js";
  import { Extractor } from './Extractor.js';
  ```
- **External imports:** No extension needed
  ```typescript
  import { type Plugin, tool } from "@opencode-ai/plugin";
  import type { Page } from 'playwright';
  ```

### TypeScript Configuration
- **Target:** ES2022
- **Module Resolution:** Bundler
- **Strict mode:** Enabled
- **Lib:** ES2022 + DOM
- Always generate declaration files and source maps

### Naming Conventions
- **Classes:** PascalCase (e.g., `BrowserManager`, `Extractor`, `HumanInteractor`)
- **Functions/Methods:** camelCase (e.g., `fetchWebpage`, `extractMarkdown`, `askForHumanHelp`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`, `MAX_TIMEOUT`)
- **Private fields:** Use `private` keyword, camelCase (e.g., `private context`, `private page`)
- **Type imports:** Use `type` keyword when importing types only
  ```typescript
  import type { ToolContext } from "@opencode-ai/plugin";
  import type { BrowserContext, Page } from 'playwright';
  ```

### Class Structure
- Static methods for utility classes (e.g., `Extractor.extractMarkdown()`, `HumanInteractor.askForHumanHelp()`)
- Instance methods for stateful classes (e.g., `BrowserManager`)
- Constructor dependency injection pattern (see `BrowserManager` constructor)

### Error Handling
- Use try-catch blocks for async operations
- Provide fallback behavior when possible (see `Extractor.ts:24-28`)
- Log warnings for non-critical failures (see `BrowserManager.ts:115`)
- Clean up resources in finally blocks (see `index.ts:58`)
- Ignore errors on cleanup operations (see `BrowserManager.ts:214`)

### Async/Await Patterns
- Always use async/await for asynchronous operations
- Use `.catch()` for non-critical operations that shouldn't block execution
  ```typescript
  await this.page.goto(url, { waomcontentloaded', timeout }).catch((e) => {
    console.warn(`Navigation might have timed out: ${e.message}`);
  });
  ```
- Chain cleanup operations: `manager.dispose().catch(() => undefined)`

### Type Safety
- Use TypeScript's strict mode
- Prefer explicit types for function parameters and return values
- Use type imports for external types
- Use `any` sparingly and only when necessary (e.g., plugin client object)
- Null checks before using potentially null values (see `BrowserManager.ts:151`)

### Comments and Documentation
- Use JSDoc comments for public methods
- Include `@param` and `@returns` tags
- Add inline com complex logic or heuristics
- Example:
  ```typescript
  /**
   * Extracts the main content of a Playwright page and converts it to Markdown.
   * @param page The Playwright Page object.
   * @param url The current URL of the page.
   * @returns The main content formatted as Markdown.
   */
  ```

### Constants and Configuration
- Define timeout values as constants at the top of files
- Use milliseconds for internal timeout handling
- Convert user-facing timeouts from seconds to milliseconds

### Browser Automation Best Practices
- Use persistent browser contexts for session reuse
- Mask webdrive (see `BrowserManager.ts:84-93`)
- Add reasonable wait times for dynamic content (`waitForTimeout`)
- Handle navigation failures gracefully
- Implement blocker detection (captchas, login walls, Cloudflare)

### Plugin Development
- Export plugin as default export
- Use `tool()` helper from `@opencode-ai/plugin`
- Provide clear tool descriptions and argument schemas
- Use `ctx.metadata()` to provide rich metadata to the LLM
- Handle abort signals properly (see `index.ts:32-35`)

### File Operations
- Use Node.js built-in modules (`os`, `path`, `fs`)
- Create directories recursively: `fs.mkdirSync(dir, { recursive: true })`
- Check file existence befotions: `fs.existsSync()`

### Formatting Preferences
- Single quotes for strings (except when double quotes avoid escaping)
- Semicolons at end of statements
- 2-space indentation
- Trailing commas in multi-line objects/arrays

## Testing Guidelines

Currently no tests are defined. When adding tests:
- Use a test runner compatible with ESM (Vitest recommended)
- Mock Playwright browser interactions
- Test blocker detection logic
- Test markdown extraction with sample HTML

## Common Pitfalls

1. **Import extensions:** Always use `.js` for local imports in ESM TypeScript
2. **Playwright peer dependency:** Ensure Playwright is installed in the host project
3. **Absolute paths:** Use `file:///` URLs for local plugin paths in opencode.json
4. **Browser cleanup:** Always dispose of browser contexts to avoid resource leaks
5. **Timeout handling:** Convert seconds to milliseconds and enforce max limits

## Publishing

Before publishing to npm:
1. Update version in `package.json`
2. Run `bun run build` to compile
3. Test the plugin in a real Opencode environment
4. Ensure peer dependencies are documented in README
