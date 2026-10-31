/** Messages between the game and the world-generation worker. */
import type { WorldGenOptions, WorldGenResult, WorldGenStage } from '../sim/worldgen/generateWorld';

/** Sent to the worker: build a world. */
export type WorldGenRequest = WorldGenOptions;

/** Sent back by the worker. */
export type WorldGenMessage =
  | { type: 'progress'; stage: WorldGenStage; progress: number }
  | { type: 'done'; result: WorldGenResult }
  | { type: 'error'; message: string };
