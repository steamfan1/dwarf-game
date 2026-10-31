import { describe, expect, it } from 'vitest';
import { EventBus } from './EventBus';

type TestEvents = {
  Hit: { amount: number };
  Reset: void;
};

describe('EventBus', () => {
  it('delivers payloads to subscribers in subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    bus.on('Hit', (p) => seen.push(`a${p.amount}`));
    bus.on('Hit', (p) => seen.push(`b${p.amount}`));
    bus.emit('Hit', { amount: 3 });
    expect(seen).toEqual(['a3', 'b3']);
  });

  it('emits payload-less events without an argument', () => {
    const bus = new EventBus<TestEvents>();
    let calls = 0;
    bus.on('Reset', () => calls++);
    bus.emit('Reset');
    expect(calls).toBe(1);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    let calls = 0;
    const off = bus.on('Hit', () => calls++);
    bus.emit('Hit', { amount: 1 });
    off();
    bus.emit('Hit', { amount: 1 });
    expect(calls).toBe(1);
    expect(bus.listenerCount('Hit')).toBe(0);
  });

  it('lets handlers unsubscribe others mid-emit without skipping anyone in that emit', () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    let offB: () => void = () => {};
    bus.on('Hit', () => {
      seen.push('a');
      offB();
    });
    offB = bus.on('Hit', () => seen.push('b'));
    bus.emit('Hit', { amount: 0 });
    bus.emit('Hit', { amount: 0 });
    expect(seen).toEqual(['a', 'b', 'a']);
  });

  it('once() fires a single time', () => {
    const bus = new EventBus<TestEvents>();
    let calls = 0;
    bus.once('Hit', () => calls++);
    bus.emit('Hit', { amount: 1 });
    bus.emit('Hit', { amount: 1 });
    expect(calls).toBe(1);
  });

  it('ignores emits with no subscribers', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('Hit', { amount: 1 })).not.toThrow();
  });
});
