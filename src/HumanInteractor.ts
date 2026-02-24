import type { ToolContext } from "@opencode-ai/plugin";

export class HumanInteractor {
  /**
   * Instructs the LLM to pause and asks the human to resolve the issue in the browser.
   * Pre-fills the TUI prompt so the user can just press Enter to continue.
   */
  static async askForHumanHelp(message: string, ctx: ToolContext, client: any): Promise<void> {
    try {
      // Show a toast to notify the user immediately
      await client?.tui?.showToast({
        title: "Browser Action Required",
        message: "Please complete the Captcha or Login in the opened window.",
        variant: "warning",
        duration: 10000
      });
    } catch (e) {}

    try {
      // Pre-fill the user's prompt box so they can just press enter when ready
      await client?.tui?.appendPrompt({
        text: "I have completed the required action in the browser, please try fetching the page again."
      });
    } catch (e) {}

    // We throw an explicit error to halt the tool. 
    // The BrowserManager does not dispose the persistent context on error, 
    // so the browser stays open for the user to interact with.
    throw new Error(
      `[ACTION REQUIRED] ${message}\n\nPlease complete the required action (e.g., Captcha/Login) in the opened Playwright browser window.\nOnce you have resolved the issue, please tell me (the AI) to continue or retry the operation in this chat.`
    );
  }
}
