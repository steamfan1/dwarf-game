/**
 * Draws the creatures: one sprite each from its kind's sheet, placed between the last two
 * simulation ticks like the dwarves. The frame shows what it's doing (standing, walking,
 * striking); a hurt creature flashes red and shows a health bar; an animal marked for
 * hunting wears crosshairs. Creatures in cells the colony hasn't explored aren't drawn.
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Creature } from '../../sim/creatures/Creature';
import type { Simulation } from '../../sim/Simulation';
import { COMBAT_MARKS, CREATURE_FRAMES } from '../assets/creatureArt';
import { creatureTextureKey } from '../assets/manifest';
import { DEPTH } from '../depths';
import type { HealthBars } from './HealthBars';
import { movementPlace, type Place } from './movementPlace';

interface CreatureView {
  body: Phaser.GameObjects.Sprite;
  mark: Phaser.GameObjects.Image;
  /** Sideways nudge (pixels) while it shares a cell with others, eased toward its target. */
  nudge: number;
}

/** Ticks a hurt creature flashes red, and shows its strike frame. */
const HURT_FLASH_TICKS = 4;
const STRIKE_TICKS = 6;
const HURT_TINT = 0xff7a7a;
/** Creatures standing in one cell (a pack battering a door) fan out this far apart (px)... */
const PACK_SPACING = 5;
/** ...but never more than this from the middle of the cell. */
const PACK_HALF_WIDTH = 7;

export class CreatureSprites {
  private readonly scene: Phaser.Scene;
  private readonly views = new Map<number, CreatureView>();
  private readonly places = new Map<number, Place>();
  /** Per frame: how many creatures stand in each cell, and how many of those have been placed. */
  private readonly packSize = new Map<number, number>();
  private readonly packPlaced = new Map<number, number>();
  private lastTimeMs = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(sim: Simulation, alpha: number, timeMs: number, bars: HealthBars): void {
    const { world } = sim;
    const alive = new Set<number>();
    const ease = Math.min(1, Math.max(0, timeMs - this.lastTimeMs) / 120);
    this.lastTimeMs = timeMs;
    this.packSize.clear();
    this.packPlaced.clear();
    for (const creature of sim.creatures) {
      if (creature.gone || creature.movement) continue;
      const cell = world.index(creature.x, creature.y);
      this.packSize.set(cell, (this.packSize.get(cell) ?? 0) + 1);
    }
    for (const creature of sim.creatures) {
      if (creature.gone) continue;
      alive.add(creature.id);
      const view = this.viewFor(sim, creature);
      const def = sim.creatureDef(creature);
      const place = movementPlace(creature.movement, creature.x, creature.y, creature.phase === 'falling', alpha, world.width, def.movement.walkTicks);
      this.places.set(creature.id, place);
      view.nudge += (this.packOffset(creature, world.index(creature.x, creature.y)) - view.nudge) * ease;
      const seen = world.isVisible(creature.x, creature.y);
      view.body.setVisible(seen);
      if (!seen) {
        view.mark.setVisible(false);
        continue;
      }
      const px = Math.round((place.x + 0.5) * TILE_SIZE + view.nudge);
      const py = Math.round((place.y + 1) * TILE_SIZE);
      view.body.setPosition(px, py).setFlipX(creature.facing < 0).setFrame(this.frameFor(creature, place, timeMs));
      view.body.setTint(creature.hurtTicks < HURT_FLASH_TICKS ? HURT_TINT : 0xffffff);
      const hunted = sim.huntJobFor(creature.id) !== undefined;
      view.mark.setVisible(hunted);
      if (hunted) view.mark.setPosition(px, py - 17);
      if (creature.health < creature.maxHealth) bars.draw(px, py - (hunted ? 21 : 18), creature.health / creature.maxHealth);
    }
    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      view.body.destroy();
      view.mark.destroy();
      this.views.delete(id);
      this.places.delete(id);
    }
  }

  /** The id of the creature drawn under a world point, or null. */
  creatureAt(worldX: number, worldY: number, sim: Simulation): number | null {
    for (const creature of sim.creatures) {
      const place = this.places.get(creature.id);
      if (!place || creature.gone || !sim.world.isVisible(creature.x, creature.y)) continue;
      const left = place.x * TILE_SIZE;
      const top = place.y * TILE_SIZE;
      if (worldX >= left - 1 && worldX < left + TILE_SIZE + 1 && worldY >= top - 1 && worldY < top + TILE_SIZE) return creature.id;
    }
    return null;
  }

  destroy(): void {
    for (const view of this.views.values()) {
      view.body.destroy();
      view.mark.destroy();
    }
    this.views.clear();
    this.places.clear();
  }

  private viewFor(sim: Simulation, creature: Creature): CreatureView {
    let view = this.views.get(creature.id);
    if (view) return view;
    view = {
      body: this.scene.add.sprite(0, 0, creatureTextureKey(sim.creatureDef(creature)), CREATURE_FRAMES.stand).setOrigin(0.5, 1).setDepth(DEPTH.creatures),
      mark: this.scene.add.image(0, 0, 'combatMarks', COMBAT_MARKS.hunt).setOrigin(0.5, 1).setDepth(DEPTH.carried).setVisible(false),
      nudge: 0,
    };
    this.views.set(creature.id, view);
    return view;
  }

  /**
   * Where a creature standing with others in one cell is drawn, sideways from the middle,
   * so a pack battering a door reads as a pack rather than one monster. Call once per
   * creature per frame, in a steady order.
   */
  private packOffset(creature: Creature, cell: number): number {
    if (creature.movement) return 0;
    const size = this.packSize.get(cell) ?? 1;
    if (size < 2) return 0;
    const place = this.packPlaced.get(cell) ?? 0;
    this.packPlaced.set(cell, place + 1);
    const spacing = Math.min(PACK_SPACING, (2 * PACK_HALF_WIDTH) / (size - 1));
    return (place - (size - 1) / 2) * spacing;
  }

  private frameFor(creature: Creature, place: Place, timeMs: number): number {
    if (creature.strikeTicks < STRIKE_TICKS) return CREATURE_FRAMES.strike;
    if (creature.movement && !place.airborne) return CREATURE_FRAMES.walk[Math.floor(timeMs / 120 + creature.id) % 2]!;
    if (place.airborne) return CREATURE_FRAMES.walk[0];
    return CREATURE_FRAMES.stand;
  }
}
