# Gatewright

A 2D side-view colony-survival sandbox that runs in the browser. You guide a small band of
dwarves who dig, gather, build and craft in a procedurally generated world, defend their
home from monsters at night, and finally build a gate to the next world.

All names, art, sound and text are original to this project. Art and sound are generated
at runtime as placeholders, so the game currently needs no image or audio files.

**Status: Milestone 0 (scaffold).** The title screen, settings, game loop and an empty
game scene work. See [Roadmap](#roadmap) for what each milestone adds.

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

## Controls (Milestone 0)

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| 1, 2, 3 | Normal, double, triple speed |
| Esc | Open or close the in-game menu, close dialogs |
| ` (backtick) | Debug overlay: FPS, frame time, tick cost, ticks per second |

Every key can be changed in **Settings → Key bindings**. Keys are matched by physical
position, so the defaults stay put on AZERTY or Dvorak keyboards. Keys the browser
reserves (F3, F5, F11, F12, Tab, and any Ctrl/Alt/Cmd combination) can't be bound.

The game pauses itself when you switch to another tab, and stays paused when you come
back until you press Space.

## Project structure

```
src/
  main.ts          entry point
  config.ts        engine constants (tick rate, tile size, world size, zoom levels)
  app/             composition root: wires settings, input, storage, Phaser, UI and the session
  core/            pure building blocks: event bus, fixed timestep, seeded RNG, settings,
                   key bindings, time control, string table
  sim/             pure game state and rules (world, dwarves, jobs... arrive per milestone)
  platform/        browser APIs with graceful failure: storage, keyboard, input guards
  render/          Phaser: scenes, asset manifest, viewport sizing, audio
  ui/              HTML/CSS overlay in Preact: menus, HUD, settings, debug panel
  debug/           window.debug helpers (dev builds only)
  data/            game content as JSON (strings now; tiles, items, recipes... later)
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
- **Tiles, items, recipes, the tech tree, creatures and spells** get their JSON files in
  Milestones 1 to 7. This section will describe each file's format, with examples of adding
  an item and a recipe, as they arrive.

### Replacing placeholder art and sound

Every texture and sound is listed in one manifest, `src/render/assets/manifest.ts`, and
game code only refers to manifest keys. To use a real sprite instead of a generated one,
put the PNG under `src/assets/`, import it in the manifest, and change that entry from
`kind: 'generated'` to `kind: 'image'` with the same frame size and frame order. Sounds
work the same way (`kind: 'file'`). The manifest's header comment has a worked example.

## Testing

- `npm test` runs the unit tests in `src/**/*.test.ts`.
- `npm run smoke` serves the production build and drives it in headless Chromium: title
  screen, new game, the simulation ticking at the right rate, pause, menu, settings,
  right-click and mouse-wheel blocking, and high-DPI canvas sizing. Any console error fails
  the test. Screenshots go to `test-results/`.
- GitHub Actions runs type-checking, unit tests, the build and the smoke test on every
  push (`.github/workflows/ci.yml`). Failures show up as annotations on the run, and each
  run's screenshots, browser console logs and results are copied to the `ci-output`
  branch so they can be reviewed with plain git. That branch is never merged and can be
  deleted at any time.

## Debug tools

- Press **`** (backtick) in game for the debug overlay. In-world overlays (paths, job
  reservations, rooms, light levels, chunk borders) are added as those systems arrive.
- In dev builds (`npm run dev`), the browser console has `window.debug`:
  `debug.setSpeed(5)` runs the simulation 5x faster on top of the chosen speed;
  `spawnItem(id, count)`, `skipToNight()` and `revealMap()` become active in the
  milestones that add items, day/night and the map.

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
| 1 | World generation in a worker, chunked tile rendering, camera, digging by click | Next |
| 2 | Dwarves, pathfinding, job queue (dig, chop, haul) | |
| 3 | Items, storage, crafting stations, building blocks, walls, ladders, doors | |
| 4 | Hunger and sleep, day/night, lighting overlay, room detection | |
| 5 | Monsters, combat, invasion waves, defences | |
| 6 | Tech tree, farming and cooking, new dwarves, the World Gate, basic save/load | |
| 7 | Magic, full save system (slots, export/import), UI polish, balance | |
| 8 | Release: bundle optimisation, cross-browser testing, publishing guides | |

## Tech

TypeScript (strict), Vite 8, Phaser 4, Preact, Vitest, Playwright. Requires WebGL.
