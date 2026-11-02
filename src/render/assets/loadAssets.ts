/**
 * Turns the asset manifest into Phaser textures, animations and sounds.
 *
 *  - `queueFileAssets` runs in a scene's preload(): it queues real files (none yet).
 *  - `createGeneratedAssets` runs in create(): it paints placeholder textures onto
 *    canvases, synthesizes placeholder sounds, and registers animations.
 */
import * as Phaser from 'phaser';
import { Rng } from '../../core/Rng';
import { FURNITURE } from '../../sim/content';
import {
  ANIMATIONS,
  FURNITURE_TEXTURES,
  furnitureAnimationKey,
  furnitureTextureKey,
  SOUNDS,
  TEXTURES,
  type FrameGrid,
  type SoundSource,
  type TextureSource,
} from './manifest';
import { synthesize } from './synth';

export function queueFileAssets(scene: Phaser.Scene): void {
  for (const [key, source] of Object.entries(TEXTURES) as [string, TextureSource][]) {
    if (source.kind !== 'image') continue;
    if (source.frames) {
      scene.load.spritesheet(key, source.url, {
        frameWidth: source.frames.frameWidth,
        frameHeight: source.frames.frameHeight,
        endFrame: source.frames.count - 1,
      });
    } else {
      scene.load.image(key, source.url);
    }
  }
  for (const [key, source] of Object.entries(SOUNDS) as [string, SoundSource][]) {
    if (source.kind === 'file') scene.load.audio(key, source.url);
  }
}

export function createGeneratedAssets(scene: Phaser.Scene): void {
  for (const [key, source] of Object.entries(TEXTURES) as [string, TextureSource][]) {
    if (source.kind === 'generated' && !scene.textures.exists(key)) addGeneratedTexture(scene, key, source);
  }
  for (const [key, source] of FURNITURE_TEXTURES) {
    if (!scene.textures.exists(key)) addGeneratedTexture(scene, key, source);
  }
  createSynthSounds(scene);
  createAnimations(scene);
}

/** Paint a generated texture under `key` unless it already exists (e.g. a dwarf's own colours). */
export function ensureGeneratedTexture(scene: Phaser.Scene, key: string, source: Extract<TextureSource, { kind: 'generated' }>): void {
  if (!scene.textures.exists(key)) addGeneratedTexture(scene, key, source);
}

function addGeneratedTexture(
  scene: Phaser.Scene,
  key: string,
  source: Extract<TextureSource, { kind: 'generated' }>,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`Could not get a 2D canvas to draw texture "${key}"`);
  ctx.imageSmoothingEnabled = false;
  // Each texture gets its own stream, so editing one painter never changes another's look.
  source.paint(ctx, new Rng(`texture:${key}`));

  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`Phaser refused texture "${key}"`);
  if (source.frames) addFrameGrid(texture, source.frames);
}

/** Name frames 0..count-1, left to right then top to bottom, like a Phaser spritesheet. */
function addFrameGrid(texture: Phaser.Textures.Texture, grid: FrameGrid): void {
  const source = texture.source[0];
  if (!source) return;
  const columns = Math.floor(source.width / grid.frameWidth);
  for (let i = 0; i < grid.count; i++) {
    const x = (i % columns) * grid.frameWidth;
    const y = Math.floor(i / columns) * grid.frameHeight;
    texture.add(i, 0, x, y, grid.frameWidth, grid.frameHeight);
  }
}

/**
 * Synthesized sounds need Web Audio. Under Phaser's HTML5-audio or no-audio fallback
 * they are skipped, and playing them becomes a silent no-op (see AudioService).
 */
function createSynthSounds(scene: Phaser.Scene): void {
  const manager = scene.sound;
  if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) return;
  const context = manager.context;
  let seed = 1;
  for (const [key, source] of Object.entries(SOUNDS) as [string, SoundSource][]) {
    seed++;
    if (source.kind !== 'synth' || scene.cache.audio.exists(key)) continue;
    const samples = synthesize(source.tones, context.sampleRate, seed);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    scene.cache.audio.add(key, buffer);
  }
}

function createAnimations(scene: Phaser.Scene): void {
  for (const [key, anim] of Object.entries(ANIMATIONS)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: anim.frames.map((frame) => ({ key: anim.texture, frame })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
    });
  }
  // Furniture with several frames (torches) flickers through them, back and forth.
  for (const def of FURNITURE.defs) {
    const key = furnitureAnimationKey(def);
    if (!key || scene.anims.exists(key)) continue;
    const count = FURNITURE_TEXTURES.get(furnitureTextureKey(def))?.frames?.count ?? 1;
    const frames = [...Array.from({ length: count }, (_, i) => i), ...Array.from({ length: Math.max(0, count - 2) }, (_, i) => count - 2 - i)];
    scene.anims.create({ key, frames: frames.map((frame) => ({ key: furnitureTextureKey(def), frame })), frameRate: 8, repeat: -1 });
  }
}
