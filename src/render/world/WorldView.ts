/**
 * Draws the world with Phaser tilemap layers: for every 32 x 32 chunk, one layer of
 * background walls and one of blocks and liquids.
 *
 *  - Only layers that overlap the camera are visible, so the renderer never touches the
 *    rest of the map.
 *  - When a cell changes, only that cell and its four neighbours (whose edge outlines may
 *    change) are redrawn; nothing else in the chunk, let alone the world, is touched.
 */
import * as Phaser from 'phaser';
import { CHUNK_SIZE, TILE_SIZE } from '../../config';
import type { TileRegistry } from '../../sim/world/TileRegistry';
import type { CellRect, World } from '../../sim/world/World';
import { DEPTH } from '../depths';
import { ATLAS_MARGIN, ATLAS_SPACING, backgroundFrameAt, foregroundFrameAt, type AtlasLayout } from './tileAtlas';

const NEIGHBOURHOOD: ReadonlyArray<[number, number]> = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export class WorldView {
  private readonly world: World;
  private readonly tiles: TileRegistry;
  private readonly layout: AtlasLayout;
  private readonly map: Phaser.Tilemaps.Tilemap;
  private readonly walls: Phaser.Tilemaps.TilemapLayer[] = [];
  private readonly blocks: Phaser.Tilemaps.TilemapLayer[] = [];
  private visibleChunks = 0;

  constructor(scene: Phaser.Scene, world: World, tiles: TileRegistry, layout: AtlasLayout, textureKey: string) {
    this.world = world;
    this.tiles = tiles;
    this.layout = layout;
    this.map = scene.make.tilemap({ tileWidth: TILE_SIZE, tileHeight: TILE_SIZE, width: CHUNK_SIZE, height: CHUNK_SIZE });
    const tileset = this.map.addTilesetImage('terrain', textureKey, TILE_SIZE, TILE_SIZE, ATLAS_MARGIN, ATLAS_SPACING);
    if (!tileset) throw new Error('Could not create the terrain tileset');

    const chunks = world.chunkCols * world.chunkRows;
    for (let chunk = 0; chunk < chunks; chunk++) {
      const cells = world.chunkCells(chunk);
      const width = cells.x1 - cells.x0 + 1;
      const height = cells.y1 - cells.y0 + 1;
      const make = (name: string, depth: number): Phaser.Tilemaps.TilemapLayer => {
        const layer = this.map.createBlankLayer(`${name}-${chunk}`, tileset, cells.x0 * TILE_SIZE, cells.y0 * TILE_SIZE, width, height);
        if (!layer) throw new Error(`Could not create tilemap layer ${name}-${chunk}`);
        return layer.setDepth(depth);
      };
      this.walls.push(make('walls', DEPTH.walls));
      this.blocks.push(make('blocks', DEPTH.blocks));
      this.drawRect(cells);
    }
  }

  /** Number of chunks whose layers are currently drawn (for the debug overlay). */
  get drawnChunks(): number {
    return this.visibleChunks;
  }

  /** Redraw a changed cell and the neighbours whose outlines depend on it. */
  refreshCell(x: number, y: number): void {
    for (const [dx, dy] of NEIGHBOURHOOD) {
      const cx = x + dx;
      const cy = y + dy;
      if (this.world.inBounds(cx, cy)) this.drawCell(cx, cy);
    }
  }

  /** Show only the chunks that overlap the camera's view (world pixels), plus a one-chunk margin. */
  cull(view: { x: number; y: number; width: number; height: number }): void {
    const chunkPx = CHUNK_SIZE * TILE_SIZE;
    const cx0 = Math.floor(view.x / chunkPx) - 1;
    const cy0 = Math.floor(view.y / chunkPx) - 1;
    const cx1 = Math.floor((view.x + view.width) / chunkPx) + 1;
    const cy1 = Math.floor((view.y + view.height) / chunkPx) + 1;
    let visible = 0;
    for (let chunk = 0; chunk < this.blocks.length; chunk++) {
      const cx = chunk % this.world.chunkCols;
      const cy = Math.floor(chunk / this.world.chunkCols);
      const show = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
      this.walls[chunk]!.setVisible(show);
      this.blocks[chunk]!.setVisible(show);
      if (show) visible++;
    }
    this.visibleChunks = visible;
  }

  destroy(): void {
    this.map.destroy();
  }

  private drawRect(cells: CellRect): void {
    for (let y = cells.y0; y <= cells.y1; y++) {
      for (let x = cells.x0; x <= cells.x1; x++) this.drawCell(x, y);
    }
  }

  private drawCell(x: number, y: number): void {
    const chunk = this.world.chunkIndex(x, y);
    const lx = x % CHUNK_SIZE;
    const ly = y % CHUNK_SIZE;
    this.walls[chunk]!.putTileAt(backgroundFrameAt(this.world, this.layout, x, y), lx, ly, false);
    this.blocks[chunk]!.putTileAt(foregroundFrameAt(this.world, this.tiles, this.layout, x, y), lx, ly, false);
  }
}
