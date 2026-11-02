/**
 * Planned building, drawn see-through where it will go: the block, wall or piece of
 * furniture each build job will put in place (the mark on top says who is on it, or what
 * it is waiting for). The same pictures show what a build tool would put under the
 * pointer, tinted green where it can go and red where it can't.
 *
 * Redrawn from the job board when a mark changes; one pooled image per planned thing.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { FurnitureDef } from '../../sim/furniture/FurnitureRegistry';
import type { Simulation } from '../../sim/Simulation';
import { furnitureTextureKey } from '../assets/manifest';
import { DEPTH } from '../depths';
import { framePosition, tileFrame, wallFrame, type AtlasLayout } from './tileAtlas';
import { EXPOSED_BOTTOM, EXPOSED_LEFT, EXPOSED_RIGHT, EXPOSED_TOP } from './tileArt';

/** A block on its own, with nothing beside it: every edge drawn. */
const ALONE = EXPOSED_TOP | EXPOSED_RIGHT | EXPOSED_BOTTOM | EXPOSED_LEFT;
const PLAN_ALPHA = 0.5;
const PREVIEW_ALPHA = 0.75;
const PREVIEW_OK = 0xb8ffb0;
const PREVIEW_BLOCKED = 0xff7a6a;

/** What a build tool would put down: a block (tile id), a wall (wall id) or furniture. */
export type PlanPicture = { kind: 'tile'; tile: number } | { kind: 'wall'; wall: number } | { kind: 'furniture'; def: FurnitureDef };

export class PlanGhosts {
  private readonly scene: Phaser.Scene;
  private readonly sim: Simulation;
  private readonly layout: AtlasLayout;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private readonly preview: Phaser.GameObjects.Image;
  private dirty = true;

  constructor(scene: Phaser.Scene, sim: Simulation, layout: AtlasLayout) {
    this.scene = scene;
    this.sim = sim;
    this.layout = layout;
    this.preview = scene.add.image(0, 0, 'terrain').setDepth(DEPTH.selection).setVisible(false);
  }

  /** Some mark changed: redraw the plans on the next update. */
  invalidate(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let used = 0;
    for (const job of this.sim.jobs.all()) {
      let picture: PlanPicture;
      if (job.type === 'build') picture = { kind: 'tile', tile: job.target };
      else if (job.type === 'wall') picture = { kind: 'wall', wall: job.target };
      else if (job.type === 'place') picture = { kind: 'furniture', def: this.sim.furnitureKinds.get(job.target) };
      else continue;
      let image = this.pool[used];
      if (!image) {
        image = this.scene.add.image(0, 0, 'terrain').setDepth(DEPTH.plans);
        this.pool.push(image);
      }
      used++;
      this.draw(image, picture, job.x, job.y).setAlpha(PLAN_ALPHA).clearTint().setVisible(true);
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false);
  }

  /** Show what a build tool would put down standing on (x, y), tinted by whether it can go there. */
  showPreview(picture: PlanPicture, x: number, y: number, ok: boolean): void {
    this.draw(this.preview, picture, x, y)
      .setAlpha(PREVIEW_ALPHA)
      .setTint(ok ? PREVIEW_OK : PREVIEW_BLOCKED)
      .setVisible(true);
  }

  hidePreview(): void {
    this.preview.setVisible(false);
  }

  destroy(): void {
    for (const image of this.pool) image.destroy();
    this.pool.length = 0;
    this.preview.destroy();
  }

  /** Point an image at a picture, placed for cell (x, y): a block or wall in it, furniture standing on it. */
  private draw(image: Phaser.GameObjects.Image, picture: PlanPicture, x: number, y: number): Phaser.GameObjects.Image {
    if (picture.kind === 'furniture') {
      return image.setTexture(furnitureTextureKey(picture.def), 0).setOrigin(0, 1).setPosition(x * TILE_SIZE, (y + 1) * TILE_SIZE);
    }
    const frame = picture.kind === 'tile' ? this.terrainFrame(`plan:tile:${picture.tile}`, tileFrame(this.layout, picture.tile, ALONE, 0)) : this.terrainFrame(`plan:wall:${picture.wall}`, wallFrame(this.layout, picture.wall, 0));
    return image.setTexture('terrain', frame).setOrigin(0, 0).setPosition(x * TILE_SIZE, y * TILE_SIZE);
  }

  /** A named 16 x 16 frame of the terrain atlas, added the first time it's needed. */
  private terrainFrame(name: string, atlasFrame: number): string {
    const texture = this.scene.textures.get('terrain');
    if (!texture.has(name)) {
      const { x, y } = framePosition(atlasFrame);
      texture.add(name, 0, x, y, TILE_SIZE, TILE_SIZE);
    }
    return name;
  }
}
