/**
 * Fog of war and darkness, drawn the way the brief asks for lighting: one value per tile
 * written into a small texture (1 pixel per tile, 400 x 200), stretched over the world in
 * a single image. Linear filtering blurs each value across its tile, so light fades
 * smoothly and the edge of the explored area looks soft.
 *
 *  - Unexplored cells are opaque, near-black fog.
 *  - Explored cells are darkened by how little light reaches them: the brighter of the
 *    sunlight (weakened at night, see TimeOfDay) and the glow of lava, crystals, the
 *    Hearth and torches. Darkness has a deep blue tint, so night looks like night; an
 *    explored but unlit tunnel stays dimly visible rather than vanishing.
 *
 * Changes are collected during a frame and uploaded once by `flush()`: cells newly
 * explored or relit (a block dug, a torch set down) update just their rectangle, and the
 * whole texture is redrawn only when the daylight has changed by a visible step (during
 * dawn and dusk, a few times a second).
 *
 * For the debug overlay, `showLight()` draws the light levels instead: the darker a
 * cell, the less light reaches it (unlit cells are drawn dark whether explored or not).
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { MAX_LIGHT, type Lighting } from '../../sim/light/Lighting';
import { FLAG_EXPLORED, unionRect, type CellRect, type World } from '../../sim/world/World';
import { DEPTH } from '../depths';

const FOG_RGB = [6, 7, 11] as const;
const DARK_RGB = [7, 9, 24] as const;
/** Darkness over an explored cell no light reaches (0..1): dim, not invisible. */
const MAX_DARKNESS = 0.86;
/** Light at which a cell is fully lit (0..15). */
const FULL_LIGHT = 13;
/** Light is looked up in steps of a quarter. */
const STEPS_PER_LEVEL = 4;
/** The whole texture is redrawn when daylight has changed by this much. */
const DAYLIGHT_STEP = 0.01;

/** Alpha (0..255) for each light level in quarter steps: dark falls off quickly near full light. */
const DARKNESS = Uint8Array.from({ length: MAX_LIGHT * STEPS_PER_LEVEL + 1 }, (_, step) => {
  const t = Math.min(1, step / STEPS_PER_LEVEL / FULL_LIGHT);
  return Math.round(255 * MAX_DARKNESS * Math.pow(1 - t, 1.5));
});

export class FogOverlay {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly lighting: Lighting;
  private readonly key: string;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly pixels: ImageData;
  private readonly image: Phaser.GameObjects.Image;
  /** Cells changed since the last upload. */
  private dirty: CellRect | null = null;
  /** Light levels to show instead of the fog (debug), or null. */
  private light: Uint8Array | null = null;
  /** The daylight the texture was last drawn with. */
  private daylight = 1;

  constructor(scene: Phaser.Scene, world: World, lighting: Lighting, daylight = 1, key = 'fog-of-war') {
    this.scene = scene;
    this.world = world;
    this.lighting = lighting;
    this.daylight = daylight;
    this.key = key;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, world.width, world.height);
    if (!texture) throw new Error('Could not create the fog-of-war texture');
    this.texture = texture;
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.pixels = this.texture.getContext().createImageData(world.width, world.height);
    this.refreshAll();
    this.flush();
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setScale(TILE_SIZE).setDepth(DEPTH.fog);
  }

  /** The sun's strength now (0..1): a visible change redraws the whole map. */
  setDaylight(daylight: number): void {
    if (Math.abs(daylight - this.daylight) < DAYLIGHT_STEP && !(daylight === 1 && this.daylight !== 1)) return;
    this.daylight = daylight;
    this.refreshAll();
  }

  /** Show light levels (debug) instead of the fog of war, or the fog again with null. */
  showLight(light: Uint8Array | null): void {
    if (light === this.light) return;
    this.light = light;
    this.refreshAll();
  }

  /** Recompute every cell. */
  refreshAll(): void {
    this.update({ x0: 0, y0: 0, x1: this.world.width - 1, y1: this.world.height - 1 });
  }

  /** Recompute a rectangle of cells. The texture is uploaded by the next `flush()`. */
  update(rect: CellRect): void {
    const { world, pixels, light } = this;
    const data = pixels.data;
    const width = world.width;
    if (light) {
      // Debug view: darkness from light alone.
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const i = y * width + x;
          data[i * 4] = FOG_RGB[0];
          data[i * 4 + 1] = FOG_RGB[1];
          data[i * 4 + 2] = FOG_RGB[2];
          data[i * 4 + 3] = Math.round(((MAX_LIGHT - light[i]!) / MAX_LIGHT) * 235);
        }
      }
    } else {
      const { sun, glow } = this.lighting;
      const { flags, surface } = world;
      const daylight = this.daylight;
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const i = y * width + x;
          const o = i * 4;
          // Open sky (above the ground the world was made with) is never fogged.
          const seen = (flags[i]! & FLAG_EXPLORED) !== 0 || y < surface[x]!;
          if (!seen) {
            data[o] = FOG_RGB[0];
            data[o + 1] = FOG_RGB[1];
            data[o + 2] = FOG_RGB[2];
            data[o + 3] = 255;
            continue;
          }
          const level = Math.max(sun[i]! * daylight, glow[i]!);
          data[o] = DARK_RGB[0];
          data[o + 1] = DARK_RGB[1];
          data[o + 2] = DARK_RGB[2];
          data[o + 3] = DARKNESS[Math.round(level * STEPS_PER_LEVEL)]!;
        }
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
