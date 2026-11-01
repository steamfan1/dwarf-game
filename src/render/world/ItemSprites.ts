/**
 * Draws item stacks lying in the world, from a pool of sprites: a stack takes a sprite
 * from the pool and gives it back when it's picked up, so dropping and hauling items
 * never creates and destroys game objects (no garbage-collection stutter). Bigger stacks
 * show as a small heap of up to three icons. Falling stacks move smoothly between ticks.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { GroundItems } from '../../sim/items/Items';
import { DEPTH } from '../depths';

/** Icon offsets for a heap, in pixels from the cell's bottom centre. */
const HEAP: ReadonlyArray<[number, number]> = [
  [0, 0],
  [-3, -1],
  [3, -2],
];

export class ItemSprites {
  private readonly scene: Phaser.Scene;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Images in the pool (in use or not), for the debug overlay. */
  get pooled(): number {
    return this.pool.length;
  }

  update(ground: GroundItems, alpha: number): void {
    let used = 0;
    for (const stack of ground.all()) {
      const icons = stack.count >= 5 ? 3 : stack.count >= 2 ? 2 : 1;
      const x = (stack.x + 0.5) * TILE_SIZE;
      // A falling stack moves one row per tick: draw it partway to the next row.
      const y = (stack.y + 1 + (stack.falling ? alpha : 0)) * TILE_SIZE;
      for (let i = 0; i < icons; i++) {
        const [dx, dy] = HEAP[i]!;
        this.take(used++).setFrame(stack.item).setPosition(Math.round(x + dx), Math.round(y + dy));
      }
    }
    for (let i = used; i < this.used; i++) this.pool[i]!.setVisible(false);
    this.used = used;
  }

  destroy(): void {
    for (const image of this.pool) image.destroy();
    this.pool.length = 0;
    this.used = 0;
  }

  private take(index: number): Phaser.GameObjects.Image {
    let image = this.pool[index];
    if (!image) {
      image = this.scene.add.image(0, 0, 'items', 0).setOrigin(0.5, 1).setDepth(DEPTH.items);
      this.pool.push(image);
    }
    return image.setVisible(true);
  }
}
