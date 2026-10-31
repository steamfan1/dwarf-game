import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../core/Store';

/**
 * Subscribe a component to part of a store. The component re-renders only when the
 * selected value changes (by `equals`, Object.is by default; pass `shallowEqual` for
 * selectors that build objects).
 */
export function useStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): S {
  const [value, setValue] = useState<S>(() => selector(store.get()));
  const selectorRef = useRef(selector);
  const equalsRef = useRef(equals);
  selectorRef.current = selector;
  equalsRef.current = equals;

  useEffect(() => {
    const sync = (): void => {
      const next = selectorRef.current(store.get());
      setValue((previous) => (equalsRef.current(previous, next) ? previous : next));
    };
    sync(); // the store may have changed between render and subscription
    return store.subscribe(sync);
  }, [store]);

  return value;
}
