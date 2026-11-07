/**
 * The state of a running world as a save keeps it: everything the simulation can't work
 * out again from the world's cells. Items, tiles, walls, furniture, creatures, recipes and
 * crops are named by their ids from the content files, never by number, so a save still
 * loads after the content files grow or are reordered (what has since gone is dropped).
 *
 * What a save leaves out, on purpose: paths, light and rooms (worked out again), missiles
 * in flight, and what each dwarf and creature was in the middle of. A loaded colony picks
 * up its work afresh: hauling, crafting and farm jobs come back by themselves, and dwarves
 * put away anything they were carrying.
 *
 * Pure: no Phaser and no DOM.
 */
import { Rng, type RngState } from '../../core/Rng';
import { createCreature, type CreatureOrigin } from '../creatures/Creature';
import type { SpawnerState } from '../creatures/Spawner';
import { createDwarf, EQUIPMENT_SLOTS, SKILLS, type EquipmentSlot, type Skill, type SkillState } from '../dwarves/Dwarf';
import type { DeathCause } from '../events';
import type { SavedPlot } from '../farming/Farms';
import type { Job, MarkLayer, Priority } from '../jobs/JobBoard';
import type { Simulation } from '../Simulation';
import type { ResearchState } from '../tech/TechTree';

/** Job types a save keeps: the player's own marks. Farm work, crafting, hauling and needs come back by themselves. */
const KEPT_JOBS = ['dig', 'chop', 'harvest', 'build', 'wall', 'place', 'dismantle', 'hunt', 'revive'] as const;
type KeptJob = (typeof KEPT_JOBS)[number];

export interface SavedDwarf {
  id: number;
  name: string;
  looks: { skin: number; beard: number; tunic: number };
  x: number;
  y: number;
  facing: -1 | 1;
  health: number;
  maxHealth: number;
  hunger: number;
  energy: number;
  skills: Record<Skill, SkillState>;
  equipment: Partial<Record<EquipmentSlot, string>>;
  carrying: Array<[string, number]>;
  dead: boolean;
  deathCause: DeathCause | null;
}

export interface SavedCreature {
  id: number;
  kind: string;
  origin: CreatureOrigin;
  x: number;
  y: number;
  facing: -1 | 1;
  health: number;
  maxHealth: number;
  damage: number;
  leaveAt: number;
}

export interface SavedJob {
  type: KeptJob;
  x: number;
  y: number;
  priority: Priority;
  cells: number[];
  layer: MarkLayer;
  inputs: Array<[string, number]>;
  /** By id for tiles, walls and furniture kinds; the creature or dwarf id for hunts and revivals. */
  target: string | number;
  /** Dismantle: the piece (its id in this save). */
  furnitureId: number;
}

export interface SimState {
  tick: number;
  /** The clock's offset (start hour and any skips). */
  clock: number;
  rng: number[];
  creatureRng: number[];
  dwarves: SavedDwarf[];
  creatures: SavedCreature[];
  nextCreatureId: number;
  furniture: Array<{ id: number; kind: string; x: number; y: number; cooldown: number }>;
  storage: Array<[string, number]>;
  ground: Array<{ item: string; count: number; x: number; y: number }>;
  jobs: SavedJob[];
  orders: Array<{ recipe: string; count: number; made: number }>;
  tileDamage: Array<[number, number]>;
  regrowth: Array<{ cell: number; from: string; to: string; at: number }>;
  spawner: SpawnerState;
  research: ResearchState;
  plots: SavedPlot[];
  won: boolean;
  lost: boolean;
}

/** The simulation's state, ready to be written as JSON. */
export function captureState(sim: Simulation): SimState {
  const itemId = (item: number): string => sim.items.get(item).id;
  const tileId = (tile: number): string => sim.tiles.tiles[tile]!.id;
  const internals = sim.saveInternals();
  return {
    tick: sim.tick,
    clock: sim.time.offsetTicks,
    rng: [...sim.rng.getState()],
    creatureRng: [...sim.creatureRng.getState()],
    dwarves: sim.dwarves.map((dwarf) => {
      const equipment: Partial<Record<EquipmentSlot, string>> = {};
      for (const slot of EQUIPMENT_SLOTS) {
        const item = dwarf.equipment[slot];
        if (item !== null) equipment[slot] = itemId(item);
      }
      return {
        id: dwarf.id,
        name: dwarf.name,
        looks: { ...dwarf.looks },
        x: dwarf.x,
        y: dwarf.y,
        facing: dwarf.facing,
        health: dwarf.health,
        maxHealth: dwarf.maxHealth,
        hunger: dwarf.hunger,
        energy: dwarf.energy,
        skills: Object.fromEntries(SKILLS.map((skill) => [skill, { ...dwarf.skills[skill] }])) as Record<Skill, SkillState>,
        equipment,
        carrying: dwarf.carrying.map(({ item, count }): [string, number] => [itemId(item), count]),
        dead: dwarf.phase === 'dead',
        deathCause: dwarf.deathCause,
      };
    }),
    creatures: sim.creatures
      .filter((creature) => !creature.gone)
      .map((creature) => ({
        id: creature.id,
        kind: sim.creatureKinds.get(creature.kind).id,
        origin: creature.origin,
        x: creature.x,
        y: creature.y,
        facing: creature.facing,
        health: creature.health,
        maxHealth: creature.maxHealth,
        damage: creature.damage,
        leaveAt: creature.leaveAt,
      })),
    nextCreatureId: internals.nextCreatureId,
    furniture: [...sim.furniture.all()].map((piece) => ({ id: piece.id, kind: piece.def.id, x: piece.x, y: piece.y, cooldown: piece.cooldown })),
    storage: sim.storage.entries().map(({ item, count }): [string, number] => [itemId(item), count]),
    ground: [...sim.ground.all()].map((stack) => ({ item: itemId(stack.item), count: stack.count, x: stack.x, y: stack.y })),
    jobs: [...sim.jobs.all()].flatMap((job) => savedJob(sim, job)),
    orders: sim.crafting.orders.map((order) => ({ recipe: sim.recipes.recipes[order.recipe]!.id, count: order.count, made: order.made })),
    tileDamage: [...sim.tileDamage.entries()].map(([cell, damage]): [number, number] => [cell, damage]),
    regrowth: internals.regrowth.map((entry) => ({ cell: entry.cell, from: tileId(entry.from), to: tileId(entry.to), at: entry.at })),
    spawner: sim.spawner.save(),
    research: sim.research.save(itemId),
    plots: sim.farms.save((crop) => sim.cropKinds.crops[crop]!.id),
    won: internals.worldWon,
    lost: internals.colonyLost,
  };
}

function savedJob(sim: Simulation, job: Job): SavedJob[] {
  if (!(KEPT_JOBS as readonly string[]).includes(job.type)) return [];
  const type = job.type as KeptJob;
  // A ripe crop's harvest belongs to its farm plot, which posts it again.
  if (type === 'harvest' && sim.cropKinds.stageTiles.has(job.target)) return [];
  let target: string | number = job.target;
  if (type === 'build' || type === 'harvest') target = sim.tiles.tiles[job.target]!.id;
  else if (type === 'wall') target = sim.tiles.walls[job.target]!.id;
  else if (type === 'place') target = sim.furnitureKinds.get(job.target).id;
  return [
    {
      type,
      x: job.x,
      y: job.y,
      priority: job.priority,
      cells: [...job.cells],
      layer: job.layer,
      inputs: job.inputs.map(({ item, count }): [string, number] => [sim.items.get(item).id, count]),
      target,
      furnitureId: job.furnitureId,
    },
  ];
}

/**
 * Bring a saved state into a simulation made with `fresh: false` on the saved world.
 * Anything naming content that no longer exists is left out.
 */
export function restoreState(sim: Simulation, state: SimState): void {
  const item = (id: string): number | undefined => (sim.items.has(id) ? sim.items.item(id) : undefined);
  const tile = (id: string): number | undefined => (sim.tiles.hasTile(id) ? sim.tiles.tile(id) : undefined);
  const counts = (list: Array<[string, number]>): Array<{ item: number; count: number }> =>
    list.flatMap(([id, count]) => {
      const n = item(id);
      return n === undefined || count <= 0 ? [] : [{ item: n, count }];
    });

  sim.tick = state.tick;
  sim.time.offsetTicks = state.clock;
  sim.loadInternals({
    nextCreatureId: state.nextCreatureId,
    worldWon: state.won,
    colonyLost: state.lost,
    regrowth: state.regrowth.flatMap((entry) => {
      const from = tile(entry.from);
      const to = tile(entry.to);
      return from === undefined || to === undefined ? [] : [{ cell: entry.cell, from, to, at: entry.at }];
    }),
  });

  // Furniture first: chests make room in storage, and lights shine again.
  const pieceIds = new Map<number, number>();
  for (const saved of state.furniture) {
    if (!sim.furnitureKinds.has(saved.kind)) continue;
    const piece = sim.placeFurniture(sim.furnitureKinds.id(saved.kind), saved.x, saved.y);
    piece.cooldown = saved.cooldown;
    pieceIds.set(saved.id, piece.id);
  }
  for (const { item: n, count } of counts(state.storage)) sim.storage.add(n, count);

  const names = new Set<string>();
  for (const saved of state.dwarves) {
    // A throwaway generator: the colony's own must stay exactly as saved.
    const dwarf = createDwarf(saved.id, saved.x, saved.y, new Rng(saved.id), sim.colony, names);
    const equipment = { ...dwarf.equipment };
    for (const slot of EQUIPMENT_SLOTS) {
      const id = saved.equipment[slot];
      const n = id === undefined ? undefined : item(id);
      if (n !== undefined) equipment[slot] = n;
    }
    sim.dwarves.push({
      ...dwarf,
      name: saved.name,
      looks: { ...saved.looks },
      facing: saved.facing,
      health: saved.health,
      maxHealth: saved.maxHealth,
      hunger: saved.hunger,
      energy: saved.energy,
      skills: Object.fromEntries(SKILLS.map((skill) => [skill, { ...(saved.skills[skill] ?? dwarf.skills[skill]) }])) as Record<Skill, SkillState>,
      equipment,
      carrying: counts(saved.carrying),
      phase: saved.dead ? 'dead' : 'idle',
      deathCause: saved.deathCause,
      restTicks: 0,
    });
    names.add(saved.name);
  }

  for (const saved of state.creatures) {
    if (!sim.creatureKinds.has(saved.kind)) continue;
    const kind = sim.creatureKinds.id(saved.kind);
    const creature = createCreature(saved.id, kind, sim.creatureKinds.get(kind), saved.x, saved.y, saved.origin, { health: 1, damage: 1 }, saved.facing);
    creature.health = saved.health;
    creature.maxHealth = saved.maxHealth;
    creature.damage = saved.damage;
    creature.leaveAt = saved.leaveAt;
    sim.creatures.push(creature);
  }

  for (const stack of state.ground) {
    const n = item(stack.item);
    if (n !== undefined && stack.count > 0) sim.dropItems(n, stack.count, stack.x, stack.y);
  }

  for (const saved of state.jobs) restoreJob(sim, saved, pieceIds, item);

  for (const order of state.orders) {
    if (!sim.recipes.has(order.recipe) || order.count <= order.made) continue;
    const queued = sim.crafting.add(sim.recipes.get(order.recipe).index, order.count - order.made);
    queued.made = order.made;
    queued.count = order.count;
  }

  for (const [cell, damage] of state.tileDamage) sim.tileDamage.add(cell, damage);
  sim.research.restore(state.research, item);
  sim.farms.restore(state.plots, (id) => {
    const index = sim.cropKinds.crops.findIndex((crop) => crop.id === id);
    return index < 0 ? undefined : index;
  });
  sim.spawner.restore(state.spawner);
  const wave = sim.spawner.wave;
  if (wave && wave.phase === 'open') sim.setPortalLight(wave.portal);

  sim.rng.setState(state.rng as unknown as RngState);
  sim.creatureRng.setState(state.creatureRng as unknown as RngState);
  sim.settleAfterLoad();
}

function restoreJob(sim: Simulation, saved: SavedJob, pieceIds: ReadonlyMap<number, number>, item: (id: string) => number | undefined): void {
  if (saved.type === 'hunt') {
    sim.designateHunt(Number(saved.target), saved.priority);
    return;
  }
  if (saved.type === 'revive') {
    sim.designateRevive(Number(saved.target), saved.priority);
    return;
  }
  let target = -1;
  const id = String(saved.target);
  if (saved.type === 'build' || saved.type === 'harvest') {
    if (!sim.tiles.hasTile(id)) return;
    target = sim.tiles.tile(id);
  } else if (saved.type === 'wall') {
    target = sim.tiles.walls.findIndex((wall) => wall.id === id);
    if (target < 0) return;
  } else if (saved.type === 'place') {
    if (!sim.furnitureKinds.has(id)) return;
    target = sim.furnitureKinds.id(id);
  }
  const inputs = saved.inputs.flatMap(([inputId, count]) => {
    const n = item(inputId);
    return n === undefined ? [] : [{ item: n, count }];
  });
  if (inputs.length !== saved.inputs.length) return;
  const furnitureId = saved.type === 'dismantle' ? (pieceIds.get(saved.furnitureId) ?? 0) : 0;
  if (saved.type === 'dismantle' && furnitureId === 0) return;
  sim.jobs.add({
    type: saved.type,
    x: saved.x,
    y: saved.y,
    priority: saved.priority,
    tick: sim.tick,
    cells: saved.cells,
    layer: saved.layer,
    inputs,
    target,
    furnitureId,
  });
}
