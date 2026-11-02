/**
 * Draws the dwarves: one sprite each, in the dwarf's own colours, placed between the
 * last two simulation ticks (`alpha`) so movement looks smooth at any frame rate. A
 * jump follows a small arc; stepping off an edge walks first, then falls.
 *
 * The frame shows what the dwarf is doing: walking, swinging a pick, airborne, or lying
 * down (asleep, with a "Zz" over it, or dead and greyed). What it carries floats above
 * its head. A small arrow marks the selected dwarf.
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Dwarf } from '../../sim/dwarves/Dwarf';
import type { ColonySettings } from '../../sim/dwarves/settings';
import type { World } from '../../sim/world/World';
import { DWARF_FRAMES, type DwarfColours } from '../assets/colonyArt';
import { ensureGeneratedTexture } from '../assets/loadAssets';
import { dwarfSheet, dwarfTextureKey } from '../assets/manifest';
import { DEPTH } from '../depths';

interface DwarfView {
  body: Phaser.GameObjects.Sprite;
  load: Phaser.GameObjects.Image;
  sleep: Phaser.GameObjects.Image;
}

const DEAD_TINT = 0x8c8c94;

/** Where a dwarf is drawn, in tiles (x of its centre column, y of the row it stands in). */
export interface DwarfPlace {
  x: number;
  y: number;
  airborne: boolean;
}

export class DwarfSprites {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly colony: ColonySettings;
  private readonly views = new Map<number, DwarfView>();
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly places = new Map<number, DwarfPlace>();

  constructor(scene: Phaser.Scene, world: World, colony: ColonySettings) {
    this.scene = scene;
    this.world = world;
    this.colony = colony;
    this.marker = scene.add.graphics().setDepth(DEPTH.carried);
  }

  colours(dwarf: Dwarf): DwarfColours {
    const looks = this.colony.looks;
    return { skin: looks.skin[dwarf.looks.skin]!, beard: looks.beard[dwarf.looks.beard]!, tunic: looks.tunic[dwarf.looks.tunic]! };
  }

  /**
   * Bring every sprite up to date. `alpha` is how far rendering is between the last tick
   * and the next; `tick` drives the pick-swinging animation, so it freezes when paused.
   */
  update(dwarves: readonly Dwarf[], alpha: number, tick: number, timeMs: number, selected: number | null): void {
    this.marker.clear();
    for (const dwarf of dwarves) {
      const view = this.viewFor(dwarf);
      const place = this.placeOf(dwarf, alpha);
      this.places.set(dwarf.id, place);
      const px = (place.x + 0.5) * TILE_SIZE;
      const py = (place.y + 1) * TILE_SIZE;
      view.body.setPosition(Math.round(px), Math.round(py)).setFlipX(dwarf.facing < 0);
      view.body.setFrame(this.frameFor(dwarf, place, tick, timeMs));
      view.body.setTint(dwarf.phase === 'dead' ? DEAD_TINT : 0xffffff);
      if (dwarf.phase === 'sleeping') {
        // The Zz drifts up and down a little.
        const bob = Math.round(Math.sin(timeMs / 450 + dwarf.id) * 1.5);
        view.sleep.setPosition(Math.round(px) + 4, Math.round(py) - 14 + bob).setVisible(true);
      } else {
        view.sleep.setVisible(false);
      }

      // A load of several things (a job's materials) shows the first of them.
      const load = dwarf.carrying[0];
      if (load) {
        view.load.setFrame(load.item).setPosition(Math.round(px), Math.round(py) - 13).setVisible(true);
      } else {
        view.load.setVisible(false);
      }
      if (dwarf.id === selected) this.drawMarker(px, py - (load ? 26 : 18));
    }
  }

  /** The id of the dwarf drawn under a world point, or null. Living dwarves win over fallen ones. */
  dwarfAt(worldX: number, worldY: number, dwarves: readonly Dwarf[]): number | null {
    let found: number | null = null;
    for (const dwarf of dwarves) {
      const place = this.places.get(dwarf.id);
      if (!place) continue;
      const left = place.x * TILE_SIZE;
      const top = place.y * TILE_SIZE;
      if (worldX < left || worldX >= left + TILE_SIZE || worldY < top - 2 || worldY >= top + TILE_SIZE) continue;
      if (found === null || dwarf.phase !== 'dead') found = dwarf.id;
    }
    return found;
  }

  /** Where a dwarf was last drawn, in tiles. */
  placeOf(dwarf: Dwarf, alpha: number): DwarfPlace {
    const movement = dwarf.movement;
    if (!movement) return { x: dwarf.x, y: dwarf.y, airborne: dwarf.phase === 'falling' };
    const width = this.world.width;
    const fx = movement.from % width;
    const fy = (movement.from - fx) / width;
    const tx = movement.to % width;
    const ty = (movement.to - tx) / width;
    const t = Math.min(1, Math.max(0, (movement.elapsed + alpha) / movement.duration));
    switch (movement.kind) {
      case 'jump':
        return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t - Math.sin(Math.PI * t) * 0.45, airborne: true };
      case 'drop': {
        if (tx === fx) return { x: tx, y: fy + (ty - fy) * t, airborne: true };
        // Walk to the edge, then fall.
        const walkPart = Math.min(0.9, this.colony.movement.walkTicks / movement.duration);
        if (t < walkPart) return { x: fx + ((tx - fx) * t) / walkPart, y: fy, airborne: false };
        return { x: tx, y: fy + ((ty - fy) * (t - walkPart)) / (1 - walkPart), airborne: true };
      }
      case 'fall':
        return { x: tx, y: fy + (ty - fy) * t, airborne: true };
      default:
        return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t, airborne: false };
    }
  }

  destroy(): void {
    for (const view of this.views.values()) {
      view.body.destroy();
      view.load.destroy();
      view.sleep.destroy();
    }
    this.views.clear();
    this.marker.destroy();
  }

  private viewFor(dwarf: Dwarf): DwarfView {
    let view = this.views.get(dwarf.id);
    if (view) return view;
    const colours = this.colours(dwarf);
    const key = dwarfTextureKey(colours);
    ensureGeneratedTexture(this.scene, key, dwarfSheet(colours));
    view = {
      body: this.scene.add.sprite(0, 0, key, DWARF_FRAMES.stand).setOrigin(0.5, 1).setDepth(DEPTH.dwarves),
      load: this.scene.add.image(0, 0, 'items', 0).setOrigin(0.5, 1).setDepth(DEPTH.carried).setVisible(false),
      sleep: this.scene.add.image(0, 0, 'sleep').setOrigin(0, 1).setDepth(DEPTH.carried).setVisible(false),
    };
    this.views.set(dwarf.id, view);
    return view;
  }

  private frameFor(dwarf: Dwarf, place: DwarfPlace, tick: number, timeMs: number): number {
    if (dwarf.phase === 'dead' || dwarf.phase === 'sleeping') return DWARF_FRAMES.fallen;
    if (place.airborne) return DWARF_FRAMES.airborne;
    if (dwarf.movement) return DWARF_FRAMES.walk[Math.floor(timeMs / 110) % DWARF_FRAMES.walk.length]!;
    if (dwarf.phase === 'working') return (tick + dwarf.id * 3) % 12 < 6 ? DWARF_FRAMES.windUp : DWARF_FRAMES.strike;
    return DWARF_FRAMES.stand;
  }

  /** A small downward arrow over the selected dwarf. */
  private drawMarker(x: number, y: number): void {
    this.marker.fillStyle(0x1b1410, 0.8);
    this.marker.fillTriangle(x - 4, y - 1, x + 4, y - 1, x, y + 4);
    this.marker.fillStyle(0xffd77a, 1);
    this.marker.fillTriangle(x - 3, y, x + 3, y, x, y + 3);
  }
}
