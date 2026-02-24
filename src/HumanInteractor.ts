import * as readline from 'readline';

export class HumanInteractor {
  /**
   * Pauses execution and prompts the user in the terminal.
   * Resolves when the user presses Enter.
   * @param message The message to display to the user.
   */
  static async askForHumanHelp(message: string): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n\x1b[33m================ HUMAN INTERVENTION REQUIRED ================\x1b[0m');
    console.log(`\x1b[1m${message}\x1b[0m`);
    console.log('\x1b[33m=============================================================\x1b[0m');

    return new Promise((resolve) => {
      rl.question('\n\x1b[32m[Action Required]\x1b[0m Please complete the action in the browser, then press ENTER to continue...', () => {
        rl.close();
        console.log('\x1b[32mResuming execution...\x1b[0m\n');
        resolve();
      });
    });
  }
}
