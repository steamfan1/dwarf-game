import { describe, expect, it } from 'vitest';
import { World } from '../world/World';
import { JobBoard } from './JobBoard';

function board() {
  const world = World.empty(40, 20, 'jobs-test', 'temperate');
  const jobs = new JobBoard(world);
  const dig = (x: number, y: number, priority: 1 | 2 | 3 | 4 = 2, tick = 0) =>
    jobs.add({ type: 'dig', x, y, priority, tick, cells: [world.index(x, y)] });
  return { world, jobs, dig };
}

describe('JobBoard', () => {
  it('never lets two dwarves claim the same job', () => {
    const { jobs, dig } = board();
    const job = dig(5, 5);
    expect(jobs.claim(job.id, 1)).toBe(true);
    expect(jobs.claim(job.id, 2)).toBe(false);
    expect(jobs.bestFor(2, 0, 0)).toBeNull();
    jobs.release(job.id, 2); // not its job: no effect
    expect(job.claimedBy).toBe(1);
    jobs.release(job.id, 1);
    expect(jobs.claim(job.id, 2)).toBe(true);
  });

  it('offers the most urgent job first, then the nearest, then the oldest', () => {
    const { jobs, dig } = board();
    const far = dig(30, 5, 2);
    const near = dig(3, 5, 2);
    const urgent = dig(35, 15, 4);
    expect(jobs.bestFor(1, 0, 5)?.id).toBe(urgent.id);
    jobs.claim(urgent.id, 9);
    expect(jobs.bestFor(1, 0, 5)?.id).toBe(near.id);
    expect(jobs.bestFor(1, 33, 5)?.id).toBe(far.id);
    // (3, 6) is as near to (0, 5) as (3, 5) is (distance counts diagonal steps as one),
    // so the older job wins the tie.
    const twin = dig(3, 6, 2);
    expect(jobs.bestFor(1, 0, 5)?.id).toBe(near.id);
    expect(twin.id).toBeGreaterThan(near.id);
  });

  it('finds marks by cell and by rectangle, and clears them on removal', () => {
    const { jobs, dig } = board();
    const a = dig(4, 4);
    dig(6, 4);
    expect(jobs.at(4, 4)?.id).toBe(a.id);
    expect(jobs.inRect({ x0: 3, y0: 3, x1: 7, y1: 5 })).toHaveLength(2);
    jobs.remove(a.id);
    expect(jobs.at(4, 4)).toBeUndefined();
    expect(jobs.inRect({ x0: 3, y0: 3, x1: 7, y1: 5 })).toHaveLength(1);
  });

  it('skips a job for a dwarf whose path search failed, until the maps are rebuilt', () => {
    const { jobs, dig } = board();
    const near = dig(10, 10);
    const far = dig(30, 10);
    jobs.markUnreachable(near.id, 1);
    expect(jobs.bestFor(1, 10, 10)?.id).toBe(far.id);
    expect(jobs.bestFor(2, 10, 10)?.id).toBe(near.id);
    jobs.mapsRebuilt();
    expect(jobs.bestFor(1, 10, 10)?.id).toBe(near.id);
  });

  it('flags blocked jobs, and keeps unsafe ones blocked until the terrain near them changes', () => {
    const { jobs, dig } = board();
    const changed: string[] = [];
    const blocked: number[] = [];
    jobs.onMarkChanged = (x, y) => changed.push(`${x},${y}`);
    jobs.onBlocked = (job) => blocked.push(job.id);
    const job = dig(30, 10);
    jobs.setBlocked(job, true);
    jobs.setBlocked(job, true);
    expect(blocked).toEqual([job.id]);
    jobs.setBlocked(job, false);
    expect(changed).toEqual(['30,10', '30,10', '30,10']); // added, blocked, unblocked

    jobs.markUnsafe(job.id);
    expect(job.blocked && job.unsafe).toBe(true);
    expect(jobs.bestFor(1, 30, 10)).toBeNull();
    jobs.terrainChanged(10, 10); // far away: still unsafe
    expect(job.unsafe).toBe(true);
    jobs.terrainChanged(32, 12);
    expect(job.unsafe).toBe(false);
    expect(jobs.bestFor(1, 30, 10)?.id).toBe(job.id);
  });

  it('changes priority and reports the mark', () => {
    const { jobs, dig } = board();
    const job = dig(2, 2);
    const changed: string[] = [];
    jobs.onMarkChanged = (x, y) => changed.push(`${x},${y}`);
    jobs.setPriority(job.id, 4);
    jobs.setPriority(job.id, 4);
    expect(job.priority).toBe(4);
    expect(changed).toEqual(['2,2']);
  });
});
