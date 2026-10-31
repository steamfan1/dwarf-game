/**
 * Developer helpers on `window.debug`, installed in dev builds only (`npm run dev`).
 * Production builds strip this module entirely.
 *
 *   debug.setSpeed(5)          run the simulation 5x faster on top of the chosen speed
 *   debug.spawnItem('plank', 20)
 *   debug.skipToNight()
 *   debug.revealMap()
 *
 * Helpers whose systems don't exist yet say which milestone brings them.
 */
import type { App } from '../app/App';

export interface DebugApi {
  spawnItem(id: string, count?: number): void;
  skipToNight(): void;
  revealMap(): void;
  setSpeed(multiplier: number): void;
  /** The running app, for poking around in the console. */
  readonly app: App;
}

declare global {
  interface Window {
    debug?: DebugApi;
  }
}

function notYet(name: string, milestone: number): void {
  console.info(`debug.${name}() becomes available in Milestone ${milestone}.`);
}

export function installDebugApi(app: App): void {
  window.debug = {
    spawnItem: (id, count = 1) => {
      void id;
      void count;
      notYet('spawnItem', 3);
    },
    skipToNight: () => notYet('skipToNight', 4),
    revealMap: () => {
      if (app.revealMap()) console.info('Fog of war lifted over the whole map.');
      else console.info('debug.revealMap() needs a running game: start a new world first.');
    },
    setSpeed: (multiplier) => {
      if (!app.session) {
        console.info('debug.setSpeed() needs a running game: start a new game first.');
        return;
      }
      app.session.time.setDebugMultiplier(multiplier);
      console.info(`Simulation speed multiplier: ${app.session.time.state().debugMultiplier}x`);
    },
    app,
  };
  console.info('Gatewright dev build: helpers are on window.debug (spawnItem, skipToNight, revealMap, setSpeed).');
}
