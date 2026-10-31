/**
 * First scene: loads any real asset files listed in the manifest, then paints the
 * placeholder textures and synthesizes the placeholder sounds, and hands over to the
 * title screen.
 */
import * as Phaser from 'phaser';
import { gameContext } from '../../app/context';
import { createGeneratedAssets, queueFileAssets } from '../assets/loadAssets';
import { SceneKeys } from './keys';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.boot);
  }

  preload(): void {
    queueFileAssets(this);
  }

  create(): void {
    createGeneratedAssets(this);
    gameContext().bootComplete();
    this.scene.start(SceneKeys.title);
  }
}
