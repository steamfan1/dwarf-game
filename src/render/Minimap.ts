/**
 * The minimap: the whole world at one pixel per tile on a 2D canvas, with the camera's
 * view outlined and the Hearth marked. Unexplored ground is dark. Monsters the colony can
 * see show as red dots, and an invasion portal as a violet one.
 *
 * It keeps its own copy of the map pixels and only recomputes cells that changed
 * (TileChanged / ExploredChanged), then composites the camera outline on top. The HTML
 * overlay owns the <canvas>; this class only draws into it.
 */
import type { TileRegistry } from '../sim/world/TileRegistry';
import type { CellRect, World } from '../sim/world/World';
import { rgb } from './world/tileArt';

const UNEXPLORED: readonly [number, number, number] = [11, 12, 17];
const VIEW_COLOR = 'rgba(255, 243, 214, 0.9)';
const HEARTH_COLOR = '#ffb347';

/** A dot on the map: a monster, or the portal. */
export interface MapMarker {
  x: number;
  y: number;
  color: string;
  /** Size in map pixels (tiles). */
  size: number;
}

export interface TileViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MinimapRenderer {
  private readonly world: World;
  private readonly tiles: TileRegistry;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly tileColors: Uint8Array;
  private readonly wallColors: Uint8Array;
  private readonly liquidColors: Uint8Array;
  private readonly skyColors: Uint8Array;
  private target: CanvasRenderingContext2D | null = null;
  private view: TileViewRect | null = null;
  private markers: readonly MapMarker[] = [];
  private dirty = true;

  constructor(world: World, tiles: TileRegistry, sky: { top: string; bottom: string }) {
    this.world = world;
    this.tiles = tiles;
    this.base = document.createElement('canvas');
    this.base.width = world.width;
    this.base.height = world.height;
    const ctx = this.base.getContext('2d');
    if (!ctx) throw new Error('Could not create the minimap canvas');
    this.baseCtx = ctx;
    this.image = ctx.createImageData(world.width, world.height);

    const pack = (colors: string[]): Uint8Array => Uint8Array.from(colors.flatMap((c) => rgb(c)));
    this.tileColors = pack(tiles.tiles.map((t) => t.mapColor));
    this.wallColors = pack(tiles.walls.map((w) => w.mapColor));
    this.liquidColors = pack(['#000000', ...tiles.liquids.map((l) => l.mapColor)]);
    const top = rgb(sky.top);
    const bottom = rgb(sky.bottom);
    const skyRows: number[] = [];
    for (let y = 0; y < world.height; y++) {
      const t = Math.min(1, y / 60);
      skyRows.push(...top.map((c, i) => Math.round(c + (bottom[i]! - c) * t)));
    }
    this.skyColors = Uint8Array.from(skyRows);
    this.updateCells({ x0: 0, y0: 0, x1: world.width - 1, y1: world.height - 1 });
  }

  /** Draw into this canvas (or stop drawing with null). */
  attach(canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.target = null;
      return;
    }
    canvas.width = this.world.width;
    canvas.height = this.world.height;
    this.target = canvas.getContext('2d');
    this.dirty = true;
    this.draw();
  }

  /** Recompute the map pixels for a rectangle of cells. */
  updateCells(rect: CellRect): void {
    const { world, tiles, image } = this;
    const data = image.data;
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const i = world.index(x, y);
        const o = i * 4;
        let source: Uint8Array;
        let index: number;
        if (!world.isVisible(x, y)) {
          data[o] = UNEXPLORED[0];
          data[o + 1] = UNEXPLORED[1];
          data[o + 2] = UNEXPLORED[2];
          data[o + 3] = 255;
          continue;
        }
        const tile = world.fg[i]!;
        if (tile !== 0 && tiles.tiles[tile]!.art.style !== 'sprite') {
          source = this.tileColors;
          index = tile;
        } else if (world.liquidType[i] !== 0) {
          source = this.liquidColors;
          index = world.liquidType[i]!;
        } else if (world.bg[i] !== 0) {
          source = this.wallColors;
          index = world.bg[i]!;
        } else {
          source = this.skyColors;
          index = y;
        }
        data[o] = source[index * 3]!;
        data[o + 1] = source[index * 3 + 1]!;
        data[o + 2] = source[index * 3 + 2]!;
        data[o + 3] = 255;
      }
    }
    this.baseCtx.putImageData(image, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1);
    this.dirty = true;
  }

  /** Remember where the camera is; redrawn on the next draw(). */
  setView(view: TileViewRect): void {
    const v = this.view;
    if (v && Math.abs(v.x - view.x) < 0.25 && Math.abs(v.y - view.y) < 0.25 && v.width === view.width && v.height === view.height) return;
    this.view = view;
    this.dirty = true;
  }

  /** Show these dots (monsters, the portal) from the next draw(). */
  setMarkers(markers: readonly MapMarker[]): void {
    const old = this.markers;
    if (old.length === markers.length && old.every((m, i) => m.x === markers[i]!.x && m.y === markers[i]!.y && m.color === markers[i]!.color)) return;
    this.markers = markers;
    this.dirty = true;
  }

  /** Composite the map, the Hearth, the markers and the camera outline onto the attached canvas, if anything changed. */
  draw(): void {
    const ctx = this.target;
    if (!ctx || !this.dirty) return;
    this.dirty = false;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);
    const { spawn } = this.world;
    ctx.fillStyle = HEARTH_COLOR;
    ctx.fillRect(spawn.x - 2, spawn.y - 2, 5, 5);
    for (const marker of this.markers) {
      const half = Math.floor(marker.size / 2);
      ctx.fillStyle = marker.color;
      ctx.fillRect(marker.x - half, marker.y - half, marker.size, marker.size);
    }
    if (this.view) {
      ctx.strokeStyle = VIEW_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(this.view.x, this.view.y, this.view.width, this.view.height);
    }
  }
}
