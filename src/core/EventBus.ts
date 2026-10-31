/**
 * A small typed publish/subscribe bus for cross-system messages
 * (TileChanged, ItemCrafted, NightStarted, ...).
 *
 * Systems don't call each other to announce that something happened; they emit an
 * event and whoever cares subscribes. Handlers run synchronously, in subscription
 * order. Subscribing or unsubscribing inside a handler is safe: handler lists are
 * copy-on-write, so an emit that is already running keeps the list it started with.
 */

export type EventMap = { [type: string]: unknown };
export type Handler<P> = (payload: P) => void;

/** Events whose payload type is `void` are emitted without a payload argument. */
type EmitArgs<P> = [P] extends [void] ? [] : [payload: P];

export class EventBus<E extends EventMap> {
  private readonly handlers = new Map<keyof E, ReadonlyArray<Handler<never>>>();

  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const current = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...current, handler as Handler<never>]);
    return () => this.off(type, handler);
  }

  /** Subscribe for a single delivery. The returned function cancels it early. */
  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    const current = this.handlers.get(type);
    if (!current) return;
    const next = current.filter((h) => h !== handler);
    if (next.length > 0) this.handlers.set(type, next);
    else this.handlers.delete(type);
  }

  emit<K extends keyof E>(type: K, ...args: EmitArgs<E[K]>): void {
    const list = this.handlers.get(type) as ReadonlyArray<Handler<E[K]>> | undefined;
    if (!list) return;
    const payload = args[0] as E[K];
    for (let i = 0; i < list.length; i++) list[i]!(payload);
  }

  listenerCount(type: keyof E): number {
    return this.handlers.get(type)?.length ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
