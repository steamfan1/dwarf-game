import { describe, expect, it } from 'vitest';
import { FURNITURE, ITEMS, RECIPES, TILES } from './content';
import { distanceToArea } from './nav/Pathfinder';
import { at, newSim } from './testKit';
import { AIR } from './world/TileRegistry';

const item = (id: string): number => ITEMS.item(id);
const recipe = (id: string): number => RECIPES.get(id).index;
const kind = (id: string): number => FURNITURE.id(id);

// The test world (see testKit.ts): open sky down to row 9, grass on row 10, the Hearth
// at (20, 9), a tree on column 34. There are no background walls in the sky.

describe('Building: dwarves fetch materials from storage and build what the player plans', () => {
  it('builds a block: a dwarf fetches the material, carries it over and puts it in', () => {
    const { sim, world, runUntil } = newSim();
    sim.storage.add(item('stone'), 3);
    expect(sim.designateBuild(item('stone'), at(26, 9), 2)).toBe(1);
    // Only planned so far.
    expect(world.fg[world.index(26, 9)]).toBe(AIR);
    expect(sim.jobs.at(26, 9)?.type).toBe('build');
    runUntil(() => world.fg[world.index(26, 9)] === TILES.tile('stone'));
    expect(sim.storage.count(item('stone'))).toBe(2);
    expect(sim.storage.reservedCount(item('stone'))).toBe(0);
    expect(sim.jobs.size).toBe(0);
    expect(sim.dwarves.some((d) => d.skills.building.xp > 0)).toBe(true);
  });

  it('waits, flagged as missing materials, until the materials are in storage', () => {
    const { sim, world, run, runUntil } = newSim();
    sim.designateBuild(item('plank'), at(26, 9), 2);
    run(40);
    const job = sim.jobs.at(26, 9)!;
    expect(job.missing).toBe(true);
    expect(job.claimedBy).toBe(0);
    sim.storage.add(item('plank'), 1);
    runUntil(() => world.fg[world.index(26, 9)] === TILES.tile('plank'));
  });

  it('refuses to plan what nothing would hold up, or where something is in the way, and says why', () => {
    const { sim } = newSim();
    const dirt = item('dirt');
    expect(sim.buildStatus(dirt, 26, 9)).toBe('ok'); // on the ground
    expect(sim.buildStatus(dirt, 26, 5)).toBe('unsupported'); // in mid-air
    expect(sim.buildStatus(dirt, 26, 10)).toBe('occupied'); // the ground itself
    expect(sim.buildStatus(dirt, 20, 9)).toBe('occupied'); // the Hearth
    expect(sim.buildStatus(dirt, 34, 8)).toBe('occupied'); // a tree trunk
    expect(sim.buildStatus(dirt, 5, 20)).toBe('unexplored');
    expect(sim.buildStatus(item('log'), 26, 9)).toBe('cannot-build');
    expect(sim.buildStatus(item('wooden_door'), 26, 8)).toBe('needs-floor');
    expect(sim.wallStatus(dirt, 26, 5)).toBe('unsupported');
    expect(sim.wallStatus(dirt, 26, 12)).toBe('has-wall');
    expect(sim.wallStatus(item('log'), 26, 9)).toBe('cannot-build');
    expect(sim.furnitureStatus(item('workbench'), 26, 9)).toBe('ok');
    expect(sim.furnitureStatus(item('workbench'), 26, 6)).toBe('needs-floor');
    expect(sim.furnitureStatus(item('workbench'), 21, 9)).toBe('occupied'); // half on the Hearth
    expect(sim.furnitureStatus(item('torch'), 26, 6)).toBe('needs-wall');
    expect(sim.furnitureStatus(item('torch'), 26, 9)).toBe('ok'); // the ground beside it holds it
    expect(sim.furnitureStatus(item('stone'), 26, 9)).toBe('cannot-build');
    // Planned work takes the spot.
    expect(sim.designateBuild(dirt, at(26, 9), 2)).toBe(1);
    expect(sim.buildStatus(dirt, 26, 9)).toBe('marked');
    expect(sim.furnitureStatus(item('chest'), 26, 9)).toBe('marked');
    // A wall can still be planned behind it: walls have a layer of their own.
    expect(sim.wallStatus(dirt, 26, 9)).toBe('ok');
  });

  it('puts up a column of walls from the ground, climbing each one to reach the next', () => {
    const { sim, world, runUntil } = newSim();
    sim.storage.add(item('dirt'), 10);
    // Only the bottom one has anything to hold it, but each planned wall holds up the next.
    expect(sim.designateWall(item('dirt'), { x0: 26, y0: 4, x1: 26, y1: 9 }, 2)).toBe(6);
    // Walls waiting for the ones below them aren't flagged as out of reach.
    expect([...sim.jobs.all()].some((job) => job.blocked)).toBe(false);
    runUntil(() => world.bg[world.index(26, 4)] !== 0, 8000);
    for (let y = 4; y <= 9; y++) expect(world.bg[world.index(26, y)]).toBe(TILES.wall('dirt_wall'));
    expect(sim.storage.count(item('dirt'))).toBe(4);
  });

  it('builds a ladder up from the ground, one rung on top of the other', () => {
    const { sim, world, runUntil } = newSim();
    sim.storage.add(item('ladder'), 4);
    expect(sim.designateBuild(item('ladder'), { x0: 26, y0: 6, x1: 26, y1: 9 }, 2)).toBe(4);
    runUntil(() => world.fg[world.index(26, 6)] === TILES.tile('ladder'), 8000);
    expect(sim.nav.standable(26, 6)).toBe(true);
  });

  it('builds a door that dwarves walk through but light does not', () => {
    const { sim, world, runUntil } = newSim();
    sim.storage.add(item('wooden_door'), 1);
    expect(sim.designateBuild(item('wooden_door'), at(26, 9), 2)).toBe(1);
    runUntil(() => world.fg[world.index(26, 9)] === TILES.tile('wooden_door'));
    expect(sim.nav.passable(26, 9)).toBe(true);
    expect(sim.lighting.sunDepth[26]).toBe(9);
  });

  it('cancelling a build gives its materials back', () => {
    const { sim, world, runUntil } = newSim();
    sim.storage.add(item('stone'), 1);
    sim.designateBuild(item('stone'), at(30, 9), 2);
    runUntil(() => sim.dwarves.some((d) => d.carrying.some((c) => c.item === item('stone'))));
    expect(sim.cancelDesignations(at(30, 9))).toBe(1);
    runUntil(() => sim.storage.count(item('stone')) === 1 && sim.dwarves.every((d) => d.carrying.length === 0));
    expect(world.fg[world.index(30, 9)]).toBe(AIR);
  });
});

describe('Furniture', () => {
  it('sets down a chest, which adds room and becomes another place to store things', () => {
    const { sim, runUntil } = newSim();
    const slots = sim.storage.capacity;
    sim.storage.add(item('chest'), 1);
    expect(sim.designateFurniture(item('chest'), 40, 9, 2)).toBe(true);
    runUntil(() => sim.furniture.size === 1);
    expect(sim.storage.capacity).toBe(slots + FURNITURE.get(kind('chest')).storage);
    expect(sim.storage.count(item('chest'))).toBe(0);
    // Goods dug near the chest are taken there rather than all the way back to the Hearth.
    const path = sim.paths.pathfinder.find(sim.world.index(44, 9), sim.storageGoal());
    if (!path.found) throw new Error('no way to storage');
    const end = path.cells.at(-1)!;
    expect(distanceToArea(end, sim.world.width, sim.furniture.at(40, 9)!.rect)).toBeLessThanOrEqual(1);
  });

  it('takes furniture apart into the item it was built from, and holds up its floor meanwhile', () => {
    const { sim, runUntil } = newSim();
    const piece = sim.placeFurniture(kind('chest'), 26, 9);
    const slots = sim.storage.capacity;
    expect(sim.digStatus(26, 10)).toBe('supports-furniture');
    expect(sim.autoTarget(26, 9)).toBe('dismantle');
    expect(sim.designateDismantle(26, 9, 2)).toBe(true);
    runUntil(() => sim.furniture.get(piece.id) === undefined);
    expect(sim.storage.capacity).toBe(slots - FURNITURE.get(kind('chest')).storage);
    runUntil(() => sim.storage.count(item('chest')) === 1);
    expect(sim.digStatus(26, 10)).toBe('ok');
  });

  it('lights a torch up', () => {
    const { sim } = newSim();
    const before = sim.lighting.glow[sim.world.index(30, 9)]!;
    sim.placeFurniture(kind('torch'), 30, 9);
    expect(sim.lighting.glow[sim.world.index(30, 9)]).toBe(FURNITURE.get(kind('torch')).light);
    expect(before).toBeLessThan(FURNITURE.get(kind('torch')).light);
  });
});

describe('Crafting', () => {
  it('makes planks by hand at the Hearth, and puts them away', () => {
    const { sim, runUntil } = newSim();
    sim.storage.add(item('log'), 2);
    sim.queueCraft(recipe('planks'), 2);
    expect(sim.crafting.orders).toHaveLength(1);
    runUntil(() => sim.storage.count(item('plank')) === 4);
    expect(sim.storage.count(item('log'))).toBe(0);
    expect(sim.crafting.orders).toHaveLength(0);
    expect(sim.jobs.size).toBe(0);
    expect(sim.dwarves.some((d) => d.skills.crafting.xp > 0)).toBe(true);
  });

  it('crafts at a station, walking over to it; without one the order waits', () => {
    const { sim, bus, run, runUntil } = newSim();
    sim.storage.add(item('plank'), 6);
    const order = sim.queueCraft(recipe('wooden_door'), 1);
    run(100);
    expect(sim.craftStatus(order)).toBe('no-station');
    expect(sim.storage.count(item('plank'))).toBe(6);

    const bench = sim.placeFurniture(kind('workbench'), 28, 9);
    const crafters: number[] = [];
    bus.on('ItemCrafted', ({ dwarf }) => {
      const d = sim.dwarf(dwarf)!;
      crafters.push(distanceToArea(sim.world.index(d.x, d.y), sim.world.width, bench.rect));
    });
    runUntil(() => sim.storage.count(item('wooden_door')) === 1);
    expect(sim.storage.count(item('plank'))).toBe(3);
    expect(crafters).toHaveLength(1);
    expect(crafters[0]).toBeLessThanOrEqual(1);
    expect(sim.furniture.get(bench.id)!.user).toBe(0);
  });

  it('waits for more materials when they run out partway through an order', () => {
    const { sim, run, runUntil } = newSim();
    sim.storage.add(item('log'), 1);
    const order = sim.queueCraft(recipe('planks'), 3);
    runUntil(() => sim.storage.count(item('plank')) === 2);
    run(60);
    expect(order.made).toBe(1);
    expect(sim.craftStatus(order)).toBe('missing-materials');
    sim.storage.add(item('log'), 2);
    runUntil(() => sim.storage.count(item('plank')) === 6);
    expect(sim.crafting.orders).toHaveLength(0);
  });

  it('gives the materials back when an order is cancelled midway', () => {
    const { sim, runUntil } = newSim();
    sim.storage.add(item('iron_ore'), 2);
    const furnace = sim.placeFurniture(kind('furnace'), 28, 9);
    const order = sim.queueCraft(recipe('iron_bar'), 1);
    runUntil(() => sim.dwarves.some((d) => d.carrying.some((c) => c.item === item('iron_ore'))));
    sim.cancelCraft(order.id);
    runUntil(() => sim.storage.count(item('iron_ore')) === 2 && sim.dwarves.every((d) => d.carrying.length === 0));
    expect(sim.storage.count(item('iron_bar'))).toBe(0);
    expect(sim.furniture.get(furnace.id)!.user).toBe(0);
    expect(sim.jobs.size).toBe(0);
  });

  it('adds to an order when the same recipe is queued again, and can be cut back', () => {
    const { sim } = newSim();
    const first = sim.queueCraft(recipe('torches'), 2);
    const again = sim.queueCraft(recipe('torches'), 3);
    expect(again).toBe(first);
    expect(first.count).toBe(5);
    sim.setCraftRemaining(first.id, 1);
    expect(first.count).toBe(1);
    sim.setCraftRemaining(first.id, 0);
    expect(sim.crafting.orders).toHaveLength(0);
  });
});

describe('Gear', () => {
  it('dwarves fetch better gear from storage by themselves, and dig faster with a pickaxe', () => {
    const { sim, runUntil } = newSim();
    sim.storage.add(item('copper_pickaxe'), 1);
    runUntil(() => sim.dwarves.some((d) => d.equipment.tool !== null));
    const miner = sim.dwarves.find((d) => d.equipment.tool !== null)!;
    expect(miner.equipment.tool).toBe(item('copper_pickaxe'));
    expect(sim.storage.count(item('copper_pickaxe'))).toBe(0);
    expect(sim.toolSpeed(miner)).toBe(ITEMS.get(item('copper_pickaxe')).equip!.digSpeed);

    // A better one turns up: someone takes it, and the old one isn't wasted either.
    sim.storage.add(item('iron_pickaxe'), 1);
    runUntil(
      () =>
        sim.dwarves.filter((d) => d.equipment.tool !== null).length === 2 &&
        sim.storage.count(item('copper_pickaxe')) === 0 &&
        sim.storage.count(item('iron_pickaxe')) === 0,
    );
    const tools = sim.dwarves.flatMap((d) => (d.equipment.tool === null ? [] : [d.equipment.tool])).sort();
    expect(tools).toEqual([item('copper_pickaxe'), item('iron_pickaxe')].sort());
  });
});

describe('Storage', () => {
  it('leaves goods on the ground while storage is full, and says so', () => {
    const { sim, world, bus, run, runUntil } = newSim();
    // Fill every slot: a full stack of stone on top of the food the colony starts with.
    sim.storage.add(item('stone'), ITEMS.get(item('stone')).stack);
    sim.storage.capacity = sim.storage.slotsUsed();
    let notices = 0;
    bus.on('StorageFull', () => notices++);
    sim.designate('dig', at(26, 10), 2);
    runUntil(() => world.fg[world.index(26, 10)] === AIR);
    run(200);
    expect(sim.ground.size).toBe(1);
    expect(notices).toBeGreaterThan(0);
    sim.storage.capacity++;
    runUntil(() => sim.storage.count(item('dirt')) === 1);
  });

  it('felling a tree gives fibre from its leaves as well as logs', () => {
    const { sim, world, runUntil } = newSim();
    let leaves = 0;
    for (let i = 0; i < world.fg.length; i++) if (TILES.tiles[world.fg[i]!]!.art.style === 'leaves') leaves++;
    sim.designate('chop', at(34, 9), 2);
    runUntil(() => sim.storage.count(item('fiber')) > 0 && sim.ground.size === 0);
    expect(sim.storage.count(item('fiber'))).toBe(Math.ceil(leaves / sim.colony.work.leavesPerFiber));
  });
});
