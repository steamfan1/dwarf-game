/** Small pixel-style icons drawn as inline SVG on a 16x16 grid (no image files). */

const FILLED = {
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
  menu: 'M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z',
  // A stepped warning triangle with an exclamation mark cut out (even-odd fill).
  warning: 'M7 1h2v2h1v3h1v3h1v3h1v3H3v-3h1V9h1V6h1V3h1zM7 6v4h2V6zm0 5v2h2v-2z',
} as const;

const STROKED = {
  close: 'M4 4L12 12M12 4L4 12',
  plus: 'M8 3V13M3 8H13',
  minus: 'M3 8H13',
} as const;

/** Icons drawn pixel by pixel on a 12 x 12 grid ('X' is filled), centred in the 16 x 16 box. */
const PIXELS = {
  // A pick and an axe, crossed.
  auto: [
    'XXX......XX.',
    'X.XX....XXX.',
    '...XX..XXXX.',
    '....XXXX.XX.',
    '.....XX.....',
    '....XXXX....',
    '...XX..XX...',
    '..XX....XX..',
    '.XX......XX.',
    'XX........XX',
    'X..........X',
    '............',
  ],
  select: [
    'X...........',
    'XX..........',
    'XXX.........',
    'XXXX........',
    'XXXXX.......',
    'XXXXXX......',
    'XXXXXXX.....',
    'XXXXXXXX....',
    'XXXXX.......',
    'XX.XXX......',
    'X...XXX.....',
    '.....XX.....',
  ],
  pick: [
    '.XXXXXXXXXX.',
    'XX...XX...XX',
    'X....XX....X',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
  ],
  axe: [
    '.....XX.....',
    '..XXXXX.....',
    '.XXXXXX.....',
    'XXXXXXX.....',
    '.XXXXXX.....',
    '..XXXXX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
    '.....XX.....',
  ],
  priority: [
    '.....XX.....',
    '....XXXX....',
    '...XXXXXX...',
    '..XXX..XXX..',
    '.XXX....XXX.',
    '.....XX.....',
    '....XXXX....',
    '...XXXXXX...',
    '..XXX..XXX..',
    '.XXX....XXX.',
    '............',
    '............',
  ],
  focus: [
    '.....XX.....',
    '.....XX.....',
    '..XXXXXXXX..',
    '..X......X..',
    '..X..XX..X..',
    'XXX.XXXX.XXX',
    'XXX.XXXX.XXX',
    '..X..XX..X..',
    '..X......X..',
    '..XXXXXXXX..',
    '.....XX.....',
    '.....XX.....',
  ],
  // A hammer.
  build: [
    '..XXXXX.....',
    '.XXXXXXX....',
    '.XXXXXXX....',
    '..XXXXX.....',
    '....XXX.....',
    '.....XXX....',
    '......XXX...',
    '.......XXX..',
    '........XXX.',
    '.........XXX',
    '..........XX',
    '............',
  ],
  // Courses of bricks.
  wall: [
    'XXXXXXXXXXXX',
    'XX....XX....',
    'XX....XX....',
    'XXXXXXXXXXXX',
    '....XX....XX',
    '....XX....XX',
    'XXXXXXXXXXXX',
    'XX....XX....',
    'XX....XX....',
    'XXXXXXXXXXXX',
    '....XX....XX',
    '....XX....XX',
  ],
  // A chair.
  furniture: [
    '..XX........',
    '..XX........',
    '..XX........',
    '..XX........',
    '..XX........',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '..XX....XX..',
    '..XX....XX..',
    '..XX....XX..',
    '..XX....XX..',
    '............',
  ],
  // An anvil.
  craft: [
    '............',
    '............',
    'XXXXXXXXXX..',
    '.XXXXXXXXXXX',
    '..XXXXXXXX..',
    '....XXXX....',
    '....XXXX....',
    '...XXXXXX...',
    '..XXXXXXXX..',
    '..XXXXXXXX..',
    '............',
    '............',
  ],
  // A chest.
  chest: [
    '............',
    '.XXXXXXXXXX.',
    'X..........X',
    'X..........X',
    'XXXXXXXXXXXX',
    'X....XX....X',
    'X....XX....X',
    'X..........X',
    'X..........X',
    'XXXXXXXXXXXX',
    '............',
    '............',
  ],
} as const;

/** One 1 x 1 square per filled pixel, offset by 2 to centre a 12 x 12 map in the 16 x 16 box. */
function pixelPath(rows: readonly string[]): string {
  let path = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') path += `M${x + 2} ${y + 2}h1v1h-1z`;
  });
  return path;
}

const PIXEL_PATHS = Object.fromEntries(Object.entries(PIXELS).map(([name, rows]) => [name, pixelPath(rows)])) as Record<
  keyof typeof PIXELS,
  string
>;

export type IconName = keyof typeof FILLED | keyof typeof STROKED | keyof typeof PIXELS;

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
      ) : name in PIXELS ? (
        <path d={PIXEL_PATHS[name as keyof typeof PIXELS]} fill="currentColor" />
      ) : (
        <path d={FILLED[name as keyof typeof FILLED]} fill="currentColor" fill-rule="evenodd" />
      )}
    </svg>
  );
}
