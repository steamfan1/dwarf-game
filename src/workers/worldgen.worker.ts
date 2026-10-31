/**
 * World-generation worker: builds the world off the main thread so the page stays
 * responsive (and the loading bar keeps moving) while it runs. The finished world's
 * typed arrays are transferred back, not copied.
 */
import { generateWorld } from '../sim/worldgen/generateWorld';
import { World } from '../sim/world/World';
import type { WorldGenMessage, WorldGenRequest } from './protocol';

/** The parts of the worker global scope used here (avoids mixing the DOM and WebWorker type libraries). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorldGenRequest>) => void) | null;
  postMessage(message: WorldGenMessage, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const result = generateWorld(event.data, (stage, progress) => scope.postMessage({ type: 'progress', stage, progress }));
    scope.postMessage({ type: 'done', result }, World.transferables(result.snapshot));
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
