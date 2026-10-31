/**
 * Fog of war, drawn the way the brief asks for lighting: one value per tile written into
 * a small texture (1 pixel per tile, 400 x 200), stretched over the world in a single
 * image. Linear filtering on that one texture blurs the boundary across half a tile, so
 * the edge of the explored area looks soft while everything else stays crisp.
 *
 * Unexplored cells are opaque; explored cells and open sky are clear. Milestone 4 adds
 * light levels (sunlight, torches) to the same texture.
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { CellRect, World } from '../../sim/world/World';
import { DEPTH } from '../depths';

const FOG_RGB = [6, 7, 11] as const;

export class FogOverlay {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly key: string;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly pixels: ImageData;
  private readonly image: Phaser.GameObjects.Image;

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
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setScale(TILE_SIZE).setDepth(DEPTH.fog);
  }

  /** Recompute a rectangle of cells and upload the texture. */
  update(rect: CellRect): void {
    const { world, pixels } = this;
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        pixels.data[(y * world.width + x) * 4 + 3] = world.isVisible(x, y) ? 0 : 255;
      }
    }
    const width = rect.x1 - rect.x0 + 1;
    const height = rect.y1 - rect.y0 + 1;
    this.texture.getContext().putImageData(pixels, 0, 0, rect.x0, rect.y0, width, height);
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
