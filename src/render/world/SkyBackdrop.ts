/**
 * The sky behind the world: a vertical gradient in the biome's colours, fixed to the
 * screen (it doesn't scroll), tinted towards deep blue as the daylight fades. Underground,
 * the background walls cover it.
 */
import * as Phaser from 'phaser';
import { DEPTH } from '../depths';

/** What the sky's colours are multiplied by at the depth of night. */
const NIGHT_TINT = [70, 84, 140] as const;

export class SkyBackdrop {
  private readonly scene: Phaser.Scene;
  private readonly key: string;
  private readonly image: Phaser.GameObjects.Image;
  private tint = 0xffffff;

  constructor(scene: Phaser.Scene, colors: { top: string; bottom: string }, key = 'sky-gradient') {
    this.scene = scene;
    this.key = key;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, 1, 64);
    if (!texture) throw new Error('Could not create the sky texture');
    const ctx = texture.getContext();
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, colors.top);
    gradient.addColorStop(1, colors.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 64);
    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.sky);
    scene.cameras.main.setBackgroundColor(colors.bottom);
  }

  /** Tint for the sun's strength now: 1 is full day, `nightLight` the depth of night. */
  setDaylight(daylight: number, nightLight: number): void {
    const night = nightLight >= 1 ? 0 : Math.min(1, Math.max(0, (1 - daylight) / (1 - nightLight)));
    const channel = (day: number, dark: number): number => Math.round(day + (dark - day) * night);
    const tint = (channel(255, NIGHT_TINT[0]) << 16) | (channel(255, NIGHT_TINT[1]) << 8) | channel(255, NIGHT_TINT[2]);
    if (tint === this.tint) return;
    this.tint = tint;
    this.image.setTint(tint);
  }

  /**
   * Stretch over the whole screen. `zoom` is the camera zoom (device pixels per world
   * pixel). The image doesn't scroll, but the camera still zooms it around the screen's
   * centre, so it is placed where that zoom maps it onto the screen's corner.
   */
  fit(canvasWidth: number, canvasHeight: number, zoom: number): void {
    const width = canvasWidth / zoom;
    const height = canvasHeight / zoom;
    this.image.setPosition((canvasWidth - width) / 2, (canvasHeight - height) / 2).setDisplaySize(width, height);
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
