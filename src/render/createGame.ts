/**
 * Creates the Phaser game: WebGL, pixel-art filtering, and a canvas whose drawing buffer
 * is managed by ViewportManager (scale mode NONE) so it can render at device resolution.
 */
import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { TitleScene } from './scenes/TitleScene';

export interface GameSize {
  width: number;
  height: number;
}

export function createGame(parent: HTMLElement, size: GameSize, onReady: (game: Phaser.Game) => void): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    width: size.width,
    height: size.height,
    backgroundColor: '#0b0d12',
    // Nearest-neighbour texture filtering and whole-pixel positions: crisp pixel art.
    pixelArt: true,
    roundPixels: true,
    banner: false,
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.NONE },
    // Keyboard input goes through InputActions (rebindable, layout-independent codes).
    input: { keyboard: false },
    scene: [BootScene, TitleScene, GameScene],
    callbacks: { postBoot: onReady },
  });
}
