/**
 * Draws the world with Phaser tilemap layers, one pair per 32 x 32 chunk: a layer of
 * background walls and a layer of blocks and liquids in front of it.
 *
 * Only chunks near the camera have layers. They come from a pool: when a chunk scrolls
 * into view it borrows a free pair (or a new one, if every pair is busy), which is moved
 * into place and filled from the world; when it scrolls well out of view its pair goes
 * back to the pool. So the number of layers (and of Phaser's per-cell tile objects)
 * depends on the screen size, not on the size of the world, and the renderer never
 * touches chunks that are out of sight.
 *
 * When a cell changes, only that cell and its four neighbours (whose edge outlines may
 * change) are redrawn, and only if their chunks are on screen.
 */
import * as Phaser from 'phaser';
import { CHUNK_SIZE, TILE_SIZE } from '../../config';
import { chunkRange, inChunkRange, type ChunkRange } from '../../core/cameraMath';
import type { TileRegistry } from '../../sim/world/TileRegistry';
import type { World } from '../../sim/world/World';
import { DEPTH } from '../depths';
import { ATLAS_MARGIN, ATLAS_SPACING, backgroundFrameAt, foregroundFrameAt, type AtlasLayout } from './tileAtlas';

const NEIGHBOURHOOD: ReadonlyArray<[number, number]> = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Chunks within this many world pixels of the view are drawn (filled a little ahead of time). */
const SHOW_MARGIN = 4 * TILE_SIZE;
/** Chunks keep their layers until they are this far out of view, so panning back and forth doesn't refill them. */
const KEEP_MARGIN = CHUNK_SIZE * TILE_SIZE;

interface ChunkLayers {
  walls: Phaser.Tilemaps.TilemapLayer;
  blocks: Phaser.Tilemaps.TilemapLayer;
}

export class WorldView {
  private readonly world: World;
  private readonly tiles: TileRegistry;
  private readonly layout: AtlasLayout;
  private readonly map: Phaser.Tilemaps.Tilemap;
  private readonly tileset: Phaser.Tilemaps.Tileset;
  /** Layers in use, by chunk index. */
  private readonly active = new Map<number, ChunkLayers>();
  private readonly pool: ChunkLayers[] = [];
  private layersCreated = 0;

  constructor(scene: Phaser.Scene, world: World, tiles: TileRegistry, layout: AtlasLayout, textureKey: string) {
    this.world = world;
    this.tiles = tiles;
    this.layout = layout;
    this.map = scene.make.tilemap({ tileWidth: TILE_SIZE, tileHeight: TILE_SIZE, width: CHUNK_SIZE, height: CHUNK_SIZE });
    const tileset = this.map.addTilesetImage('terrain', textureKey, TILE_SIZE, TILE_SIZE, ATLAS_MARGIN, ATLAS_SPACING);
    if (!tileset) throw new Error('Could not create the terrain tileset');
    this.tileset = tileset;
  }

  /** Number of chunks currently drawn (for the debug overlay). */
  get drawnChunks(): number {
    return this.active.size;
  }

  /** Number of chunk layer pairs ever created, in use or pooled (for the debug overlay). */
  get pooledChunks(): number {
    return this.layersCreated;
  }

  /** Redraw a changed cell and the neighbours whose outlines depend on it. */
  refreshCell(x: number, y: number): void {
    for (const [dx, dy] of NEIGHBOURHOOD) {
      const cx = x + dx;
      const cy = y + dy;
      if (!this.world.inBounds(cx, cy)) continue;
      const layers = this.active.get(this.world.chunkIndex(cx, cy));
      if (layers) this.drawCell(layers, cx, cy);
    }
  }

  /** Give layers to the chunks around the camera's view (world pixels) and take them back from far-away ones. */
  cull(view: { x: number; y: number; width: number; height: number }): void {
    const chunkPx = CHUNK_SIZE * TILE_SIZE;
    const { chunkCols, chunkRows } = this.world;
    const keep = chunkRange(view, chunkPx, chunkCols, chunkRows, KEEP_MARGIN);
    for (const [chunk, layers] of this.active) {
      if (!inChunkRange(keep, chunk % chunkCols, Math.floor(chunk / chunkCols))) this.release(chunk, layers);
    }
    const show = chunkRange(view, chunkPx, chunkCols, chunkRows, SHOW_MARGIN);
    this.forEachChunk(show, (chunk) => {
      if (!this.active.has(chunk)) this.assign(chunk);
    });
  }

  destroy(): void {
    this.active.clear();
    this.pool.length = 0;
    this.map.destroy();
  }

  private forEachChunk(range: ChunkRange, visit: (chunk: number) => void): void {
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) visit(cy * this.world.chunkCols + cx);
    }
  }

  private assign(chunk: number): void {
    const layers = this.pool.pop() ?? this.createLayers();
    const cells = this.world.chunkCells(chunk);
    for (const layer of [layers.walls, layers.blocks]) layer.setPosition(cells.x0 * TILE_SIZE, cells.y0 * TILE_SIZE).setVisible(true);
    this.active.set(chunk, layers);
    // Fill every cell; cells past the edge of the world (in the last row and column of
    // chunks, which are smaller) are cleared, since the layer may have drawn another chunk.
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = cells.x0 + lx;
        const y = cells.y0 + ly;
        if (x > cells.x1 || y > cells.y1) {
          layers.walls.putTileAt(-1, lx, ly, false);
          layers.blocks.putTileAt(-1, lx, ly, false);
        } else {
          this.drawCell(layers, x, y);
        }
      }
    }
  }

  private release(chunk: number, layers: ChunkLayers): void {
    layers.walls.setVisible(false);
    layers.blocks.setVisible(false);
    this.active.delete(chunk);
    this.pool.push(layers);
  }

  private createLayers(): ChunkLayers {
    const id = this.layersCreated++;
    const make = (name: string, depth: number): Phaser.Tilemaps.TilemapLayer => {
      const layer = this.map.createBlankLayer(`${name}-${id}`, this.tileset, 0, 0, CHUNK_SIZE, CHUNK_SIZE);
      if (!layer) throw new Error(`Could not create tilemap layer ${name}-${id}`);
      return layer.setDepth(depth);
    };
    return { walls: make('walls', DEPTH.walls), blocks: make('blocks', DEPTH.blocks) };
  }

  private drawCell(layers: ChunkLayers, x: number, y: number): void {
    const lx = x % CHUNK_SIZE;
    const ly = y % CHUNK_SIZE;
    layers.walls.putTileAt(backgroundFrameAt(this.world, this.layout, x, y), lx, ly, false);
    layers.blocks.putTileAt(foregroundFrameAt(this.world, this.tiles, this.layout, x, y), lx, ly, false);
  }
}
