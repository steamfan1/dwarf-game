/**
 * Developer helpers on `window.debug`, installed in dev builds only (`npm run dev`).
 * Production builds strip this module entirely.
 *
 *   debug.setSpeed(5)          run the simulation 5x faster on top of the chosen speed
 *   debug.spawnItem('stone', 20)   drop items at the Hearth (the dwarves store them)
 *   debug.give('plank', 20)    put items straight into storage
 *   debug.stockUp()            a bit of every raw material, one of each crafting station, a few defences
 *   debug.skipToNight()        bring nightfall forward to now
 *   debug.spawnCreature('gloomling', 10)   a creature on the ground 10 tiles right of the Hearth
 *   debug.startWave()          an invasion tonight: the warning now, the portal at dusk
 *   debug.killMonsters()       every hostile creature drops dead
 *   debug.techTier(3)          jump to tier 3 of the tech tree (its new dwarves come too)
 *   debug.ripenCrops()         every growing crop ripens at once
 *   debug.placeGate()          a World Gate appears beside the Hearth: the world is won
 *   debug.save()               save now (as the menu's Save game does)
 *   debug.revealMap()
 */
import type { App } from '../app/App';

export interface DebugApi {
  spawnItem(id: string, count?: number): void;
  give(id: string, count?: number): void;
  stockUp(): void;
  skipToNight(): void;
  spawnCreature(id: string, dx?: number): void;
  startWave(): void;
  killMonsters(): void;
  techTier(tier: number): void;
  ripenCrops(): void;
  placeGate(): void;
  save(): void;
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


/** What debug.stockUp() puts in storage. */
const STARTER_KIT: ReadonlyArray<[string, number]> = [
  ['log', 30],
  ['plank', 40],
  ['stone', 50],
  ['dirt', 50],
  ['clay', 20],
  ['sand', 20],
  ['fiber', 20],
  ['copper_ore', 12],
  ['iron_ore', 16],
  ['gold_ore', 6],
  ['crystal', 4],
  ['torch', 6],
  ['ladder', 10],
  ['chest', 2],
  ['workbench', 1],
  ['furnace', 1],
  ['anvil', 1],
  ['loom', 1],
  ['kitchen', 1],
  ['copper_sword', 3],
  ['spike_trap', 2],
  ['bolt_thrower', 1],
  ['rekindling_draught', 1],
  ['wheat_seeds', 10],
  ['sunroot_seeds', 10],
];

export function installDebugApi(app: App): void {
  window.debug = {
    spawnItem: (id, count = 1) => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.spawnItem() needs a running game: start a new game first.');
        return;
      }
      if (!sim.items.has(id)) {
        console.info(`Unknown item "${id}". Items: ${sim.items.items.map((item) => item.id).join(', ')}`);
        return;
      }
      const amount = Math.max(1, Math.floor(count));
      // Dropped beside the Hearth like anything a dwarf digs up; the dwarves carry it in.
      sim.dropItems(sim.items.item(id), amount, sim.hearth.x, sim.hearth.y);
      console.info(`Dropped ${amount} × ${sim.items.get(sim.items.item(id)).name} at the Hearth.`);
    },
    give: (id, count = 1) => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.give() needs a running game: start a new game first.');
        return;
      }
      if (!sim.items.has(id)) {
        console.info(`Unknown item "${id}". Items: ${sim.items.items.map((item) => item.id).join(', ')}`);
        return;
      }
      const amount = Math.max(1, Math.floor(count));
      sim.storage.add(sim.items.item(id), amount);
      console.info(`Put ${amount} × ${sim.items.get(sim.items.item(id)).name} into storage.`);
    },
    stockUp: () => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.stockUp() needs a running game: start a new game first.');
        return;
      }
      for (const [id, count] of STARTER_KIT) if (sim.items.has(id)) sim.storage.add(sim.items.item(id), count);
      console.info(`Stocked up: ${STARTER_KIT.map(([id, count]) => `${count} ${id}`).join(', ')}.`);
    },
    skipToNight: () => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.skipToNight() needs a running game: start a new game first.');
        return;
      }
      sim.skipToNight();
      console.info(`Night falls on day ${sim.time.day(sim.tick)}.`);
    },
    spawnCreature: (id, dx = 10) => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.spawnCreature() needs a running game: start a new game first.');
        return;
      }
      if (!sim.creatureKinds.has(id)) {
        console.warn(`No creature "${id}". Try one of: ${sim.creatureKinds.defs.map((def) => def.id).join(', ')}`);
        return;
      }
      const creature = sim.spawnCreatureNear(id, dx);
      if (creature) console.info(`A ${sim.creatureDef(creature).name} appears at ${creature.x}, ${creature.y}.`);
      else console.warn(`Nowhere for a ${id} to stand ${dx} tiles from the Hearth.`);
    },
    startWave: () => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.startWave() needs a running game: start a new game first.');
        return;
      }
      sim.startWave();
      console.info('An invasion is coming tonight.');
    },
    killMonsters: () => {
      const sim = app.session?.sim;
      if (!sim) return;
      let n = 0;
      for (const creature of [...sim.creatures]) {
        if (!creature.gone && sim.isHostile(creature)) {
          sim.killCreature(creature, 0);
          n++;
        }
      }
      console.info(`${n} monster(s) dropped dead.`);
    },
    techTier: (tier) => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.techTier() needs a running game: start a new game first.');
        return;
      }
      sim.reachTier(Math.round(tier) - 1);
      app.reportColony();
      console.info(`Tech tree: tier ${sim.research.tier + 1} (${sim.research.tree.tiers[sim.research.tier]!.name}).`);
    },
    ripenCrops: () => {
      const sim = app.session?.sim;
      if (!sim) return;
      sim.ripenCrops();
      console.info('Every growing crop will be ripe in a moment.');
    },
    placeGate: () => {
      const sim = app.session?.sim;
      if (!sim) {
        console.info('debug.placeGate() needs a running game: start a new game first.');
        return;
      }
      const gate = sim.items.items.findIndex((item) => item.builds !== null && 'furniture' in item.builds && sim.furnitureKinds.get(sim.furnitureKinds.id(item.builds.furniture)).wins);
      for (let dx = 3; dx < 40; dx++) {
        for (const side of [1, -1]) {
          const x = sim.hearth.x + side * dx;
          for (let y = sim.hearth.y - 3; y <= sim.hearth.y + 3; y++) {
            if (sim.furnitureStatus(gate, x, y) !== 'ok') continue;
            const builds = sim.items.get(gate).builds;
            if (!builds || !('furniture' in builds)) return;
            sim.placeFurniture(sim.furnitureKinds.id(builds.furniture), x, y);
            console.info(`A World Gate stands at ${x}, ${y}.`);
            return;
          }
        }
      }
      console.warn('No room for a World Gate near the Hearth.');
    },
    save: () => {
      if (!app.session) {
        console.info('debug.save() needs a running game: start a new game first.');
        return;
      }
      app.saveGame();
    },
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
  console.info('Gatewright dev build: helpers are on window.debug (spawnItem, give, stockUp, skipToNight, spawnCreature, startWave, killMonsters, revealMap, setSpeed).');
}
