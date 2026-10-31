/** Small pixel-style icons drawn as inline SVG on a 16x16 grid (no image files). */

const FILLED = {
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
  menu: 'M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z',
  // A stepped warning triangle with an exclamation mark cut out (even-odd fill).
  warning: 'M7 1h2v2h1v3h1v3h1v3h1v3H3v-3h1V9h1V6h1V3h1zM7 6v4h2V6zm0 5v2h2v-2z',
} as const;

const STROKED = {
  close: 'M4 4L12 12M12 4L4 12',
} as const;

export type IconName = keyof typeof FILLED | keyof typeof STROKED;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
      {name in STROKED ? (
        <path
          d={STROKED[name as keyof typeof STROKED]}
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="square"
          fill="none"
        />
      ) : (
        <path d={FILLED[name as keyof typeof FILLED]} fill="currentColor" fill-rule="evenodd" />
      )}
    </svg>
  );
}
