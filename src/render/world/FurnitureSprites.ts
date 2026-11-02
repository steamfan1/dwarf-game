/**
 * Draws the furniture standing in the world: one sprite per piece, standing on its
 * bottom-left cell. Torches flicker. Kept in step by FurnitureChanged events.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { PlacedFurniture } from '../../sim/furniture/Furniture';
import type { Simulation } from '../../sim/Simulation';
import { furnitureAnimationKey, furnitureTextureKey } from '../assets/manifest';
import { DEPTH } from '../depths';

export class FurnitureSprites {
  private readonly scene: Phaser.Scene;
  private readonly sim: Simulation;
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.scene = scene;
    this.sim = sim;
    for (const piece of sim.furniture.all()) this.add(piece);
  }

  /** A piece was set down or taken away. */
  changed(id: number, placed: boolean): void {
    if (!placed) {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
      return;
    }
    const piece = this.sim.furniture.get(id);
    if (piece) this.add(piece);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  private add(piece: PlacedFurniture): void {
    if (this.sprites.has(piece.id)) return;
    const sprite = this.scene.add
      .sprite(piece.x * TILE_SIZE, (piece.y + 1) * TILE_SIZE, furnitureTextureKey(piece.def), 0)
      .setOrigin(0, 1)
      .setDepth(DEPTH.furniture);
    const flicker = furnitureAnimationKey(piece.def);
    // Neighbouring torches start on different frames, so they don't flicker in step.
    if (flicker) sprite.play({ key: flicker, startFrame: piece.id % 3 });
    this.sprites.set(piece.id, sprite);
  }
}
