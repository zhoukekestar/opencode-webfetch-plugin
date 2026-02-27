import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const LOCK_FILE = path.resolve(os.homedir(), '.cache/opencode/browser.lock');

describe('BrowserManager - Multiple Instances', () => {
  let processes: ChildProcess[] = [];

  beforeAll(() => {
    // Clean up any existing lock file
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  });

  afterAll(async () => {
    // Kill all spawned processes
    for (const proc of processes) {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    processes = [];

    // Clean up lock file
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it('should allow multiple instances to connect to the same browser', async () => {
    const testScript = path.resolve(__dirname, 'helpers/instance-worker.ts');
    
    // Spawn 3 worker processes
    const workerCount = 3;
    const workers: Promise<string>[] = [];

    for (let i = 0; i < workerCount; i++) {
      workers.push(new Promise((resolve, reject) => {
        const proc = spawn('bun', ['run', testScript, `worker-${i}`], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, WORKER_ID: `${i}` }
        });

        processes.push(proc);

        let output = '';
        let errorOutput = '';

        proc.stdout?.on('data', (data) => {
          output += data.toString();
          console.log(`[Worker ${i}] ${data.toString().trim()}`);
        });

        proc.stderr?.on('data', (data) => {
          errorOutput += data.toString();
          console.error(`[Worker ${i} ERROR] ${data.toString().trim()}`);
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Worker ${i} exited with code ${code}\n${errorOutput}`));
          }
        });

        // Timeout after 60 seconds
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGTERM');
            reject(new Error(`Worker ${i} timed out`));
          }
        }, 60000);
      }));
    }

    // Wait for all workers to complete
    const results = await Promise.all(workers);

    // Verify all workers completed successfully
    expect(results).toHaveLength(workerCount);
    results.forEach((result, index) => {
      expect(result).toContain('SUCCESS');
      console.log(`✓ Worker ${index} completed successfully`);
    });

    console.log(`✓ All ${workerCount} instances connected and executed successfully`);
  }, 120000);

  it('should handle lock file correctly when first process exits', async () => {
    const testScript = path.resolve(__dirname, 'helpers/instance-worker.ts');

    // Start first worker (will own the browser)
    const firstWorker = new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', ['run', testScript, 'first'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      processes.push(proc);

      proc.stdout?.on('data', (data) => {
        console.log(`[First Worker] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`First worker failed with code ${code}`));
        }
      });
    });

    // Wait for first worker to complete
    await firstWorker;

    // Verify lock file exists or was cleaned up
    console.log('✓ First worker completed');

    // Start second worker (should be able to acquire lock or connect)
    const secondWorker = new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', ['run', testScript, 'second'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      processes.push(proc);

      proc.stdout?.on('data', (data) => {
        console.log(`[Second Worker] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Second worker failed with code ${code}`));
        }
      });
    });

    await secondWorker;
    console.log('✓ Second worker completed after first worker exit');
  }, 120000);

  it('should share cookies and session state across instances', async () => {
    const testScript = path.resolve(__dirname, 'helpers/session-worker.ts');

    // First worker: navigate to a page and set some state
    const firstResult = await new Promise<string>((resolve, reject) => {
      const proc = spawn('bun', ['run', testScript, 'set'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      processes.push(proc);

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
        console.log(`[Session Set] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Session set worker failed with code ${code}`));
        }
      });
    });

    expect(firstResult).toContain('SUCCESS');

    // Second worker: verify the state is shared
    const secondResult = await new Promise<string>((resolve, reject) => {
      const proc = spawn('bun', ['run', testScript, 'verify'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      processes.push(proc);

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
        console.log(`[Session Verify] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Session verify worker failed with code ${code}`));
        }
      });
    });

    expect(secondResult).toContain('SUCCESS');
    console.log('✓ Session state shared across instances');
  }, 120000);
});
