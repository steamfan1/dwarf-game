/**
 * Title screen backdrop: a dusk landscape where three dwarves walk into a glowing gate.
 * The menu itself is HTML (see ui/components/TitleMenu.tsx), layered on top.
 */
import * as Phaser from 'phaser';
import { SceneKeys } from './keys';

/** Pick a whole-number zoom that shows roughly 230 world pixels of height. */
function titleZoom(canvasHeight: number): number {
  return Math.max(1, Math.round(canvasHeight / 230));
}

const GROUND_DEPTH = 32;
const WALKER_SPEED_PX_PER_S = 17;

interface Walker {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  speed: number;
}

export class TitleScene extends Phaser.Scene {
  private sky!: Phaser.GameObjects.Image;
  private stars!: Phaser.GameObjects.TileSprite;
  private hillsFar!: Phaser.GameObjects.TileSprite;
  private hillsNear!: Phaser.GameObjects.TileSprite;
  private gate!: Phaser.GameObjects.Image;
  private gateGlow!: Phaser.GameObjects.Image;
  private grass!: Phaser.GameObjects.TileSprite;
  private dirt!: Phaser.GameObjects.TileSprite;
  private walkers: Walker[] = [];

  private groundTop = 0;
  private gateX = 0;

  constructor() {
    super(SceneKeys.title);
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0).setBackgroundColor('#0d1222');

    this.sky = this.add.image(0, 0, 'titleSky').setOrigin(0, 0);
    this.stars = this.add.tileSprite(0, 0, 256, 100, 'titleStars').setOrigin(0, 0);
    this.hillsFar = this.add.tileSprite(0, 0, 256, 64, 'titleHillsFar').setOrigin(0, 0);
    this.hillsNear = this.add.tileSprite(0, 0, 256, 80, 'titleHillsNear').setOrigin(0, 0);
    this.gateGlow = this.add.image(0, 0, 'titleGateGlow').setOrigin(0.5, 1);
    this.gate = this.add.image(0, 0, 'titleGate').setOrigin(0.5, 1);
    this.grass = this.add.tileSprite(0, 0, 64, 16, 'groundGrass').setOrigin(0, 0);
    this.dirt = this.add.tileSprite(0, 0, 64, 16, 'groundDirt').setOrigin(0, 0);

    this.walkers = [0, 1, 2].map((i) => ({
      sprite: this.add.sprite(0, 0, 'dwarf', 0).setOrigin(0.5, 1).play({ key: 'dwarfWalk', startFrame: i }),
      x: 0,
      speed: WALKER_SPEED_PX_PER_S + i * 1.5,
    }));

    this.tweens.add({
      targets: this.gateGlow,
      alpha: { from: 0.72, to: 1 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.layout();
    // Start the trio already on screen, spaced out and heading for the gate.
    this.walkers.forEach((walker, i) => {
      walker.x = Math.round(this.gateX * (0.2 + i * 0.16));
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  override update(_time: number, delta: number): void {
    const step = Math.min(delta, 100) / 1000;
    for (const walker of this.walkers) {
      walker.x += walker.speed * step;
      // Fade out while stepping into the gate, then start again off-screen to the left.
      const toGate = this.gateX - walker.x;
      walker.sprite.setAlpha(Phaser.Math.Clamp(toGate / 10, 0, 1));
      if (toGate <= 0) walker.x = -20 - Math.random() * 40;
      walker.sprite.setPosition(Math.round(walker.x), this.groundTop + 2);
    }
  }

  /** Fit everything to the current canvas size. World (0, 0) is the top-left corner. */
  private layout(): void {
    const zoom = titleZoom(this.scale.height);
    const camera = this.cameras.main;
    camera.setSize(this.scale.width, this.scale.height);
    camera.setZoom(zoom);
    camera.setScroll(0, 0);

    const width = Math.ceil(this.scale.width / zoom);
    const height = Math.ceil(this.scale.height / zoom);
    this.groundTop = Math.floor(this.scale.height / zoom) - GROUND_DEPTH;
    this.gateX = Math.round(width * 0.8);

    this.sky.setDisplaySize(width, height);
    this.stars.setSize(width, 100);
    this.hillsFar.setPosition(0, this.groundTop - 54).setSize(width, 64);
    this.hillsNear.setPosition(0, this.groundTop - 64).setSize(width, 80);
    this.gate.setPosition(this.gateX, this.groundTop + 1);
    this.gateGlow.setPosition(this.gateX, this.groundTop + 1);
    this.grass.setPosition(0, this.groundTop).setSize(width, 16);
    this.dirt.setPosition(0, this.groundTop + 16).setSize(width, Math.max(16, height - this.groundTop - 16));
  }
}
