import type { ToolContext } from '@opencode-ai/plugin'
import { resolve } from 'dns';
import { title } from 'process';

const sleep = (t: number) => new Promise(resolve => {
  setTimeout(() => {
    resolve(null)
  }, t);
})
export class HumanInteractor {
  /**
   * Instructs the LLM to pause and asks the human to resolve the issue in the browser.
   * Pre-fills the TUI prompt so the user can just press Enter to continue.
   */
  static async askForHumanHelp (
    message: string,
    ctx: ToolContext,
    client: any,
    checker: any,
  ): Promise<void> {
    try {

      while(true) {
        // Show a toast to notify the user immediately
        client?.tui?.showToast({
          body: {
            title: 'Browser Action Required',
            message,
            variant: 'warning'
          }
          // duration: 10000
        })

        await sleep(5000)
        const res = await checker();
        if (res.blocked) {
          continue
        } else {
          break
        }
      }
    } catch (e) {
      console.error(e)
    }
  }
}
