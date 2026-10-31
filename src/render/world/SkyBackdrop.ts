/**
 * The sky behind the world: a vertical gradient in the biome's colours, fixed to the
 * screen (it doesn't scroll). Underground, the background walls cover it.
 */
import * as Phaser from 'phaser';
import { DEPTH } from '../depths';

export class SkyBackdrop {
  private readonly scene: Phaser.Scene;
  private readonly key: string;
  private readonly image: Phaser.GameObjects.Image;

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

  /** Stretch over the visible area. `zoom` is the camera zoom (device pixels per world pixel). */
  fit(canvasWidth: number, canvasHeight: number, zoom: number): void {
    this.image.setDisplaySize(canvasWidth / zoom, canvasHeight / zoom);
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
