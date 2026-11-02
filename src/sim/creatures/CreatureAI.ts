/**
 * What a creature does each tick.
 *
 * Monsters hunt dwarves. Every second or so a monster picks its prey: the nearest living
 * dwarf it can see (within its `sight`; invaders always know where the colony is), and
 * whoever hurt it last if they're close. It plans a path with its own kind of moves (see
 * CreatureNav), which may go through doors and blocks it can break: it smashes those as
 * it comes to them. Once its prey is within reach it strikes (melee) or shoots (ranged,
 * if it can see it). With no prey in sight, monsters head for the Hearth, the heart of
 * the colony, and prowl around it.
 *
 * Animals graze: they amble a few tiles this way and that, pausing between, and run from
 * whoever hurts them for a few seconds.
 *
 * Path searches share their own per-tick budget (separate from the dwarves'), so a horde
 * never slows the colony's own planning. Pure: no Phaser and no DOM.
 */
import type { Rng } from '../../core/Rng';
import type { Dwarf, Movement } from '../dwarves/Dwarf';
import type { MoveKind } from '../nav/NavGrid';
import type { PathGoal } from '../nav/Pathfinder';
import type { PathService } from '../nav/PathService';
import type { CellRect, World } from '../world/World';
import type { Creature } from './Creature';
import type { CreatureNav } from './CreatureNav';
import type { CreatureDef, CreatureRegistry } from './CreatureRegistry';

/** Everything creatures need from the simulation. */
export interface CreatureContext {
  readonly world: World;
  readonly creatureKinds: CreatureRegistry;
  readonly dwarves: readonly Dwarf[];
  readonly tick: number;
  readonly creatureRng: Rng;
  readonly creaturePaths: PathService;
  readonly storeArea: CellRect;
  navFor(kind: number): CreatureNav;
  /** A creature strikes a dwarf. */
  hitDwarf(dwarf: Dwarf, damage: number, by: Creature): void;
  /** A creature shoots at a dwarf. */
  creatureShoots(creature: Creature, def: CreatureDef, target: Dwarf): void;
  /** A creature strikes a door or block. */
  damageTile(x: number, y: number, damage: number, by: Creature): void;
  /** Whether a missile could fly between two cells. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean;
  /** A creature died without a dwarf's help (it fell into lava). */
  killCreature(creature: Creature, by: number): void;
  /** A creature of the night leaves at dawn. */
  creatureLeaves(creature: Creature): void;
}

/** How often a monster looks around for prey (ticks). */
const THINK_TICKS = 20;
/** At least this long between path plans while the old path still works (ticks). */
const PLAN_GAP_TICKS = 15;
/** A dwarf a monster found no way to is left alone this long (ticks). */
const UNREACHABLE_TICKS = 200;
/** With no way to the Hearth, a monster prowls where it is this long before trying again. */
const NO_WAY_HOME_TICKS = 120;
/** Monsters prowl this far around the Hearth, animals graze this far from where they stand. */
const WANDER_RADIUS = 6;
/** Ticks to fall one row. */
const FALL_TICKS_PER_ROW = 2;
/** Fleeing animals move this much faster. */
const FLEE_SPEED = 0.7;
/** Creatures search greedily (see PathGoal.greed): smashing and tunnelling make costs high. */
const GREED = 2.5;

export class CreatureAI {
  private readonly ctx: CreatureContext;

  constructor(ctx: CreatureContext) {
    this.ctx = ctx;
  }

  update(c: Creature): void {
    if (c.gone) return;
    const { ctx } = this;
    c.hurtTicks++;
    c.strikeTicks++;
    if (c.cooldown > 0) c.cooldown--;
    if (c.planTicks > 0) c.planTicks--;
    const nav = ctx.navFor(c.kind);
    if (!c.movement && c.phase !== 'falling' && !nav.standable(c.x, c.y)) this.startFalling(c, nav);
    if (c.movement) {
      c.movement.elapsed++;
      if (c.movement.elapsed < c.movement.duration) return;
      this.arrive(c, nav);
      if (c.gone || c.phase === 'falling') return;
    }
    if (c.leaveAt > 0 && ctx.tick >= c.leaveAt) {
      ctx.creatureLeaves(c);
      return;
    }
    const def = ctx.creatureKinds.get(c.kind);
    if (c.breaking >= 0) {
      this.breakThrough(c, def, nav);
      return;
    }
    if (def.hostile) this.hunt(c, def, nav);
    else this.graze(c, def, nav);
  }

  /** Whether a creature could strike (or shoot) a dwarf from where it stands now. */
  inReach(c: Creature, def: CreatureDef, prey: Dwarf): boolean {
    if (def.attack === 'melee') return this.withinMeleeReach(c, prey.x, prey.y);
    if (def.attack !== 'ranged') return false;
    const dx = prey.x - c.x;
    const dy = prey.y - c.y;
    return dx * dx + dy * dy <= def.range * def.range && this.ctx.lineOfSight(c.x, c.y, prey.x, prey.y);
  }

  /**
   * Whether its prey is part-way through a step that ends within the creature's reach
   * (melee only). Better to wait for it there than to walk into the cell it's taking and
   * fight on top of each other.
   */
  private closingIn(c: Creature, def: CreatureDef, prey: Dwarf): boolean {
    if (def.attack !== 'melee' || !prey.movement) return false;
    const width = this.ctx.world.width;
    const x = prey.movement.to % width;
    return this.withinMeleeReach(c, x, (prey.movement.to - x) / width);
  }

  /** Whether the creature could strike a cell: next to it (or its own), but not round a corner. */
  private withinMeleeReach(c: Creature, x: number, y: number): boolean {
    const dx = Math.abs(x - c.x);
    const dy = Math.abs(y - c.y);
    if (dx > 1 || dy > 1) return false;
    if (dx === 1 && dy === 1) {
      // Not round a corner: one of the two cells between them must be open.
      const nav = this.ctx.navFor(c.kind);
      return nav.open(c.x, y) || nav.open(x, c.y);
    }
    return true;
  }

  // ---- Monsters ------------------------------------------------------------------------------

  private hunt(c: Creature, def: CreatureDef, nav: CreatureNav): void {
    const { ctx } = this;
    let prey = this.livingDwarf(c.target);
    if (--c.thinkTicks <= 0 || !prey) {
      c.thinkTicks = THINK_TICKS + (c.id % 7);
      const next = this.choosePrey(c, def);
      if ((next?.id ?? 0) !== c.target) {
        c.target = next?.id ?? 0;
        c.path = null;
      }
      prey = next;
    }
    if (prey && this.inReach(c, def, prey)) {
      c.path = null;
      // Standing in its prey's own cell (it dropped onto it, say), it backs off a step first.
      if (prey.x === c.x && prey.y === c.y && !prey.movement && def.attack === 'melee' && this.stepBack(c, def, nav)) return;
      c.phase = 'attacking';
      this.strike(c, def, prey);
      return;
    }
    if (c.phase === 'attacking') c.phase = 'idle';
    if (prey && this.closingIn(c, def, prey)) return;

    const width = ctx.world.width;
    if (prey) {
      const preyCell = prey.y * width + prey.x;
      const moved = c.pathGoal < 0 || chebyshev(c.pathGoal, preyCell, width) > 1;
      if (!c.path || (moved && c.planTicks === 0)) {
        this.plan(c, nav, { area: { x0: prey.x, y0: prey.y, x1: prey.x, y1: prey.y }, reach: 1, greed: GREED }, preyCell, prey.id);
      }
    } else if (distanceToRect(c.x, c.y, ctx.storeArea) <= 3) {
      this.wander(c, nav, true);
    } else if (!c.path && c.planTicks === 0) {
      const home = ctx.storeArea;
      const goal: PathGoal = { area: home, reach: 2, greed: GREED, cacheKey: `creature:${c.kind}:hearth` };
      this.plan(c, nav, goal, home.y0 * width + home.x0, 0);
    } else if (!c.path) {
      this.wander(c, nav, false);
    }
    if (c.path) this.followPath(c, def, nav);
  }

  /** The nearest living dwarf it can see that it hasn't given up on; whoever hurt it last counts as nearer. */
  private choosePrey(c: Creature, def: CreatureDef): Dwarf | undefined {
    const { tick } = this.ctx;
    c.unreachable = c.unreachable.filter((entry) => entry.until > tick);
    const sight = c.origin === 'wave' ? Infinity : def.sight;
    let best: Dwarf | undefined;
    let bestScore = Infinity;
    for (const dwarf of this.ctx.dwarves) {
      if (dwarf.phase === 'dead') continue;
      const distance = Math.max(Math.abs(dwarf.x - c.x), Math.abs(dwarf.y - c.y));
      if (distance > sight || c.unreachable.some((entry) => entry.dwarf === dwarf.id)) continue;
      const score = distance - (dwarf.id === c.lastHitBy ? 3 : 0);
      if (score < bestScore) {
        best = dwarf;
        bestScore = score;
      }
    }
    return best;
  }

  private strike(c: Creature, def: CreatureDef, prey: Dwarf): void {
    if (prey.x !== c.x) c.facing = prey.x > c.x ? 1 : -1;
    if (c.cooldown > 0) return;
    c.cooldown = def.attackTicks;
    c.strikeTicks = 0;
    if (def.attack === 'ranged') this.ctx.creatureShoots(c, def, prey);
    else this.ctx.hitDwarf(prey, c.damage, c);
  }

  /** Smash at the door or block in the way, one blow at a time, until it gives. */
  private breakThrough(c: Creature, def: CreatureDef, nav: CreatureNav): void {
    const width = this.ctx.world.width;
    const x = c.breaking % width;
    const y = (c.breaking - x) / width;
    const prey = this.livingDwarf(c.target);
    if (nav.open(x, y) || !nav.breakable(x, y) || (prey && this.inReach(c, def, prey))) {
      // Broken through (by it or another), can't be broken after all, or the prey came to it.
      if (!nav.open(x, y)) c.path = null;
      c.breaking = -1;
      c.phase = 'idle';
      return;
    }
    c.phase = 'breaking';
    if (x !== c.x) c.facing = x > c.x ? 1 : -1;
    if (c.cooldown > 0) return;
    c.cooldown = def.breakTicks;
    c.strikeTicks = 0;
    this.ctx.damageTile(x, y, def.breakDamage, c);
    if (nav.open(x, y)) {
      c.breaking = -1;
      c.phase = 'moving';
    }
  }

  // ---- Animals ---------------------------------------------------------------------------------

  private graze(c: Creature, def: CreatureDef, nav: CreatureNav): void {
    const { ctx } = this;
    if (c.fleeTicks > 0) {
      c.fleeTicks--;
      if (!c.path && c.planTicks === 0) {
        // Run from whoever hurt it, to somewhere well away on the far side.
        const attacker = this.livingDwarf(c.lastHitBy);
        const away: -1 | 1 = attacker ? (attacker.x > c.x ? -1 : attacker.x < c.x ? 1 : c.facing) : c.facing;
        this.goTo(c, nav, c.x + away * ctx.creatureRng.int(8, 12), c.y);
      }
    } else if (!c.path) {
      c.phase = 'idle';
      if (--c.restTicks > 0) return;
      c.restTicks = ctx.creatureRng.int(60, 200);
      this.goTo(c, nav, c.x + ctx.creatureRng.int(-WANDER_RADIUS, WANDER_RADIUS), c.y);
    }
    if (c.path) this.followPath(c, def, nav);
  }

  // ---- Moving ------------------------------------------------------------------------------------

  /** Prowl about: around the Hearth (`nearHome`), or around where it stands. */
  private wander(c: Creature, nav: CreatureNav, nearHome: boolean): void {
    if (c.path || --c.restTicks > 0) return;
    const { ctx } = this;
    c.restTicks = ctx.creatureRng.int(30, 90);
    const home = ctx.storeArea;
    const x = nearHome ? home.x0 + 1 + ctx.creatureRng.int(-WANDER_RADIUS, WANDER_RADIUS) : c.x + ctx.creatureRng.int(-WANDER_RADIUS, WANDER_RADIUS);
    this.goTo(c, nav, x, nearHome ? home.y0 : c.y);
  }

  /** Head for somewhere to stand near (x, y). */
  private goTo(c: Creature, nav: CreatureNav, x: number, y: number): void {
    const { world } = this.ctx;
    for (let dy = 0; dy <= 6; dy++) {
      for (const row of dy === 0 ? [y] : [y - dy, y + dy]) {
        if (!world.inBounds(x, row) || !nav.open(x, row) || !nav.standable(x, row)) continue;
        this.plan(c, nav, { area: { x0: x, y0: row, x1: x, y1: row }, reach: 0, greed: GREED }, row * world.width + x, 0);
        return;
      }
    }
  }

  /** Ask for a path; if there is none, give up on that prey (or that place) for a while. */
  private plan(c: Creature, nav: CreatureNav, goal: PathGoal, goalCell: number, prey: number): void {
    const { ctx } = this;
    const outcome = ctx.creaturePaths.request(c.y * ctx.world.width + c.x, goal, nav);
    if (outcome === 'busy') return;
    c.planTicks = PLAN_GAP_TICKS;
    if (!outcome.found) {
      c.path = null;
      c.pathGoal = -1;
      if (prey !== 0) {
        c.unreachable.push({ dwarf: prey, until: ctx.tick + UNREACHABLE_TICKS });
        c.target = 0;
      } else if (goal.cacheKey) {
        c.planTicks = NO_WAY_HOME_TICKS;
      }
      return;
    }
    c.path = outcome.cells;
    c.pathIndex = 0;
    c.pathGoal = goalCell;
    c.phase = 'moving';
  }

  /** One plain step sideways, back the way it faces from if it can; false if neither side is open. */
  private stepBack(c: Creature, def: CreatureDef, nav: CreatureNav): boolean {
    const from = c.y * this.ctx.world.width + c.x;
    const ahead = c.facing;
    const behind = ahead === 1 ? -1 : 1;
    for (const side of [behind, ahead]) {
      if (!nav.open(c.x + side, c.y) || nav.stepKind(from, from + side) !== 'walk') continue;
      this.startMove(c, def, from, from + side, 'walk');
      c.facing = side === 1 ? -1 : 1; // backing off, still facing its prey
      c.phase = 'moving';
      return true;
    }
    return false;
  }

  /** Take the next step, breaking through what's in the way first. */
  private followPath(c: Creature, def: CreatureDef, nav: CreatureNav): void {
    const path = c.path!;
    if (c.pathIndex >= path.length) {
      c.path = null;
      c.phase = 'idle';
      return;
    }
    const width = this.ctx.world.width;
    const from = c.y * width + c.x;
    const to = path[c.pathIndex]!;
    const kind = nav.stepKind(from, to);
    if (kind === null) {
      // The way changed under it: plan again.
      c.path = null;
      return;
    }
    const first = nav.firstCell(from, to);
    const fx = first % width;
    const fy = (first - fx) / width;
    if (!nav.open(fx, fy)) {
      if (nav.breakable(fx, fy)) {
        c.breaking = first;
        c.phase = 'breaking';
      } else {
        c.path = null;
      }
      return;
    }
    c.pathIndex++;
    this.startMove(c, def, from, to, kind);
  }

  private startMove(c: Creature, def: CreatureDef, from: number, to: number, kind: MoveKind): void {
    const width = this.ctx.world.width;
    const fx = from % width;
    const tx = to % width;
    const rows = Math.abs((to - tx) / width - (from - fx) / width);
    const walk = def.movement.walkTicks * (c.fleeTicks > 0 ? FLEE_SPEED : 1);
    let duration: number;
    switch (kind) {
      case 'walk':
        duration = walk;
        break;
      case 'jump':
        duration = walk * 1.4 + (rows - 1) * walk * 0.5;
        break;
      case 'climb':
        duration = walk * 1.2;
        break;
      case 'swim':
        duration = walk * 1.8;
        break;
      case 'drop':
        duration = (tx !== fx ? walk : 0) + rows * FALL_TICKS_PER_ROW;
        break;
    }
    if (tx !== fx) c.facing = tx > fx ? 1 : -1;
    c.movement = { from, to, kind, elapsed: 0, duration: Math.max(1, Math.round(duration)) } satisfies Movement;
  }

  private arrive(c: Creature, nav: CreatureNav): void {
    const width = this.ctx.world.width;
    const movement = c.movement!;
    c.movement = null;
    c.x = movement.to % width;
    c.y = (movement.to - c.x) / width;
    if (movement.kind !== 'fall') return;
    c.fallRows++;
    if (!nav.standable(c.x, c.y)) this.fallOneRow(c, nav);
    else {
      c.fallRows = 0;
      c.phase = 'idle';
    }
  }

  private startFalling(c: Creature, nav: CreatureNav): void {
    c.path = null;
    c.breaking = -1;
    c.phase = 'falling';
    c.fallRows = 0;
    this.fallOneRow(c, nav);
  }

  private fallOneRow(c: Creature, nav: CreatureNav): void {
    const { world } = this.ctx;
    if (!nav.open(c.x, c.y + 1)) {
      // Lava below burns it up; anything else means it has landed (or it's at the bottom).
      if (world.inBounds(c.x, c.y + 1) && !nav.solidAt(c.x, c.y + 1) && !nav.breakable(c.x, c.y + 1)) this.ctx.killCreature(c, 0);
      else c.phase = 'idle';
      return;
    }
    const from = c.y * world.width + c.x;
    c.movement = { from, to: from + world.width, kind: 'fall', elapsed: 0, duration: FALL_TICKS_PER_ROW };
  }

  private livingDwarf(id: number): Dwarf | undefined {
    if (id === 0) return undefined;
    const dwarf = this.ctx.dwarves.find((d) => d.id === id);
    return dwarf && dwarf.phase !== 'dead' ? dwarf : undefined;
  }
}

function chebyshev(a: number, b: number, width: number): number {
  const ax = a % width;
  const bx = b % width;
  return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / width - (b - bx) / width));
}

/** Chebyshev distance from a cell to the nearest cell of a rectangle. */
function distanceToRect(x: number, y: number, r: CellRect): number {
  return Math.max(r.x0 - x, 0, x - r.x1, r.y0 - y, 0, y - r.y1);
}
