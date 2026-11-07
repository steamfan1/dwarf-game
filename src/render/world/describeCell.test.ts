import { describe, expect, it } from 'vitest';
import { ITEMS, TILES } from '../../sim/content';
import { newSim } from '../../sim/testKit';
import { describeActivity, describeCell, describeCreature, describeDwarf } from './describeCell';

describe('hover descriptions in a fight', () => {
  it('describe a monster, an animal and a hunt', () => {
    const { sim } = newSim();
    const gloomling = sim.spawnCreatureNear('gloomling', 20)!;
    const monster = describeCreature(sim, gloomling, 'auto');
    expect(monster.title).toBe('Gloomling');
    expect(monster.detail).toContain('Hostile');
    expect(monster.detail).toContain(`${gloomling.maxHealth}/${gloomling.maxHealth} health`);
    const mossback = sim.spawnCreatureNear('mossback', -12)!;
    expect(describeCreature(sim, mossback, 'auto')).toMatchObject({ title: 'Mossback', action: 'ok' });
    expect(describeCreature(sim, mossback, 'auto').detail).toContain('Click to mark this animal for hunting');
    sim.designateHunt(mossback.id, 2);
    expect(describeCreature(sim, mossback, 'auto').detail).toContain('Marked for hunting');
  });

  it('say what a fighting dwarf is doing, and what a click on a fallen one would do', () => {
    const { sim, runUntil } = newSim();
    const gloomling = sim.spawnCreatureNear('gloomling', 6)!;
    const fighter = sim.dwarves[0]!;
    runUntil(() => fighter.phase === 'fighting', 200);
    expect(describeActivity(sim, fighter, false)).toBe('Fighting a Gloomling');
    const fallen = sim.dwarves[1]!;
    sim.hitDwarf(fallen, 1000, gloomling);
    expect(describeDwarf(sim, fallen, 'select').detail).toBe('Fallen: a rekindling draught can bring them back');
    expect(describeDwarf(sim, fallen, 'auto').detail).toContain("there's none in storage");
    sim.storage.add(ITEMS.item('rekindling_draught'), 1);
    expect(describeDwarf(sim, fallen, 'auto').detail).toContain('Click to bring them back with a rekindling draught');
  });

  it('show how badly a block has been smashed', () => {
    const { sim } = newSim();
    const gloomling = sim.spawnCreatureNear('gloomling', 20)!;
    sim.world.revealAll();
    sim.placeBlock(30, 9, TILES.tile('plank'));
    sim.damageTile(30, 9, sim.tileHp(TILES.tile('plank')) / 4, gloomling);
    expect(describeCell(sim, 30, 9, 'auto', 2)?.detail).toContain('25% broken');
  });
});
