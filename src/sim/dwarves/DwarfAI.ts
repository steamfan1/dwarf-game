/**
 * What a dwarf does each tick. The player never steers dwarves; they pick up work from
 * the job board by themselves.
 *
 * Each tick a dwarf, in order:
 *   1. starts falling if the ground under it has gone;
 *   2. carries on with the step it's taking (a walk, jump, climb or fall takes several
 *      ticks), and checks each new step is still possible before taking it;
 *   3. otherwise does what its phase calls for: look for a job, travel, work, pick up,
 *      fetch materials or put things away (see Phase in Dwarf.ts for the sequences).
 *
 * Dwarves look after themselves: they only take jobs they can do from a cell they can
 * get home from (see HomeMaps), and before removing or placing a block they check that
 * nobody, themselves included, would be left somewhere they can't get home from. A
 * dwarf that is stranded anyway (say, the floor gave way) can still take any job it can
 * reach that needs no materials, which lets the player dig it out.
 *
 * Anything a dwarf is left holding (its job was cancelled, it fell, the station it used
 * was taken apart) goes back to storage before it takes on anything else, so materials
 * are never lost.
 *
 * Needs come before work: a hungry dwarf fetches something to eat (and eats it at a
 * table, if there's one near), a tired one goes to bed (at night, or whenever it's worn
 * out), and only then does it look at the job board. Hunger and tiredness slow work down;
 * an empty stomach costs health, and a dwarf that runs out of energy falls asleep where it
 * stands.
 *
 * Danger comes before everything: every few ticks a dwarf looks around, and if a monster
 * is within `combat.engageRange` it drops what it's doing and fights (bare-handed, with a
 * sword, or with a crossbow from a distance). A badly hurt dwarf breaks off and falls back
 * to the Hearth, where it mends; it fights back if cornered there. A sleeping dwarf wakes
 * when it's attacked, when a monster comes right up to it, or when a door is being
 * smashed nearby. Hunting an animal the player marked works the same way as a fight.
 *
 * Paths come from the PathService, which may say 'busy' when this tick's pathfinding
 * budget is used up; the dwarf then asks again next tick. Work progress is kept on the
 * job, so an interrupted dig or craft isn't lost.
 *
 * Pure: no Phaser and no DOM. Changes to the world go through the ColonyContext, which
 * keeps lighting, pathfinding, the job board, storage and the renderer in step.
 */
import type { Rng } from '../../core/Rng';
import type { Creature } from '../creatures/Creature';
import type { ColonyStorage, GroundItems } from '../items/Items';
import type { ItemRegistry, ProjectileKind } from '../items/ItemRegistry';
import { PERSONAL_JOBS, type Job, type JobBoard } from '../jobs/JobBoard';
import type { HomeMaps } from '../nav/HomeMaps';
import type { NavGrid } from '../nav/NavGrid';
import { distanceToArea, type PathGoal } from '../nav/Pathfinder';
import type { PathService } from '../nav/PathService';
import type { TileRegistry } from '../world/TileRegistry';
import type { Tree, TreeFinder } from '../world/trees';
import type { CellRect, World } from '../world/World';
import type { DeathCause } from '../events';
import { gainXp, type Dwarf, type Movement, type Skill } from './Dwarf';
import type { ColonySettings } from './settings';

/** How needs change each tick (worked out from dwarves.json and the length of day and night). */
export interface NeedRates {
  /** Hunger lost per tick. */
  hunger: number;
  /** Energy lost per tick awake. */
  energy: number;
  /** Energy regained per tick asleep in a bed (before floor or room adjustments). */
  sleep: number;
  /** Health regained per tick asleep in a bed. */
  heal: number;
  /** Health lost per tick while starving. */
  starve: number;
  /** Health regained per tick resting by the Hearth. */
  rest: number;
}

/** What a dwarf fights with: damage per blow, ticks between blows, reach, and what it shoots (if it does). */
export interface Weapon {
  damage: number;
  attackTicks: number;
  range: number;
  projectile: ProjectileKind | null;
}

/** Everything the dwarves need from the simulation. */
export interface ColonyContext {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly items: ItemRegistry;
  readonly colony: ColonySettings;
  readonly nav: NavGrid;
  readonly paths: PathService;
  readonly homeMaps: HomeMaps;
  readonly jobs: JobBoard;
  readonly ground: GroundItems;
  readonly storage: ColonyStorage;
  readonly trees: TreeFinder;
  readonly rng: Rng;
  readonly hearth: { x: number; y: number };
  /** The Hearth's cells: home, where dwarves must always be able to get back to. */
  readonly storeArea: CellRect;
  readonly dwarves: readonly Dwarf[];
  readonly tick: number;
  readonly needRates: NeedRates;
  isNight(): boolean;
  /** Whether a block can still be dug (it's there, diggable, and holds up nothing important). */
  canDigNow(x: number, y: number): boolean;
  /** Whether a dwarf standing in `cell` could do `job` from there. */
  workCellOk(job: Job, cell: number): boolean;
  /** Whether some dwarf could do `job` from a cell it can get to from home and back. */
  jobWorkable(job: Job): boolean;
  /** Whether a dwarf could take a job on now (materials in storage, a free station, room for a haul...). */
  canTake(job: Job, dwarf: Dwarf): boolean;
  /** Claim a job and set aside what it needs. False if that's no longer possible. */
  takeJob(job: Job, dwarf: Dwarf): boolean;
  /** A trip to fetch better gear from storage, already claimed by the dwarf, or null if there's none. */
  startEquip(dwarf: Dwarf): Job | null;
  /** A meal from storage, claimed by the dwarf (at a table if one is near), or null if there's no food. */
  startMeal(dwarf: Dwarf): Job | null;
  /** Going to bed: the nearest free bed, or the floor by the Hearth. Claimed by the dwarf. */
  startSleep(dwarf: Dwarf): Job;
  /** How fast a sleeping dwarf recovers, as a multiple of a night in bed. */
  sleepRate(dwarf: Dwarf): number;
  /** Whether there's food in storage nobody has claimed. */
  foodAvailable(): boolean;
  /** The places goods are stored and fetched: the Hearth and every chest, whichever is nearest. */
  storageGoal(): PathGoal;
  /** The cells a job is done beside (the block, a furniture footprint, the station). */
  jobArea(job: Job): CellRect;
  /** Whether a job can still be done as planned; if not, it is dropped. */
  siteValid(job: Job): boolean;
  /** Ticks of work a job needs from this dwarf (or, without one, from a beginner with bare hands). */
  workRequired(job: Job, dwarf?: Dwarf): number;
  /** A cell a builder needs clear (a block is about to go there). */
  wantsClear(cell: number): boolean;
  /** A hand-made craft, worked where its materials were fetched. */
  isHandCraft(job: Job): boolean;
  /** Take the materials reserved for a job out of storage into the dwarf's arms. False if they're gone. */
  fetchFor(job: Job, dwarf: Dwarf): boolean;
  /** Put everything a dwarf carries into storage. */
  storeCarried(dwarf: Dwarf): void;
  /** Put on the gear an equip trip fetched. */
  equip(dwarf: Dwarf, job: Job): void;
  /** A dwarf finished a block, wall or piece of furniture with what it carries. */
  completeBuild(job: Job, by: Dwarf): boolean;
  /** A dwarf finished a craft: the output goes into its arms. */
  completeCraft(job: Job, by: Dwarf): boolean;
  /** A dwarf took a piece of furniture apart. */
  completeDismantle(job: Job): void;
  /** A dwarf ate the meal it carried. */
  completeMeal(job: Job, by: Dwarf): boolean;
  /** A dwarf picked a plant. */
  harvestPlant(job: Job, by: Dwarf): void;
  /** A dwarf is starving (announced now and then). */
  starving(dwarf: Dwarf): void;
  /** A dwarf ran out of energy and fell asleep where it stood. */
  collapsed(dwarf: Dwarf): void;
  /** A dwarf finished digging a block. */
  removeBlock(x: number, y: number, by: Dwarf): void;
  /** A dwarf finished chopping a tree. */
  fellTree(tree: Tree, by: Dwarf): void;
  /** Drop items in a cell, with a haul job for each new stack. `skipDwarf` won't take that job. */
  dropItems(item: number, count: number, x: number, y: number, skipDwarf?: number): void;
  /** Uncover the cells around a dwarf. */
  reveal(x: number, y: number, radius: number): void;
  dwarfDied(dwarf: Dwarf, cause: DeathCause, by: string | null): void;
  skillUp(dwarf: Dwarf, skill: Skill): void;
  /** A living creature by id. */
  creature(id: number): Creature | undefined;
  isHostile(creature: Creature): boolean;
  /** The nearest hostile creature within `range` tiles that the dwarf isn't steering clear of. */
  nearestHostile(dwarf: Dwarf, range: number): Creature | undefined;
  /** A fight of the dwarf's own with a creature, claimed at once. */
  startFight(dwarf: Dwarf, creature: Creature): Job;
  weaponOf(dwarf: Dwarf): Weapon;
  strikeCreature(dwarf: Dwarf, creature: Creature, damage: number): void;
  dwarfShoots(dwarf: Dwarf, creature: Creature, weapon: Weapon): void;
  learnCombat(dwarf: Dwarf, xp: number): void;
  /** Whether a missile could fly between two cells. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean;
  /** Whether a door or block is being smashed near (x, y) right now. */
  noiseNear(x: number, y: number): boolean;
  /** A badly hurt dwarf is falling back to the Hearth. */
  dwarfRetreating(dwarf: Dwarf): void;
  /** A dwarf poured the revival draught it carries on a fallen dwarf. */
  completeRevive(job: Job, by: Dwarf): boolean;
}

function isDead(dwarf: Dwarf): boolean {
  return dwarf.phase === 'dead';
}

/** Tiles between a dwarf and a creature (king moves). */
function distance(dwarf: Dwarf, creature: Creature): number {
  return Math.max(Math.abs(creature.x - dwarf.x), Math.abs(creature.y - dwarf.y));
}

/** On its feet and able to act: not dead and not in the middle of a fall. */
function isActive(dwarf: Dwarf): boolean {
  return dwarf.phase !== 'dead' && dwarf.phase !== 'falling';
}

/** Idle dwarves look for work this often (ticks). */
const IDLE_CHECK_TICKS = 10;
/** Chance per idle check that a dwarf with nothing to do goes for a stroll. */
const WANDER_CHANCE = 0.25;
/** A builder waits this long (ticks) for someone to get out of the way before giving up. */
const MAX_WAIT_TICKS = 100;
/** Before a block goes in, dwarves this close (tiles) are checked to still have a way home. */
const PLACE_SAFETY_RADIUS = 8;
/** Dwarves look around for danger this often (ticks). */
const SCAN_TICKS = 4;
/** A dwarf hurt this recently (ticks) knows it is under attack. */
const UNDER_ATTACK_TICKS = 40;
/** A monster this close (tiles) wakes a sleeping dwarf. */
const WAKE_DISTANCE = 3;
/** A creature a dwarf couldn't get to is left alone this long (ticks). */
const IGNORE_TICKS = 300;
/** A dwarf chasing a creature plans a new path at most this often (ticks). */
const CHASE_REPLAN_TICKS = 10;
/** "By the Hearth": within this many tiles of it, a dwarf rests and mends. */
const HEARTH_REST_DISTANCE = 2;

export class DwarfAI {
  private readonly ctx: ColonyContext;

  constructor(ctx: ColonyContext) {
    this.ctx = ctx;
  }

  update(dwarf: Dwarf): void {
    if (isDead(dwarf)) return;
    const { nav, world } = this.ctx;

    this.tickNeeds(dwarf);
    if (isDead(dwarf)) return;
    dwarf.hurtTicks++;
    dwarf.strikeTicks++;
    if (dwarf.attackCooldown > 0) dwarf.attackCooldown--;
    if (dwarf.chaseTicks > 0) dwarf.chaseTicks--;
    if (!dwarf.movement && isActive(dwarf) && !nav.standable(dwarf.x, dwarf.y)) this.startFalling(dwarf);
    // Out of energy: it drops whatever it was doing and falls asleep on the spot.
    if (!dwarf.movement && isActive(dwarf) && dwarf.phase !== 'sleeping' && dwarf.energy <= 0) this.collapse(dwarf);

    if (dwarf.movement) {
      dwarf.movement.elapsed++;
      if (dwarf.movement.elapsed < dwarf.movement.duration) return;
      this.arrive(dwarf);
      if (!isActive(dwarf)) return;
    }

    this.watchForDanger(dwarf);
    // A fighter stops as soon as its foe is within reach (or about to be), and plans again
    // if the foe has moved on.
    if (dwarf.phase === 'fighting' && dwarf.path) {
      const foe = this.foe(dwarf);
      const weapon = this.ctx.weaponOf(dwarf);
      if (!foe || this.canStrike(dwarf, foe, weapon) || this.closingIn(dwarf, foe, weapon) || (dwarf.chaseTicks === 0 && this.foeMoved(dwarf, foe))) {
        dwarf.path = null;
      }
    }
    if (dwarf.path && this.followPath(dwarf)) return;

    if (dwarf.restTicks > 0) dwarf.restTicks--;
    switch (dwarf.phase) {
      case 'idle':
        // Standing where a block is about to go: make way.
        if (this.ctx.wantsClear(world.index(dwarf.x, dwarf.y))) this.stepAside(dwarf);
        else if (dwarf.restTicks === 0) this.chooseWork(dwarf);
        break;
      case 'to-job':
      case 'to-item':
      case 'to-storage':
      case 'to-supply':
      case 'wandering':
      case 'retreating':
        this.travel(dwarf);
        break;
      case 'fighting':
        this.fight(dwarf);
        break;
      case 'working':
        this.work(dwarf);
        break;
      case 'picking-up':
        this.pickUp(dwarf);
        break;
      case 'dropping-off':
        this.dropOff(dwarf);
        break;
      case 'fetching':
        this.fetch(dwarf);
        break;
      case 'sleeping':
        this.sleep(dwarf);
        break;
      case 'falling':
      case 'dead':
        break;
    }
  }

  // ---- Needs ---------------------------------------------------------------------------------

  /** Hunger and energy run down (energy comes back while asleep); starving costs health; the Hearth mends. */
  private tickNeeds(dwarf: Dwarf): void {
    const rates = this.ctx.needRates;
    dwarf.hunger = Math.max(0, dwarf.hunger - rates.hunger);
    if (dwarf.phase === 'sleeping') {
      const rate = this.ctx.sleepRate(dwarf);
      dwarf.energy = Math.min(100, dwarf.energy + rates.sleep * rate);
      dwarf.health = Math.min(dwarf.maxHealth, dwarf.health + rates.heal * rate);
    } else if (dwarf.phase !== 'falling') {
      dwarf.energy = Math.max(0, dwarf.energy - rates.energy);
      if (dwarf.phase !== 'fighting' && dwarf.hunger > 0 && this.byTheHearth(dwarf)) {
        dwarf.health = Math.min(dwarf.maxHealth, dwarf.health + rates.rest);
      }
    }
    if (dwarf.hunger > 0) return;
    dwarf.health -= rates.starve;
    if (dwarf.health <= 0) this.die(dwarf, 'starvation');
    else this.ctx.starving(dwarf);
  }

  private collapse(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    this.toIdle(dwarf);
    dwarf.phase = 'sleeping';
    this.ctx.collapsed(dwarf);
  }

  /** Asleep: wake once rested and the night is over, or if hunger can't wait (and there's food). */
  private sleep(dwarf: Dwarf): void {
    const job = dwarf.jobId !== 0 ? this.myJob(dwarf) : undefined;
    const n = this.ctx.colony.needs;
    // The bed went (taken apart), or someone else has it now.
    const lostBed = dwarf.jobId !== 0 && !job;
    const rested = dwarf.energy >= 100 && !this.ctx.isNight();
    const famished = dwarf.hunger < n.hungryBelow && this.ctx.foodAvailable();
    if (!lostBed && !rested && !famished) return;
    if (job) this.ctx.jobs.remove(job.id);
    this.toIdle(dwarf);
  }

  /** Whether a dwarf should go to bed now: tired at night, or worn out at any time. */
  private sleepy(dwarf: Dwarf): boolean {
    const n = this.ctx.colony.needs;
    return dwarf.energy < n.sleepBelow || (this.ctx.isNight() && dwarf.energy < n.sleepAtNightBelow);
  }

  /** A dwarf that can't get home from where it stands (it fell into a hole, say). */
  isStranded(dwarf: Dwarf): boolean {
    return !this.ctx.homeMaps.canGetHome(this.ctx.world.index(dwarf.x, dwarf.y));
  }

  // ---- Choosing what to do ------------------------------------------------------------

  private chooseWork(dwarf: Dwarf): void {
    const { jobs } = this.ctx;
    // Hands full (a job fell through)? Put it all away first.
    if (dwarf.carrying.length > 0) {
      dwarf.phase = 'to-storage';
      dwarf.path = null;
      this.travel(dwarf);
      return;
    }
    const stranded = this.isStranded(dwarf);
    // Needs first: a meal, then bed.
    if (!stranded && dwarf.hunger < this.ctx.colony.needs.eatBelow) {
      const meal = this.ctx.startMeal(dwarf);
      if (meal) {
        this.begin(dwarf, meal, 'to-supply');
        return;
      }
    }
    if (this.sleepy(dwarf)) {
      if (stranded) {
        // No way home: sleep right here.
        dwarf.phase = 'sleeping';
        return;
      }
      this.begin(dwarf, this.ctx.startSleep(dwarf), 'to-job');
      return;
    }
    // Better gear in storage comes next: it makes the rest of the work go faster.
    const equip = stranded ? null : this.ctx.startEquip(dwarf);
    if (equip) {
      this.begin(dwarf, equip, 'to-supply');
      return;
    }
    const job = jobs.bestFor(dwarf.id, dwarf.x, dwarf.y, (candidate) => {
      // A stranded dwarf can't get to storage, so it only takes work that needs nothing from there.
      if (stranded && (candidate.type === 'haul' || candidate.inputs.length > 0)) return false;
      return this.ctx.canTake(candidate, dwarf) && (stranded || this.ctx.jobWorkable(candidate));
    });
    if (job && this.ctx.takeJob(job, dwarf)) {
      if (job.type === 'hunt') {
        // A hunt is a fight with an animal: go after it.
        dwarf.jobId = job.id;
        dwarf.phase = 'fighting';
        dwarf.path = null;
        dwarf.chaseTicks = 0;
        return;
      }
      this.begin(dwarf, job, job.type === 'haul' ? 'to-item' : job.inputs.length > 0 ? 'to-supply' : 'to-job');
      return;
    }
    dwarf.restTicks = IDLE_CHECK_TICKS;
    if (!stranded && this.ctx.rng.chance(WANDER_CHANCE)) this.startWandering(dwarf);
  }

  private begin(dwarf: Dwarf, job: Job, phase: 'to-item' | 'to-supply' | 'to-job'): void {
    dwarf.jobId = job.id;
    dwarf.phase = phase;
    dwarf.path = null;
    dwarf.workTicks = 0;
    dwarf.waitTicks = 0;
    this.travel(dwarf);
  }

  /** The dwarf's job, if it still holds it (a job can be cancelled, or taken back when its station goes). */
  private myJob(dwarf: Dwarf): Job | undefined {
    const job = dwarf.jobId === 0 ? undefined : this.ctx.jobs.get(dwarf.jobId);
    return job && job.claimedBy === dwarf.id ? job : undefined;
  }

  private startWandering(dwarf: Dwarf): void {
    const { nav, hearth, colony, rng, world, homeMaps } = this.ctx;
    const radius = colony.work.wanderRadius;
    if (radius === 0) return;
    const x = hearth.x + rng.int(-radius, radius);
    // Somewhere to stand in that column, near the Hearth's level, that leads back home.
    for (let y = hearth.y - 3; y <= hearth.y + 3; y++) {
      if (!world.inBounds(x, y) || (x === dwarf.x && y === dwarf.y)) continue;
      if (nav.standable(x, y) && homeMaps.workable(world.index(x, y)) && !this.ctx.wantsClear(world.index(x, y))) {
        dwarf.wanderTarget = world.index(x, y);
        dwarf.phase = 'wandering';
        dwarf.path = null;
        return;
      }
    }
  }

  /** Move off a cell a builder needs: one step to anywhere nobody is about to build. */
  private stepAside(dwarf: Dwarf): void {
    const { nav, world } = this.ctx;
    let target = -1;
    nav.forEachMove(world.index(dwarf.x, dwarf.y), (to) => {
      if (target < 0 && !this.ctx.wantsClear(to)) target = to;
    });
    if (target < 0) return;
    dwarf.wanderTarget = target;
    dwarf.phase = 'wandering';
    dwarf.path = null;
    this.travel(dwarf);
  }

  // ---- Travelling ------------------------------------------------------------------------

  /** Where the current phase is heading, or null if there is nothing to head for. */
  private goalFor(dwarf: Dwarf): PathGoal | null {
    const { world, homeMaps } = this.ctx;
    if (dwarf.phase === 'wandering') {
      if (dwarf.wanderTarget < 0) return null;
      const x = dwarf.wanderTarget % world.width;
      const y = (dwarf.wanderTarget - x) / world.width;
      return { area: { x0: x, y0: y, x1: x, y1: y }, reach: 0 };
    }
    if (dwarf.phase === 'to-storage' || dwarf.phase === 'to-supply') {
      if (dwarf.phase === 'to-supply' && !this.myJob(dwarf)) return null;
      return this.ctx.storageGoal();
    }
    if (dwarf.phase === 'retreating') return { area: this.ctx.storeArea, reach: HEARTH_REST_DISTANCE, cacheKey: 'hearth' };
    const job = this.myJob(dwarf);
    if (!job) return null;
    const stranded = this.isStranded(dwarf);
    // Stand somewhere the job can be done from, and (unless already stranded) that leads back home.
    const accept = (cell: number): boolean => this.ctx.workCellOk(job, cell) && (stranded || homeMaps.workable(cell));
    // Hauls are picked up where they lie; a dwarf lies down in its bed itself.
    const inside = job.type === 'haul' || (job.type === 'sleep' && job.furnitureId !== 0);
    return { area: this.ctx.jobArea(job), reach: inside ? 0 : 1, accept };
  }

  private travel(dwarf: Dwarf): void {
    const { paths, world } = this.ctx;
    if (dwarf.path) return;
    const goal = this.goalFor(dwarf);
    if (!goal) {
      this.giveUp(dwarf);
      return;
    }
    const outcome = paths.request(world.index(dwarf.x, dwarf.y), goal);
    if (outcome === 'busy') return;
    if (!outcome.found) {
      this.cannotReach(dwarf);
      return;
    }
    dwarf.path = outcome.cells;
    dwarf.pathIndex = 0;
    this.followPath(dwarf);
  }

  /** Take the next step of the path, or finish it. Returns true while still on the way. */
  private followPath(dwarf: Dwarf): boolean {
    const { nav, world } = this.ctx;
    const path = dwarf.path!;
    if (dwarf.pathIndex >= path.length) {
      dwarf.path = null;
      this.reachedDestination(dwarf);
      return false;
    }
    const from = world.index(dwarf.x, dwarf.y);
    const to = path[dwarf.pathIndex]!;
    if (!nav.canStep(from, to)) {
      // The terrain changed under the plan: plan again from here.
      dwarf.path = null;
      return false;
    }
    dwarf.pathIndex++;
    this.startMove(dwarf, from, to);
    return true;
  }

  private reachedDestination(dwarf: Dwarf): void {
    dwarf.workTicks = 0;
    switch (dwarf.phase) {
      case 'to-job':
        dwarf.phase = this.myJob(dwarf)?.type === 'sleep' ? 'sleeping' : 'working';
        break;
      case 'to-item':
        dwarf.phase = 'picking-up';
        break;
      case 'to-storage':
        dwarf.phase = 'dropping-off';
        break;
      case 'to-supply':
        dwarf.phase = 'fetching';
        break;
      case 'wandering':
        dwarf.phase = 'idle';
        dwarf.wanderTarget = -1;
        dwarf.restTicks = this.ctx.rng.int(40, 140);
        break;
      case 'retreating':
        // Home: rest by the Hearth a while.
        dwarf.phase = 'idle';
        dwarf.restTicks = 40;
        break;
      default:
        break;
    }
  }

  /** No way to the goal: skip that job, or put down what the dwarf carries. */
  private cannotReach(dwarf: Dwarf): void {
    const { jobs } = this.ctx;
    const wasWandering = dwarf.phase === 'wandering' || dwarf.phase === 'retreating';
    if (dwarf.phase === 'to-storage' && dwarf.carrying.length > 0) {
      // No way to any store: leave the load here for someone else (or later).
      const job = this.myJob(dwarf);
      if (job?.type === 'haul') jobs.remove(job.id);
      this.dropAll(dwarf, dwarf.id);
    } else if (this.myJob(dwarf)?.type === 'sleep') {
      // Can't get to bed: sleep where it stands instead.
      jobs.remove(dwarf.jobId);
      this.toIdle(dwarf);
      dwarf.phase = 'sleeping';
      return;
    } else if (dwarf.jobId !== 0) {
      jobs.markUnreachable(dwarf.jobId, dwarf.id);
      jobs.release(dwarf.jobId, dwarf.id);
    }
    this.toIdle(dwarf);
    // After a failed stroll, wait a moment; after an unreachable job, try the next one at once.
    if (wasWandering) dwarf.restTicks = IDLE_CHECK_TICKS;
  }

  /** The job went away: stop. Anything carried is put away on the next look for work. */
  private giveUp(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    this.toIdle(dwarf);
  }

  private toIdle(dwarf: Dwarf): void {
    dwarf.phase = 'idle';
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.wanderTarget = -1;
    dwarf.workTicks = 0;
    dwarf.waitTicks = 0;
  }

  private dropAll(dwarf: Dwarf, skipDwarf?: number): void {
    for (const { item, count } of dwarf.carrying) this.ctx.dropItems(item, count, dwarf.x, dwarf.y, skipDwarf);
    dwarf.carrying = [];
  }

  // ---- Moving ------------------------------------------------------------------------------

  private startMove(dwarf: Dwarf, from: number, to: number): void {
    const { nav, colony, world } = this.ctx;
    const kind = nav.moveKind(from, to);
    const m = colony.movement;
    const fx = from % world.width;
    const tx = to % world.width;
    const ty = (to - tx) / world.width;
    const rows = ty - (from - fx) / world.width;
    let duration: number;
    switch (kind) {
      case 'walk':
        duration = nav.waterAt(tx, ty) ? m.swimTicks : m.walkTicks;
        break;
      case 'jump':
        duration = m.jumpTicks;
        break;
      case 'climb':
        duration = m.climbTicks;
        break;
      case 'swim':
        duration = m.swimTicks;
        break;
      case 'drop':
        duration = (tx !== fx ? m.walkTicks : 0) + rows * m.fallTicksPerRow;
        break;
    }
    if (tx !== fx) dwarf.facing = tx > fx ? 1 : -1;
    dwarf.movement = { from, to, kind, elapsed: 0, duration: Math.max(1, duration) } satisfies Movement;
  }

  private arrive(dwarf: Dwarf): void {
    const { world, nav, colony } = this.ctx;
    const movement = dwarf.movement!;
    dwarf.movement = null;
    const x = movement.to % world.width;
    const y = (movement.to - x) / world.width;
    dwarf.x = x;
    dwarf.y = y;
    this.ctx.reveal(x, y, colony.vision.radius);
    if (movement.kind !== 'fall') return;

    dwarf.fallRows++;
    if (!nav.standable(x, y)) {
      this.fallOneRow(dwarf);
      return;
    }
    const excess = dwarf.fallRows - colony.movement.safeDrop;
    dwarf.fallRows = 0;
    dwarf.phase = 'idle';
    if (excess > 0) {
      dwarf.health -= excess * colony.movement.fallDamagePerRow;
      if (dwarf.health <= 0) this.die(dwarf, 'fall');
    }
  }

  private startFalling(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.wanderTarget = -1;
    dwarf.phase = 'falling';
    dwarf.fallRows = 0;
    this.fallOneRow(dwarf);
  }

  private fallOneRow(dwarf: Dwarf): void {
    const { world, nav, colony } = this.ctx;
    if (!nav.passable(dwarf.x, dwarf.y + 1)) {
      // Nothing to fall into: lava below kills, anything else means the dwarf has landed.
      if (world.inBounds(dwarf.x, dwarf.y + 1) && !nav.solidAt(dwarf.x, dwarf.y + 1)) this.die(dwarf, 'lava');
      else dwarf.phase = 'idle';
      return;
    }
    const from = world.index(dwarf.x, dwarf.y);
    dwarf.movement = { from, to: from + world.width, kind: 'fall', elapsed: 0, duration: colony.movement.fallTicksPerRow };
  }

  private die(dwarf: Dwarf, cause: DeathCause, by: string | null = null): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    this.dropAll(dwarf);
    dwarf.health = 0;
    dwarf.phase = 'dead';
    dwarf.deathCause = cause;
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.movement = null;
    this.ctx.dwarfDied(dwarf, cause, by);
  }

  /** Killed (by a monster's blow or missile). */
  kill(dwarf: Dwarf, cause: DeathCause, by: string | null): void {
    if (!isDead(dwarf)) this.die(dwarf, cause, by);
  }

  /** Brought back to life (by a revival draught) with this fraction of its health. */
  revive(dwarf: Dwarf, health: number): void {
    if (!isDead(dwarf)) return;
    dwarf.phase = 'idle';
    dwarf.deathCause = null;
    dwarf.health = Math.max(1, dwarf.maxHealth * health);
    dwarf.hunger = Math.max(dwarf.hunger, 50);
    dwarf.energy = Math.max(dwarf.energy, 50);
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.movement = null;
    dwarf.fallRows = 0;
    dwarf.restTicks = 20;
    dwarf.lastAttacker = 0;
    dwarf.ignoring = [];
  }

  // ---- Fighting --------------------------------------------------------------------------------

  /**
   * Every few ticks: look around. Monsters near (or one that just struck it) mean a fight,
   * or for a badly hurt dwarf, a run for the Hearth. A sleeper only wakes for close danger.
   */
  private watchForDanger(dwarf: Dwarf): void {
    if (!isActive(dwarf) || --dwarf.scanTicks > 0) return;
    dwarf.scanTicks = SCAN_TICKS;
    const { ctx } = this;
    const combat = ctx.colony.combat;
    if (dwarf.phase === 'retreating') return;
    const tick = ctx.tick;
    if (dwarf.ignoring.length > 0) dwarf.ignoring = dwarf.ignoring.filter((entry) => entry.until > tick);
    const underAttack = tick - dwarf.lastHurtTick < UNDER_ATTACK_TICKS;
    const attacker = underAttack ? ctx.creature(dwarf.lastAttacker) : undefined;
    const near = ctx.nearestHostile(dwarf, combat.engageRange);
    const enemy = attacker && distance(dwarf, attacker) <= combat.engageRange + 3 ? attacker : near;
    const badlyHurt = dwarf.health < combat.retreatBelow * dwarf.maxHealth;

    if (dwarf.phase === 'fighting') {
      const foe = this.foe(dwarf);
      if (foe && ctx.isHostile(foe)) {
        if (badlyHurt && !this.cornered(dwarf, foe)) this.retreat(dwarf);
        return;
      }
      // Hunting an animal: a monster comes first.
      if (!enemy) return;
    }

    if (dwarf.phase === 'sleeping') {
      const close = enemy !== undefined && distance(dwarf, enemy) <= WAKE_DISTANCE;
      if (!underAttack && !close && !ctx.noiseNear(dwarf.x, dwarf.y)) return;
      this.wake(dwarf);
    }
    if (!enemy) return;
    if (dwarf.health < combat.engageAbove * dwarf.maxHealth && !this.cornered(dwarf, enemy)) {
      if (!this.byTheHearth(dwarf) && !this.isStranded(dwarf)) this.retreat(dwarf);
      return;
    }
    this.engage(dwarf, enemy);
  }

  /** Nowhere to run: at the Hearth already, or with no way home, and the enemy is upon it. */
  private cornered(dwarf: Dwarf, enemy: Creature): boolean {
    const underAttack = this.ctx.tick - dwarf.lastHurtTick < UNDER_ATTACK_TICKS;
    return (this.byTheHearth(dwarf) || this.isStranded(dwarf)) && (underAttack || distance(dwarf, enemy) <= 1);
  }

  private byTheHearth(dwarf: Dwarf): boolean {
    const home = this.ctx.storeArea;
    return Math.max(home.x0 - dwarf.x, 0, dwarf.x - home.x1, home.y0 - dwarf.y, 0, dwarf.y - home.y1) <= HEARTH_REST_DISTANCE;
  }

  /** Drop everything and take on a creature. */
  private engage(dwarf: Dwarf, enemy: Creature): void {
    this.dropJob(dwarf);
    const fight = this.ctx.startFight(dwarf, enemy);
    dwarf.jobId = fight.id;
    dwarf.phase = 'fighting';
    dwarf.chaseTicks = 0;
  }

  /** Break off and run for the Hearth. */
  private retreat(dwarf: Dwarf): void {
    this.dropJob(dwarf);
    dwarf.phase = 'retreating';
    this.ctx.dwarfRetreating(dwarf);
    this.travel(dwarf);
  }

  private wake(dwarf: Dwarf): void {
    this.dropJob(dwarf);
  }

  /** Give up the current job (its own jobs, like a nap, simply end); what it carries stays in its arms. */
  private dropJob(dwarf: Dwarf): void {
    const job = this.myJob(dwarf);
    if (job) {
      if (PERSONAL_JOBS.has(job.type)) this.ctx.jobs.remove(job.id);
      else this.ctx.jobs.release(job.id, dwarf.id);
    }
    this.toIdle(dwarf);
  }

  /** The creature the dwarf is fighting or hunting, if it's still about. */
  private foe(dwarf: Dwarf): Creature | undefined {
    const job = this.myJob(dwarf);
    return job && (job.type === 'fight' || job.type === 'hunt') ? this.ctx.creature(job.target) : undefined;
  }

  /** Strike if the foe is within reach; otherwise go after it. */
  private fight(dwarf: Dwarf): void {
    const { ctx } = this;
    const job = this.myJob(dwarf);
    const foe = this.foe(dwarf);
    if (!job || !foe) {
      // It's dead, gone, or the fight was called off.
      if (job) ctx.jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    const weapon = ctx.weaponOf(dwarf);
    if (this.canStrike(dwarf, foe, weapon)) {
      dwarf.path = null;
      if (foe.x !== dwarf.x) dwarf.facing = foe.x > dwarf.x ? 1 : -1;
      if (dwarf.attackCooldown > 0) return;
      dwarf.attackCooldown = weapon.attackTicks;
      dwarf.strikeTicks = 0;
      if (weapon.range > 1 && weapon.projectile) {
        ctx.dwarfShoots(dwarf, foe, weapon);
      } else {
        ctx.strikeCreature(dwarf, foe, weapon.damage);
        ctx.learnCombat(dwarf, ctx.colony.combat.xpPerHit);
      }
      return;
    }
    // It's stepping into reach: wait for it rather than walk into the cell it's taking.
    if (this.closingIn(dwarf, foe, weapon)) return;
    if (!dwarf.path) this.chase(dwarf, job, foe);
  }

  /**
   * Whether the foe is part-way through a step that ends where the dwarf could strike it
   * from where it stands (melee only). Fighters who both stepped toward each other would
   * otherwise meet in the same cell and fight there, one hiding the other.
   */
  private closingIn(dwarf: Dwarf, foe: Creature, weapon: Weapon): boolean {
    if (!foe.movement || (weapon.range > 1 && weapon.projectile)) return false;
    const width = this.ctx.world.width;
    const x = foe.movement.to % width;
    return this.withinMeleeReach(dwarf.x, dwarf.y, x, (foe.movement.to - x) / width);
  }

  /** Whether the foe has moved away from where the dwarf's path leads. */
  private foeMoved(dwarf: Dwarf, foe: Creature): boolean {
    const width = this.ctx.world.width;
    if (dwarf.chaseGoal < 0) return true;
    const gx = dwarf.chaseGoal % width;
    const gy = (dwarf.chaseGoal - gx) / width;
    return Math.max(Math.abs(gx - foe.x), Math.abs(gy - foe.y)) > 1;
  }

  /** Plan a way to the foe (somewhere it can get home from, unless it can't anyway). */
  private chase(dwarf: Dwarf, job: Job, foe: Creature): void {
    const { ctx } = this;
    const stranded = this.isStranded(dwarf);
    const goal: PathGoal = {
      area: { x0: foe.x, y0: foe.y, x1: foe.x, y1: foe.y },
      reach: 1,
      accept: (cell) => stranded || ctx.homeMaps.workable(cell),
    };
    const outcome = ctx.paths.request(ctx.world.index(dwarf.x, dwarf.y), goal);
    if (outcome === 'busy') return;
    dwarf.chaseTicks = CHASE_REPLAN_TICKS;
    if (!outcome.found) {
      // Out of reach: leave it be for a while.
      dwarf.ignoring.push({ creature: foe.id, until: ctx.tick + IGNORE_TICKS });
      if (job.type === 'hunt') {
        ctx.jobs.markUnreachable(job.id, dwarf.id);
        ctx.jobs.release(job.id, dwarf.id);
      } else {
        ctx.jobs.remove(job.id);
      }
      this.toIdle(dwarf);
      dwarf.restTicks = IDLE_CHECK_TICKS;
      return;
    }
    dwarf.path = outcome.cells;
    dwarf.pathIndex = 0;
    dwarf.chaseGoal = ctx.world.index(foe.x, foe.y);
  }

  /** Whether the dwarf could strike (or shoot) the creature from where it stands. */
  private canStrike(dwarf: Dwarf, foe: Creature, weapon: Weapon): boolean {
    if (weapon.range > 1 && weapon.projectile) {
      const dx = foe.x - dwarf.x;
      const dy = foe.y - dwarf.y;
      return dx * dx + dy * dy <= weapon.range * weapon.range && this.ctx.lineOfSight(dwarf.x, dwarf.y, foe.x, foe.y);
    }
    return this.withinMeleeReach(dwarf.x, dwarf.y, foe.x, foe.y);
  }

  /** Whether a blow can be struck between two cells: next to each other (or the same), but not round a corner. */
  private withinMeleeReach(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dx > 1 || dy > 1) return false;
    if (dx === 1 && dy === 1) {
      // Not round a corner: one of the two cells between them must be open.
      const { nav } = this.ctx;
      return nav.passable(x0, y1) || nav.passable(x1, y0);
    }
    return true;
  }

  // ---- Working --------------------------------------------------------------------------------

  private work(dwarf: Dwarf): void {
    const job = this.myJob(dwarf);
    if (!job) {
      this.toIdle(dwarf);
      return;
    }
    switch (job.type) {
      case 'dig':
      case 'chop':
        this.harvest(dwarf, job);
        break;
      case 'build':
      case 'wall':
      case 'place':
        this.build(dwarf, job);
        break;
      case 'dismantle':
        this.dismantle(dwarf, job);
        break;
      case 'craft':
        this.craft(dwarf, job);
        break;
      case 'eat':
        this.eat(dwarf, job);
        break;
      case 'harvest':
        this.pick(dwarf, job);
        break;
      case 'revive':
        this.pourDraught(dwarf, job);
        break;
      default:
        this.giveUp(dwarf);
    }
  }

  /** Pour a revival draught on a fallen dwarf. */
  private pourDraught(dwarf: Dwarf, job: Job): void {
    if (!this.ctx.siteValid(job)) {
      this.ctx.jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    this.toIdle(dwarf);
    if (!this.ctx.completeRevive(job, dwarf)) this.ctx.jobs.remove(job.id);
  }

  /** Eat the meal in hand: at its table (walking back to it if need be), or right here without one. */
  private eat(dwarf: Dwarf, job: Job): void {
    if (job.furnitureId !== 0 && !this.labour(dwarf, job)) return;
    if (job.furnitureId === 0 && job.progress++ < this.ctx.workRequired(job, dwarf)) return;
    this.toIdle(dwarf);
    if (!this.ctx.completeMeal(job, dwarf)) this.ctx.jobs.remove(job.id);
  }

  /** Pick a plant: it leaves berries or mushrooms where it grew, for hauling. */
  private pick(dwarf: Dwarf, job: Job): void {
    if (!this.ctx.siteValid(job)) {
      this.ctx.jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    this.toIdle(dwarf);
    this.ctx.harvestPlant(job, dwarf);
    this.learn(dwarf, 'farming', this.ctx.colony.skills.xp.harvest);
  }

  /**
   * Do one tick of work on a job. Returns true once it's all done; false while there's
   * more to do, or if the dwarf had to walk back within reach first.
   */
  private labour(dwarf: Dwarf, job: Job): boolean {
    const area = this.ctx.jobArea(job);
    if (distanceToArea(this.ctx.world.index(dwarf.x, dwarf.y), this.ctx.world.width, area) > 1) {
      // Out of reach (it fell, or was pushed): walk back.
      dwarf.phase = 'to-job';
      dwarf.path = null;
      return false;
    }
    if (area.x1 < dwarf.x) dwarf.facing = -1;
    else if (area.x0 > dwarf.x) dwarf.facing = 1;
    const required = this.ctx.workRequired(job, dwarf);
    if (job.progress < required) {
      job.progress++;
      dwarf.workTicks++;
      if (job.progress < required) return false;
    }
    return true;
  }

  private harvest(dwarf: Dwarf, job: Job): void {
    const { jobs, colony, trees } = this.ctx;
    const tree = job.type === 'chop' ? trees.treeAt(job.x, job.y) : null;
    const stillThere = job.type === 'dig' ? this.ctx.canDigNow(job.x, job.y) : tree !== null && tree.base === job.y;
    if (!stillThere) {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    // The block's hardness is read before the work finishes, while it's still there.
    const hardness = job.type === 'dig' ? this.ctx.tiles.tiles[this.blockAt(job.x, job.y)]!.hardness : 0;
    if (!this.labour(dwarf, job)) return;

    if (job.type === 'dig') {
      const safety = this.safeToRemove(dwarf, job.x, job.y);
      if (safety === 'wait') return;
      if (safety === 'unsafe') {
        // Leave it standing: digging it would strand somebody in a hole.
        jobs.release(job.id, dwarf.id);
        jobs.markUnsafe(job.id);
        this.toIdle(dwarf);
        dwarf.restTicks = IDLE_CHECK_TICKS;
        return;
      }
      jobs.remove(job.id);
      this.toIdle(dwarf);
      this.ctx.removeBlock(job.x, job.y, dwarf);
      this.learn(dwarf, 'mining', colony.skills.xp.digPerHardness * hardness);
    } else {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      this.ctx.fellTree(tree!, dwarf);
      this.learn(dwarf, 'mining', colony.skills.xp.chop);
    }
  }

  private build(dwarf: Dwarf, job: Job): void {
    const { jobs, tiles } = this.ctx;
    if (!this.ctx.siteValid(job)) {
      // Something else filled the spot: the plan is void (the materials go back to storage).
      jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    if (job.type === 'build' && tiles.solid[job.target]) {
      const safety = this.safeToPlace(dwarf, job);
      if (safety === 'wait') {
        // Someone is in the way. Give it a while, then leave the job to others.
        if (++dwarf.waitTicks > MAX_WAIT_TICKS) {
          jobs.markUnreachable(job.id, dwarf.id);
          jobs.release(job.id, dwarf.id);
          this.toIdle(dwarf);
        }
        return;
      }
      if (safety === 'unsafe') {
        jobs.release(job.id, dwarf.id);
        jobs.markUnsafe(job.id);
        this.toIdle(dwarf);
        dwarf.restTicks = IDLE_CHECK_TICKS;
        return;
      }
    }
    this.toIdle(dwarf);
    if (this.ctx.completeBuild(job, dwarf)) this.learn(dwarf, 'building', this.ctx.colony.skills.xp.build);
    else jobs.release(job.id, dwarf.id);
  }

  private dismantle(dwarf: Dwarf, job: Job): void {
    if (!this.ctx.siteValid(job)) {
      this.ctx.jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    this.toIdle(dwarf);
    this.ctx.completeDismantle(job);
    this.learn(dwarf, 'building', this.ctx.colony.skills.xp.build);
  }

  private craft(dwarf: Dwarf, job: Job): void {
    const { jobs, colony } = this.ctx;
    if (!this.ctx.siteValid(job)) {
      jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    // A hand-made craft is worked right at the store; anything else at its station.
    const hand = this.ctx.isHandCraft(job);
    if (hand) {
      const required = this.ctx.workRequired(job, dwarf);
      if (job.progress < required) {
        job.progress++;
        dwarf.workTicks++;
        if (job.progress < required) return;
      }
    } else if (!this.labour(dwarf, job)) {
      return;
    }
    // Experience goes by how long the recipe takes a beginner, however quick this dwarf is.
    const seconds = this.ctx.workRequired(job) / 20;
    if (!this.ctx.completeCraft(job, dwarf)) {
      jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    this.learn(dwarf, 'crafting', colony.skills.xp.craftPerSecond * seconds);
    // Carry what was made to storage.
    this.toIdle(dwarf);
    dwarf.phase = 'to-storage';
    this.travel(dwarf);
  }

  private learn(dwarf: Dwarf, skill: Skill, xp: number): void {
    if (gainXp(dwarf, skill, xp, this.ctx.colony.skills.levels)) this.ctx.skillUp(dwarf, skill);
  }

  /**
   * Would removing the block at (x, y) be safe for the digger and for anyone standing on
   * it? Each of them must land within the safe drop and, unless already stranded, still be
   * able to walk home afterwards. 'wait' means this tick's pathfinding budget ran out.
   */
  private safeToRemove(digger: Dwarf, x: number, y: number): 'safe' | 'unsafe' | 'wait' {
    const { world, nav, colony } = this.ctx;
    const affected = this.ctx.dwarves.filter((d) => d.phase !== 'dead' && (d === digger || (d.x === x && d.y === y - 1)));
    const stranded = new Set(affected.filter((d) => this.isStranded(d)));
    const i = world.index(x, y);
    const block = world.fg[i]!;
    world.fg[i] = 0; // pretend it's gone (restored below)
    let verdict: 'safe' | 'unsafe' | 'wait' = 'safe';
    for (const dwarf of affected) {
      let landing = dwarf.y;
      if (dwarf.x === x && dwarf.y === y - 1) {
        const fall = nav.fallAfterRemoving(x, y);
        if (fall > colony.movement.safeDrop) {
          verdict = 'unsafe';
          break;
        }
        landing = dwarf.y + fall;
      }
      if (stranded.has(dwarf)) continue;
      verdict = this.wayHome(world.index(dwarf.x, landing));
      if (verdict !== 'safe') break;
    }
    world.fg[i] = block;
    return verdict;
  }

  /**
   * Would putting a solid block in a build job's cell be safe? Nobody may be in the cell
   * (or stepping into it): that's a 'wait'. And everyone nearby who can get home now must
   * still be able to afterwards, or the block would wall them in: 'unsafe'.
   */
  private safeToPlace(builder: Dwarf, job: Job): 'safe' | 'unsafe' | 'wait' {
    const { world } = this.ctx;
    const i = world.index(job.x, job.y);
    const living = this.ctx.dwarves.filter((d) => d.phase !== 'dead');
    if (living.some((d) => world.index(d.x, d.y) === i || d.movement?.to === i)) return 'wait';
    const nearby = living.filter(
      (d) => (d === builder || Math.max(Math.abs(d.x - job.x), Math.abs(d.y - job.y)) <= PLACE_SAFETY_RADIUS) && !this.isStranded(d),
    );
    const before = world.fg[i]!;
    world.fg[i] = job.target; // pretend it's there (restored below)
    let verdict: 'safe' | 'unsafe' | 'wait' = 'safe';
    for (const dwarf of nearby) {
      verdict = this.wayHome(world.index(dwarf.x, dwarf.y));
      if (verdict !== 'safe') break;
    }
    world.fg[i] = before;
    return verdict;
  }

  /** Whether there's a way home from a cell: 'wait' if this tick's path budget is spent. */
  private wayHome(from: number): 'safe' | 'unsafe' | 'wait' {
    const outcome = this.ctx.paths.request(from, { area: this.ctx.storeArea, reach: 1 });
    if (outcome === 'busy') return 'wait';
    return outcome.found ? 'safe' : 'unsafe';
  }

  private blockAt(x: number, y: number): number {
    return this.ctx.world.fg[this.ctx.world.index(x, y)]!;
  }

  // ---- Fetching, hauling and storing ----------------------------------------------------------

  /** At a store: take the job's materials, then go and use them (or, for gear, put it on). */
  private fetch(dwarf: Dwarf): void {
    const { jobs, colony } = this.ctx;
    if (++dwarf.workTicks < colony.work.pickUpTicks) return;
    dwarf.workTicks = 0;
    const job = this.myJob(dwarf);
    if (!job || !this.ctx.fetchFor(job, dwarf)) {
      if (job) jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    if (job.type === 'equip') {
      this.ctx.equip(dwarf, job);
      this.toIdle(dwarf);
      return;
    }
    // A hand-made craft, or a meal with no table to go to, happens right here at the store.
    if (this.ctx.isHandCraft(job) || (job.type === 'eat' && job.furnitureId === 0)) {
      dwarf.phase = 'working';
      return;
    }
    dwarf.phase = 'to-job';
    dwarf.path = null;
  }

  private pickUp(dwarf: Dwarf): void {
    const { jobs, ground, colony } = this.ctx;
    const job = this.myJob(dwarf);
    const stack = job ? ground.get(job.stackId) : undefined;
    if (!job || !stack) {
      if (job) jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (stack.x !== dwarf.x || stack.y !== dwarf.y) {
      // It fell, or was moved: go after it.
      job.x = stack.x;
      job.y = stack.y;
      dwarf.phase = 'to-item';
      dwarf.path = null;
      return;
    }
    if (++dwarf.workTicks < colony.work.pickUpTicks) return;
    ground.remove(stack.id);
    dwarf.carrying = [{ item: stack.item, count: stack.count }];
    dwarf.workTicks = 0;
    dwarf.phase = 'to-storage';
    dwarf.path = null;
  }

  private dropOff(dwarf: Dwarf): void {
    const { jobs, colony } = this.ctx;
    if (++dwarf.workTicks < colony.work.dropOffTicks) return;
    this.ctx.storeCarried(dwarf);
    const job = this.myJob(dwarf);
    if (job?.type === 'haul') jobs.remove(job.id);
    this.toIdle(dwarf);
  }
}
