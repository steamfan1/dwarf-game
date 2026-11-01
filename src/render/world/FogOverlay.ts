/**
 * Fog of war, drawn the way the brief asks for lighting: one value per tile written into
 * a small texture (1 pixel per tile, 400 x 200), stretched over the world in a single
 * image. Linear filtering on that one texture blurs the boundary across half a tile, so
 * the edge of the explored area looks soft while everything else stays crisp.
 *
 * Unexplored cells are opaque; explored cells and open sky are clear. Milestone 4 adds
 * light levels (sunlight, torches) to the same texture.
 *
 * Changes are collected during a frame and uploaded once by `flush()`, so many cells
 * explored at once cost one texture upload per frame rather than one per cell.
 *
 * For the debug overlay, `showLight()` draws the light levels instead: the darker a
 * cell, the less light reaches it (unlit cells are drawn dark whether explored or not).
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { MAX_LIGHT } from '../../sim/light/Lighting';
import { unionRect, type CellRect, type World } from '../../sim/world/World';
import { DEPTH } from '../depths';

const FOG_RGB = [6, 7, 11] as const;

export class FogOverlay {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly key: string;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly pixels: ImageData;
  private readonly image: Phaser.GameObjects.Image;
  /** Cells changed since the last upload. */
  private dirty: CellRect | null = null;
  /** Light levels to show instead of the fog (debug), or null. */
  private light: Uint8Array | null = null;

  constructor(scene: Phaser.Scene, world: World, key = 'fog-of-war') {
    this.scene = scene;
    this.world = world;
    this.key = key;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, world.width, world.height);
    if (!texture) throw new Error('Could not create the fog-of-war texture');
    this.texture = texture;
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.pixels = this.texture.getContext().createImageData(world.width, world.height);
    for (let i = 0; i < world.width * world.height; i++) {
      this.pixels.data[i * 4] = FOG_RGB[0];
      this.pixels.data[i * 4 + 1] = FOG_RGB[1];
      this.pixels.data[i * 4 + 2] = FOG_RGB[2];
    }
    this.update({ x0: 0, y0: 0, x1: world.width - 1, y1: world.height - 1 });
    this.flush();
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setScale(TILE_SIZE).setDepth(DEPTH.fog);
  }

  /** Show light levels (debug) instead of the fog of war, or the fog again with null. */
  showLight(light: Uint8Array | null): void {
    if (light === this.light) return;
    this.light = light;
    this.refreshAll();
  }

  /** Recompute every cell (the light view calls this now and then, as light changes). */
  refreshAll(): void {
    this.update({ x0: 0, y0: 0, x1: this.world.width - 1, y1: this.world.height - 1 });
  }

  /** Recompute a rectangle of cells. The texture is uploaded by the next `flush()`. */
  update(rect: CellRect): void {
    const { world, pixels, light } = this;
    if (light) {
      // Debug view: darkness from light alone.
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const i = y * world.width + x;
          pixels.data[i * 4 + 3] = Math.round(((MAX_LIGHT - light[i]!) / MAX_LIGHT) * 235);
        }
      }
      this.dirty = this.dirty ? unionRect(this.dirty, rect) : { ...rect };
      return;
    }
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        pixels.data[(y * world.width + x) * 4 + 3] = world.isVisible(x, y) ? 0 : 255;
      }
    }
    this.dirty = this.dirty ? unionRect(this.dirty, rect) : { ...rect };
  }

  /** Upload the cells changed since the last call, if any. Call once per frame. */
  flush(): void {
    const rect = this.dirty;
    if (!rect) return;
    this.dirty = null;
    const width = rect.x1 - rect.x0 + 1;
    const height = rect.y1 - rect.y0 + 1;
    this.texture.getContext().putImageData(this.pixels, 0, 0, rect.x0, rect.y0, width, height);
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
