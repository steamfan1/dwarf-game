# Gatewright

A 2D side-view colony-survival sandbox that runs in the browser. You guide a small band of
dwarves who dig, gather, build and craft in a procedurally generated world, defend their
home from monsters at night, and finally build a gate to the next world.

All names, art, sound and text are original to this project. Art and sound are generated
at runtime as placeholders, so the game currently needs no image or audio files.

**Status: Milestone 2 (dwarves).** Worlds are generated from a seed in a background worker
(hills, caves, lakes, lava, ores, trees, two biomes) and drawn with chunked tilemaps. Three
dwarves start beside the Hearth; you mark blocks to dig and trees to fell, and they find
their way there, do the work and carry what comes out back to the Hearth. See
[Roadmap](#roadmap) for what each milestone adds.

## Requirements

- Node.js 20.19+ or 22.12+ (the current LTS is fine)
- A current desktop Chrome, Firefox, Edge or Safari with WebGL

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload, debug helpers on `window.debug` |
| `npm run build` | Type-checks, then writes the production build to `dist/` |
| `npm run preview` | Serves `dist/` locally at http://localhost:4173 |
| `npm test` | Unit tests (Vitest) for the pure game logic |
| `npm run typecheck` | TypeScript in strict mode, no output |
| `npm run smoke` | Browser smoke tests against the build (run `npx playwright install chromium` once first) |
| `npm run check` | Build, unit tests and smoke tests in one go |

## Controls (Milestone 2)

You never move dwarves or change the world yourself: you mark work, and idle dwarves
take it on. Pick a tool from the toolbar on the left (or press its key), then click or
drag over the world.

| Tool | Key | What a click or drag does |
| --- | --- | --- |
| Auto | E | The tool you start with. Marks whatever you click: blocks for digging, trees for felling. A click on a mark removes it; a click on a dwarf selects it |
| Select | Q | Click a dwarf to see its details (also: click a name in the roster on the right) |
| Dig | F | Mark blocks for digging |
| Fell trees | C | Mark a tree for felling (click any part of it) |
| Cancel marks | X | Remove dig and felling marks |
| Priority | P | Set marked work to the priority picked under the tools (Low, Normal, High, Urgent) |

New marks get the priority picked under the tools; dwarves always take the most urgent
work first, then the nearest. Right-click (or Esc) puts the tool down, back to Auto; with
Auto in hand it deselects the dwarf.

| Input | Action |
| --- | --- |
| W A S D or arrow keys | Pan the camera (hold Shift to go faster) |
| Screen edges | Pan the camera when the pointer rests there (can be turned off in Settings) |
| Middle-drag | Drag the map around |
| Mouse wheel, + and - | Zoom between 1x and 4x, towards the pointer |
| M | Show or hide the minimap (click it to jump there) |
| Space | Pause / resume |
| 1, 2, 3 | Normal, double, triple speed |
| Esc | Close a dialog, put the tool down, deselect the dwarf, or open the in-game menu |
| ` (backtick) | Debug overlay: timing, jobs, paths, chunk borders, light levels |

Every key can be changed in **Settings → Key bindings**. Keys are matched by physical
position, so the defaults stay put on AZERTY or Dvorak keyboards. Keys the browser
reserves (F3, F5, F11, F12, Tab, and any Ctrl/Alt/Cmd combination) can't be bound.

The game pauses itself when you switch to another tab, and stays paused when you come
back until you press Space. The camera still moves while the game is paused, and you can
mark work while paused too.

### How the colony works

- **Dwarves dig, fell and haul.** An idle dwarf takes the most urgent marked job it can
  reach, walks there (walking, jumping up one tile, climbing ladders and background
  walls, swimming, and dropping up to four tiles; longer falls hurt), and works at it. Harder blocks take
  longer, and dwarves dig faster as their mining skill grows. Dug blocks and felled trees
  drop items, which dwarves carry to the Hearth when nothing more urgent is waiting. The
  top bar shows what's stored; the panel on the right lists everything.
- **Walls are for climbing.** Every block in the ground has a background wall behind it,
  and a dug-out block leaves its wall behind, so dwarves can climb straight up and down
  the shafts and caves they open (as they climb ladders).
- **Nobody gets stranded.** Dwarves only take work they can reach and come back from, and
  they won't dig out a block if that would leave someone in a hole they can't climb out
  of. Such work shows a red mark until a way opens up.
- **What sunlight reaches, you can see.** Sunlight lights the sky and a few blocks into
  the ground, so the whole surface is visible from the start, and it shines further in
  down every shaft the dwarves open. Lava and glow crystals give off light too, but don't
  give away what's down there: everything sunlight doesn't reach stays dark until a dwarf
  comes close. (Day and night arrive in Milestone 4.)

### Choosing a world

**New game** opens the New world dialog: type a seed or keep the random one, and pick a
biome. The same seed always produces the same world, in every browser. The page address
can preset the dialog, which is handy for testing and sharing:

| Address | Effect |
| --- | --- |
| `?seed=mossy-cavern-17` | Preset the seed |
| `?biome=snow` | Preset the biome (`temperate` or `snow`) |
| `?reveal=1` | Start with the fog of war lifted over the whole map |

## Project structure

```
src/
  main.ts          entry point
  config.ts        engine constants (tick rate, tile size, world size, zoom levels)
  app/             composition root: wires settings, input, storage, Phaser, UI and the session
  core/            pure building blocks: event bus, fixed timestep, seeded RNG, settings,
                   key bindings, time control, string table
  sim/             pure game state and rules
    world/         the tile grid (typed arrays), the tile registry built from tiles.json, trees
    worldgen/      seeded world generation: terrain, caves, liquids, ores, vegetation
    light/         per-tile light (sunlight, lava, the Hearth) that also decides what's explored
    nav/           how dwarves move, A* pathfinding with a per-tick budget and a path cache
    jobs/          the job board: dig, fell and haul jobs, reservations and priorities
    dwarves/       dwarves (data), their behaviour (DwarfAI) and colony settings
    items/         the item registry, items lying in the world, and the colony's storage
  workers/         the world-generation Web Worker
  platform/        browser APIs with graceful failure: storage, keyboard, input guards
  render/          Phaser: scenes, camera, asset manifest, viewport sizing, audio
    world/         chunked tilemaps, terrain atlas and tile art, fog of war, dwarf and item
                   sprites, designation marks, selection box, tile cursor
  ui/              HTML/CSS overlay in Preact: menus, HUD, settings, debug panel
  debug/           window.debug helpers (dev builds only)
  data/            game content as JSON: tiles, biomes, world generation, items, dwarves, strings
e2e/               browser smoke tests (Playwright)
.github/workflows/ CI and GitHub Pages deployment
```

## How it fits together

- **Simulation and rendering are separate.** `sim/` and `core/` hold all game state and
  rules and never import Phaser or touch the DOM, so they run in unit tests (and could run
  in a Web Worker). A test (`src/architecture.test.ts`) fails the build if that rule is
  broken, or if `Math.random()` sneaks into game logic.
- **Fixed timestep.** The simulation advances in ticks of exactly 1/20 s
  (`core/FixedTimestep.ts`), driven from Phaser's `requestAnimationFrame` loop. Long frames
  are clamped, a per-frame tick cap prevents runaway catch-up, and sprites are drawn
  between the last two ticks so motion stays smooth at any frame rate. 2x and 3x speed run
  40 and 60 ticks per second.
- **Deterministic.** All randomness comes from a seeded generator (`core/Rng.ts`) whose
  state can be saved, so a world replays identically from its seed and the player's orders.
  Game logic also avoids `Math.hypot`, `**`, `sin`, `cos` and the like, whose last digit can
  differ between browser engines, so a seed builds the same world in Chrome, Firefox and
  Safari. The architecture test enforces both rules.
- **World generation in a worker.** `sim/worldgen/generateWorld.ts` builds the 400 x 200
  world in about 50 to 100 ms inside a Web Worker behind a loading bar, then transfers the
  typed arrays back without copying them.
- **Chunked rendering.** The world is split into 32 x 32 chunks, each drawn by its own
  Phaser tilemap layers (walls, and blocks with liquids). Only chunks near the camera have
  layers: they come from a pool and are handed back when a chunk scrolls far out of view,
  so memory depends on the screen size rather than the world size. Digging a block redraws
  just that cell and its four neighbours. Block edges, outlines and grass caps come from
  one generated terrain atlas.
- **Sunlight decides what's explored.** `sim/light/Lighting.ts` keeps two light values per
  tile: sunlight, which falls down each column, and glow, from lava, glow crystals and the
  Hearth (torches later). Both spread by flood fill, dimming faster through blocks and
  water. Any sunlit cell counts as explored, as do cells near a dwarf; glow alone never
  uncovers anything. A dug block relights only the cells within reach of it (a few
  hundred), never the whole world.
- **Fog of war** is a 400 x 200 texture (one pixel per tile) stretched over the world,
  updated only where cells are revealed, at most once per frame. In Milestone 4 the same
  texture also shows darkness from the light levels.
- **Pathfinding** is A* over the moves a dwarf can make (`sim/nav/`): walking, jumping,
  dropping, swimming and climbing ladders or background walls. The moves are worked out
  from the tile grid on the fly, so terrain changes never leave a stale graph. At most 4 searches run
  per tick; a dwarf whose turn doesn't come waits a tick, so a burst of orders never drops
  a frame. Paths are cached, and a terrain change forgets only the paths through its
  chunk. Two flood fills from the Hearth (`HomeMaps`) tell which cells a dwarf can reach
  and come back from, which is how dwarves avoid work that would strand them.
- **Jobs** live on a board (`sim/jobs/JobBoard.ts`): most urgent first, then nearest, then
  oldest. Claiming a job reserves it, so two dwarves never take the same one. Work done is
  kept on the job, so an interrupted dig isn't lost.
- **The player only gives orders.** Tools call `Simulation.designate`, `cancelDesignations`
  and `prioritize`, which only add, remove or change jobs. The world changes only through
  the dwarves' work (and, in Milestone 7, spells).
- **Event bus.** Systems announce what happened on a typed bus (`core/EventBus.ts`,
  event list in `sim/events.ts`) instead of calling each other.
- **HTML UI over the canvas.** Panels are Preact components styled with plain CSS
  (`ui/ui.css`). The overlay ignores the mouse except over panels and buttons, so clicks on
  a panel never reach the world. The UI talks to the game only through the `UiCommands`
  interface and reads state from a store, so it doesn't depend on Phaser.
- **Crisp pixels on every screen.** The canvas renders at full device resolution
  (`render/ViewportManager.ts`) and the camera zoom is always a whole number of device
  pixels per world pixel (`core/viewport.ts`), so pixel art never blurs, including on
  high-DPI laptops.
- **Storage that can't crash the game.** All storage access goes through
  `platform/storage.ts`. If the browser blocks it (for example in private browsing), the
  game still runs, keeps data in memory for the session and shows a warning.

## Adding and changing content

Game content lives in JSON under `src/data/` and is bundled by Vite, so nothing is fetched
at runtime.

- **Text:** every player-visible string is in `src/data/strings/en.json` and is looked up
  with `t('key')`. Placeholders look like `{name}`. A translation would be another file
  with the same keys.
- **Items** are in `src/data/items.json` and **dwarves** (names, looks, speeds, skills) in
  `src/data/dwarves.json`, both described below. **Recipes, the tech tree, creatures and
  spells** get their JSON files in Milestones 3 to 7, documented here as they arrive.

Every file is checked when the game starts. A mistake (a misspelt tile id, a colour that
isn't `#rrggbb`, a range with min above max) stops the game with a message naming the
file and the field, for example `biomes.json: biomes[1].trees.log refers to unknown tile
"pine_logg"`. The unit tests run the same checks, so `npm test` catches it too.

### Tiles: `src/data/tiles.json`

Three lists: `tiles` (the foreground: blocks, plants, decorations), `walls` (background
walls) and `liquids`. The first tile must be `air` and the first wall `none`.

```json
{
  "id": "tin_ore",
  "name": "Tin ore",
  "solid": true,
  "hardness": 2.5,
  "drops": "tin_ore",
  "mapColor": "#b9c3c9",
  "art": {
    "style": "ore",
    "base": "#7c7f87", "dark": "#5c5f66", "light": "#9a9da5",
    "ore": { "main": "#c8d2d8", "light": "#f2f6f8", "shadow": "#7d878d" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | snake_case, unique. Saves and other files refer to tiles by this id. |
| `name` | Shown when the pointer is over the tile. |
| `solid` | Blocks movement and can be stood on. Non-solid tiles (trunks, leaves, grass tufts) can be walked through. |
| `hardness` | Relative digging time, 1 = dirt (see `digTicksPerHardness` in dwarves.json). |
| `indestructible` | Can never be dug (bedrock). |
| `drops` | Item id (from items.json) left behind when dug, or when a tree's trunk is felled. |
| `replaceable` | Building or growing over it simply removes it (grass tufts, flowers). |
| `climbable` | Dwarves climb up and down through it and can stand on it (ladders). |
| `light` | Light it gives off, 0 to 15 (15 is daylight). Liquids can glow too (lava is 12). |
| `connect` | What the tile visually joins with: `solid` (default for solid tiles), `self` or `none`. |
| `mapColor` | Colour on the minimap. |
| `art` | How the placeholder art is painted (below). |

`art.style` picks a painter: `soil` (speckled earth), `rock` (cobbled stone), `ore` (rock
with nuggets, needs `ore` colours), `crystal` (rock with shards), `ice`, `log` (tree
trunk), `leaves`, or `sprite` (a small picture drawn from `rows` of palette characters, as
in the `tall_grass` and `flowers` entries). `base`, `dark` and `light` are the main colours.
A `cap` (grass, snow) is drawn along a block's top edge only when nothing sits on it.
Edges, outlines and rounded corners are worked out automatically from the neighbours.

Walls use the same art fields; liquids have `base`, `light`, `dark` and `alpha`.

### Biomes: `src/data/biomes.json`

Each biome names its `surfaceTile`, `soilTile`, an optional `capTile` layer (snow over
dirt), its `trees` (`log` and `leaves` tiles, `broadleaf` or `conifer` shape, chance,
spacing and trunk heights), surface `decorations` with their chances, `pools` (liquid,
optional frozen top and sandy shore, how many) and its `sky` gradient. A new biome
appears in the New world dialog automatically.

### World generation: `src/data/worldgen.json`

Numbers that shape every world: surface height and hilliness, the depth of the soil,
deep-stone, basalt and bedrock bands (as fractions of the world's height), cave density
and smoothing, lake and lava chances, and the ore veins. An ore rule looks like this:

```json
{ "tile": "tin_ore", "host": "stone", "minDepth": 0.1, "maxDepth": 0.5, "veins": 40, "size": [3, 7] }
```

Veins only replace their `host` rock, between `minDepth` and `maxDepth` (0 = the average
surface, 1 = the bottom of the world). So adding a new ore takes two steps: a tile entry
in tiles.json and an ore rule here.

### Items: `src/data/items.json`

```json
{
  "id": "tin_ore",
  "name": "Tin ore",
  "category": "ore",
  "description": "Pale rock with dull grey flecks.",
  "stack": 50,
  "icon": { "style": "ore", "base": "#7c7f87", "dark": "#5a5d64", "light": "#a2a5ad", "accent": "#c8d2d8" }
}
```

| Field | Meaning |
| --- | --- |
| `id` | snake_case, unique. Tiles' `drops` and (later) recipes refer to items by this id. |
| `name`, `description` | Shown in the HUD. |
| `category` | `block`, `material`, `ore`, `tool`, `weapon`, `armor`, `food` or `furniture`. |
| `stack` | Most of the item in one pile on the ground or in a dwarf's arms (default 50). |
| `icon` | The placeholder icon: `style` is `lump`, `pile`, `ball`, `gem`, `ore` or `log`, with `base`, `dark` and `light` colours and an `accent` for ore flecks. |

Every tile's `drops` must name an item here; the game checks this at start-up. So a new
ore takes three entries: the tile, its ore rule in worldgen.json, and the item it drops.

### Dwarves: `src/data/dwarves.json`

How many dwarves the colony starts with (`startingDwarves`) and can grow to
(`maxDwarves`), the name parts and colours new dwarves are made from, and the numbers that
set the pace of the game: `movement` (ticks per step for each kind of move, the safe drop
and fall damage), `vision` (how near a dwarf must be to uncover a cell), `work` (ticks to
dig a block of hardness 1, to fell a tree, to pick up and put down) and `skills` (the
experience each level needs and how much faster each level works). There are 20 ticks per
second at normal speed.

### Replacing placeholder art and sound

Every texture and sound is listed in one manifest, `src/render/assets/manifest.ts`, and
game code only refers to manifest keys. To use a real sprite instead of a generated one,
put the PNG under `src/assets/`, import it in the manifest, and change that entry from
`kind: 'generated'` to `kind: 'image'` with the same frame size and frame order. Sounds
work the same way (`kind: 'file'`). The manifest's header comment has a worked example.

## Testing

- `npm test` runs the unit tests in `src/**/*.test.ts`.
- `npm run smoke` drives the game in headless Chromium twice, once on the production build
  and once on the dev server (`npm run dev`): creating worlds in both biomes, checking the
  picture and that the sunlit surface is visible, marking blocks and a tree and watching
  the dwarves dig, fell and haul, the dwarf panel, zooming and panning, the minimap, the
  simulation ticking at the right rate, pause, menu, settings, right-click and mouse-wheel
  blocking, and high-DPI canvas sizing. Any console error fails the test. Screenshots and
  each test's browser console log go to `test-results/`. `e2e/perf.spec.ts` also records
  frame rates and a CPU profile for comparing runs.
- GitHub Actions runs type-checking, unit tests, the build and the smoke test on every
  push (`.github/workflows/ci.yml`). Failures show up as annotations on the run, and each
  run's screenshots, browser console logs and results are copied to the `ci-output`
  branch so they can be reviewed with plain git. That branch is never merged and can be
  deleted at any time.

## Debug tools

- Press **`** (backtick) in game for the debug overlay: frame and tick timing, camera and
  cursor tiles, chunks drawn, jobs by type (and how many are blocked), pathfinding
  counts, and how far the dwarves can range from the Hearth. In the world it draws chunk
  borders, each dwarf's remaining path (cyan) and the job it has reserved (gold), and the
  "Show light levels" box swaps the fog of war for the light map. Room regions arrive in
  Milestone 4.
- In dev builds (`npm run dev`), the browser console has `window.debug`:
  `debug.setSpeed(5)` runs the simulation 5x faster on top of the chosen speed,
  `debug.revealMap()` lifts the fog of war, and `debug.spawnItem('stone', 20)` drops items
  beside the Hearth for the dwarves to store. `skipToNight()` becomes active with day and
  night in Milestone 4.

## Deploying

`npm run build` produces a static `dist/` folder that works from any web host, at the
root of a domain or in a sub-folder.

### GitHub Pages (set up already)

1. In the repository on GitHub: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
2. Push to `main`. The CI workflow builds, tests and deploys; the game appears at
   `https://<your-user>.github.io/<repo>/` a few minutes later.

On GitHub's free plan, Pages works for public repositories.

### itch.io

1. `npm run build`
2. Zip the **contents** of `dist/` (so `index.html` is at the top of the zip, not inside a
   `dist` folder).
3. On itch.io, create a new project, set **Kind of project** to **HTML**, upload the zip
   and tick **This file will be played in the browser**.
4. Under **Embed options**, set the viewport to 1280 × 720 or larger and enable the
   **Fullscreen button**.

Some browsers (Safari in particular) restrict storage inside embedded frames. If that
happens the game still runs and warns that settings and saves won't be kept; playing in
fullscreen or opening the game in its own tab avoids it.

### Netlify or any static host

Drag the `dist/` folder onto Netlify Drop (app.netlify.com/drop), or connect the
repository with build command `npm run build` and publish directory `dist`. Any other
static host works the same way: upload the contents of `dist/`.

## Roadmap

| Milestone | Contents | Status |
| --- | --- | --- |
| 0 | Scaffold: Vite + TypeScript + Phaser 4, title screen, empty game scene, settings, CI | Done |
| 1 | World generation in a worker, chunked tile rendering, camera, digging by click | Done |
| 2 | Dwarves, pathfinding, job queue (dig, chop, haul); light shows the surface | Done |
| 3 | Items, storage, crafting stations, building blocks, walls, ladders, doors | Next |
| 4 | Hunger and sleep, day/night, lighting overlay, room detection | |
| 5 | Monsters, combat, invasion waves, defences | |
| 6 | Tech tree, farming and cooking, new dwarves, the World Gate, basic save/load | |
| 7 | Magic (including spells that reshape the world: the only way the player changes it directly), full save system (slots, export/import), UI polish, balance | |
| 8 | Release: bundle optimisation, cross-browser testing, publishing guides | |

## Tech

TypeScript (strict), Vite 8, Phaser 4, Preact, Vitest, Playwright. Requires WebGL.
