/**
 * What a fight looks like besides the fighters: missiles in flight, the invasion portal,
 * and short-lived effects: puffs of smoke (a creature appearing, dying or slinking away, a
 * door or block smashed) and sparks where blows land.
 *
 * Missile and effect sprites come from pools and are reused, never created per shot, so
 * a long siege doesn't churn the garbage collector.
 */
import * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Projectiles } from '../../sim/combat/Combat';
import type { World } from '../../sim/world/World';
import { PUFF_FRAMES, SPARK_FRAMES } from '../assets/creatureArt';
import { DEPTH } from '../depths';

/** How long each frame of an effect shows (ms). */
const EFFECT_FRAME_MS = 70;

interface Effect {
  sprite: Phaser.GameObjects.Image;
  frames: number;
  ageMs: number;
  /** Drifts up a little as it fades (smoke). */
  rise: number;
}

export class CombatEffects {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly missiles: Phaser.GameObjects.Image[] = [];
  private readonly effects: Effect[] = [];
  private readonly portal: Phaser.GameObjects.Sprite;

  constructor(scene: Phaser.Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.portal = scene.add.sprite(0, 0, 'portal', 0).setOrigin(0.5, 1).setDepth(DEPTH.objects).setVisible(false);
    this.portal.play('portalSwirl');
  }

  /** Smoke at a world point (pixels), tinted. */
  puff(x: number, y: number, tint: number, scale = 1): void {
    this.start('puff', PUFF_FRAMES, x, y, tint, scale, 0.02);
  }

  /** A burst where a blow lands. */
  spark(x: number, y: number, tint: number): void {
    this.start('spark', SPARK_FRAMES, x, y, tint, 1, 0);
  }

  /** Bring missiles, effects and the portal up to date. */
  update(projectiles: Projectiles, alpha: number, frameMs: number, portal: { x: number; y: number; open: boolean } | null, timeMs: number): void {
    let used = 0;
    for (const projectile of projectiles.pool) {
      if (!projectile.active) continue;
      const x = projectile.x + projectile.vx * alpha;
      const y = projectile.y + projectile.vy * alpha;
      if (!this.world.isVisible(Math.floor(x), Math.floor(y))) continue;
      let sprite = this.missiles[used];
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, 'bolt').setDepth(DEPTH.carried);
        this.missiles.push(sprite);
      }
      used++;
      sprite
        .setTexture(projectile.kind)
        .setPosition(Math.round(x * TILE_SIZE), Math.round(y * TILE_SIZE))
        .setRotation(projectile.kind === 'bolt' ? Math.atan2(projectile.vy, projectile.vx) : 0)
        .setVisible(true);
    }
    for (let i = used; i < this.missiles.length; i++) this.missiles[i]!.setVisible(false);

    for (const effect of this.effects) {
      if (!effect.sprite.visible) continue;
      effect.ageMs += frameMs;
      const frame = Math.floor(effect.ageMs / EFFECT_FRAME_MS);
      if (frame >= effect.frames) {
        effect.sprite.setVisible(false);
        continue;
      }
      effect.sprite.setFrame(frame).setAlpha(1 - frame / (effect.frames + 1));
      if (effect.rise > 0) effect.sprite.y -= effect.rise * frameMs;
    }

    if (portal) {
      // Before it opens, only a faint flicker shows where it will be.
      this.portal
        .setPosition((portal.x + 0.5) * TILE_SIZE, (portal.y + 1) * TILE_SIZE)
        .setAlpha(portal.open ? 1 : 0.18 + 0.12 * Math.sin(timeMs / 140))
        .setVisible(true);
    } else {
      this.portal.setVisible(false);
    }
  }

  destroy(): void {
    for (const sprite of this.missiles) sprite.destroy();
    for (const effect of this.effects) effect.sprite.destroy();
    this.missiles.length = 0;
    this.effects.length = 0;
    this.portal.destroy();
  }

  private start(texture: 'puff' | 'spark', frames: number, x: number, y: number, tint: number, scale: number, rise: number): void {
    let effect = this.effects.find((e) => !e.sprite.visible);
    if (!effect) {
      effect = { sprite: this.scene.add.image(0, 0, texture, 0).setDepth(DEPTH.carried), frames, ageMs: 0, rise };
      this.effects.push(effect);
    }
    effect.frames = frames;
    effect.ageMs = 0;
    effect.rise = rise;
    effect.sprite.setTexture(texture, 0).setPosition(Math.round(x), Math.round(y)).setTint(tint).setScale(scale).setAlpha(1).setVisible(true);
  }
}
