/**
 * Runs world generation in a Web Worker and reports progress.
 * If the browser can't start the worker, generation falls back to the main thread
 * (the page pauses briefly, but the game still starts).
 */
import { generateWorld, type ProgressCallback, type WorldGenOptions, type WorldGenResult } from '../sim/worldgen/generateWorld';
import type { WorldGenMessage } from '../workers/protocol';

export function generateWorldInWorker(options: WorldGenOptions, onProgress: ProgressCallback): Promise<WorldGenResult> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/worldgen.worker.ts', import.meta.url), { type: 'module', name: 'worldgen' });
  } catch (error) {
    console.warn('World generation worker unavailable; generating on the main thread.', error);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(generateWorld(options, onProgress));
        } catch (failure) {
          reject(failure instanceof Error ? failure : new Error(String(failure)));
        }
      }, 0);
    });
  }

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorldGenMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.stage, message.progress);
        return;
      }
      worker.terminate();
      if (message.type === 'done') resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The world generation worker failed to start'));
    };
    worker.postMessage(options);
  });
}
