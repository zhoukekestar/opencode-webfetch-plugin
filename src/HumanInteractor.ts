import { ToolContext } from "@opencode-ai/plugin";

export class HumanInteractor {
  /**
   * Pauses execution and prompts the user via the Opencode TUI.
   * Resolves when the user allows the request.
   * @param message The message to display to the user.
   * @param ctx The Opencode tool context used to prompt the user.
   */
  static async askForHumanHelp(message: string, ctx: ToolContext): Promise<void> {
    try {
      await ctx.ask({
        permission: "Human Intervention Required",
        patterns: [
          message,
          "Please complete the action in the browser, then select 'Allow' to continue."
        ],
        always: [],
        metadata: {
          actionRequired: true,
          message: message
        }
      });
      console.log('\x1b[32mResuming execution...\x1b[0m\n');
    } catch (e) {
      console.warn("User rejected the human-intervention request or an error occurred.");
      throw e;
    }
  }
}
