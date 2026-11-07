/**
 * The colony's farm plots. A plot is a cell the player marked with the Farm tool for one
 * crop: the open cell where the plant grows, over a block of soil. Its life goes round:
 *
 *   untilled -> (a dwarf tills the soil into farmland) -> empty
 *   empty    -> (a dwarf sows a seed)                   -> growing
 *   growing  -> (enough light, for long enough)         -> ripe
 *   ripe     -> (a dwarf picks it: crop and seeds)      -> empty, and round again
 *
 * Plots are standing orders: the simulation posts the till, sow and harvest jobs itself as
 * each step comes due. This file only keeps the plots; Simulation does the rest.
 *
 * Pure: no Phaser and no DOM.
 */
import type { CropDef } from './Crops';

export type PlotState = 'untilled' | 'empty' | 'growing' | 'ripe';
const PLOT_STATES: readonly PlotState[] = ['untilled', 'empty', 'growing', 'ripe'];

export interface Plot {
  /** The cell the plant grows in (the soil is the cell below). */
  readonly cell: number;
  /** Index into the CropRegistry. */
  readonly crop: number;
  state: PlotState;
  /** Ticks of enough light it has had since it was sown. */
  growth: number;
  /** Whether it got enough light at the last check (for the hover text). */
  lit: boolean;
  /** Priority of the jobs it posts (1-4). */
  priority: number;
}

/** A plot as saved: the crop by id. */
export interface SavedPlot {
  cell: number;
  crop: string;
  state: PlotState;
  growth: number;
  priority: number;
}

export class Farms {
  private readonly plots = new Map<number, Plot>();
  /** Bumped whenever a plot is added, removed or changes state (for renderers and the UI). */
  version = 0;

  get(cell: number): Plot | undefined {
    return this.plots.get(cell);
  }

  all(): IterableIterator<Plot> {
    return this.plots.values();
  }

  get size(): number {
    return this.plots.size;
  }

  add(cell: number, crop: number, state: PlotState, priority: number): Plot {
    const plot: Plot = { cell, crop, state, growth: 0, lit: true, priority };
    this.plots.set(cell, plot);
    this.version++;
    return plot;
  }

  remove(cell: number): Plot | undefined {
    const plot = this.plots.get(cell);
    if (plot) {
      this.plots.delete(cell);
      this.version++;
    }
    return plot;
  }

  setState(plot: Plot, state: PlotState): void {
    plot.state = state;
    if (state !== 'growing') plot.growth = 0;
    this.version++;
  }

  save(cropId: (crop: number) => string): SavedPlot[] {
    return [...this.plots.values()].map((plot) => ({ cell: plot.cell, crop: cropId(plot.crop), state: plot.state, growth: plot.growth, priority: plot.priority }));
  }

  /** Load saved plots; plots of crops no longer in the game are dropped. */
  restore(saved: readonly SavedPlot[], cropIndex: (id: string) => number | undefined): void {
    this.plots.clear();
    for (const entry of saved) {
      const crop = cropIndex(entry.crop);
      if (crop === undefined || !PLOT_STATES.includes(entry.state)) continue;
      const priority = Math.max(1, Math.min(4, Math.round(entry.priority)));
      this.plots.set(entry.cell, { cell: entry.cell, crop, state: entry.state, growth: Math.max(0, entry.growth), lit: true, priority });
    }
    this.version++;
  }
}

/** Ticks of light a crop needs, for days of `dayTicks` daylight each. */
export function growTicks(crop: CropDef, dayTicks: number): number {
  return Math.max(1, Math.round(crop.growDays * dayTicks));
}

/** Which of a crop's stage tiles shows for this much growth: the last (ripe) only once fully grown. */
export function stageTile(crop: CropDef, growth: number, total: number): number {
  const growing = crop.stages.length - 1;
  if (growth >= total) return crop.stages[growing]!;
  return crop.stages[Math.min(growing - 1, Math.floor((growth / total) * growing))]!;
}
