import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import type { Page } from 'playwright';

export class Extractor {
  /**
   * Extracts the main content of a Playwright page and converts it to Markdown.
   * @param page The Playwright Page object.
   * @param url The current URL of the page.
   * @returns The main content formatted as Markdown.
   */
  static async extractMarkdown(page: Page, url: string): Promise<string> {
    // 1. Get full HTML content from the page
    const htmlContent = await page.content();
    
    // 2. Parse HTML using JSDOM
    const doc = new JSDOM(htmlContent, { url });

    // 3. Extract core content using Readability
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      // Fallback if Readability fails
      const bodyText = await page.evaluate(() => document.body.innerText);
      return `Failed to extract main article content.\n\nRaw Body Text:\n${bodyText.substring(0, 5000)}`;
    }

    // 4. Convert extracted HTML to clean Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });

    // Remove noisy elements just in case
    turndownService.remove(['script', 'style', 'noscript', 'iframe']);

    let markdown = turndownService.turndown(article.content);
    
    // Format the output
    return `# ${article.title || 'Extracted Page Content'}\n\n**Source URL:** ${url}\n\n---\n\n${markdown}`;
  }
}
