# Gatewright

A 2D side-view colony-survival sandbox that runs in the browser. You guide a small band of
dwarves who dig, gather, build and craft in a procedurally generated world, defend their
home from monsters at night, and finally build a gate to the next world.

All names, art, sound and text are original to this project. Art and sound are generated
at runtime as placeholders, so the game currently needs no image or audio files.

**Status: Milestone 6 (tech tree, farming and cooking, new dwarves, the World Gate,
saving).** Worlds are generated from a seed in a background worker (hills, caves, lakes,
lava, ores, trees, two biomes) and drawn with chunked tilemaps. Three dwarves start beside
the Hearth. You mark blocks to dig, trees to fell, fields to farm and animals to hunt,
plan blocks, walls, ladders, doors and furniture, and queue crafts; the dwarves do all of
it, fetching materials from storage (the Hearth and any chests). They eat, sleep through
the night, and fight: monsters creep out of the dark at night and slowly smash their way
through doors and walls, and every fifth night an invasion pours through a portal. Making
new things climbs a six-tier tech tree that unlocks recipes and brings new dwarves (up to
twelve); its last tier unlocks the World Gate, and building it wins the world. The game
saves itself every dawn. See [Roadmap](#roadmap) for what each milestone adds.

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

## Controls (Milestone 6)

You never move dwarves or change the world yourself: you plan work, and idle dwarves
take it on. Pick a tool from the toolbar on the left (or press its key), then click or
drag over the world.

| Tool | Key | What a click or drag does |
| --- | --- | --- |
| Auto | E | The tool you start with. Marks whatever you click: blocks for digging, trees for felling, berry bushes and mushrooms for picking, animals for hunting, furniture to take apart, fallen dwarves for revival. A click on a mark removes it; a click on a dwarf selects it |
| Select | Q | Click a dwarf to see its details (also: click a name in the roster on the right) |
| Dig | F | Mark blocks (and, with a click, ladders, doors and furniture) to dig out or take apart |
| Fell trees | C | Mark a tree for felling (click any part of it) |
| Farm | G | Mark farm plots for the crop picked in the palette (wheat or sunroot): click or drag along open ground over dirt or clay. Dwarves till, sow, and bring in every harvest, again and again |
| Build | B | Plan blocks, ladders and doors from the material picked in the palette beside the toolbar |
| Walls | V | Plan background walls, which dwarves can climb, from the picked material |
| Furniture | T | Click where a chest, torch, crafting station, bed, table... should stand |
| Cancel | X | Remove planned work of any kind |
| Priority | P | Set planned work to the priority picked under the tools (Low, Normal, High, Urgent) |

New plans get the priority picked under the tools; dwarves always take the most urgent
work first, then the nearest. The palette shows how much of each material is stored; you
can plan with materials you don't have yet, and the work waits for them. While a build
tool is in hand, a see-through picture shows what would go under the pointer: green where
it can, red where it can't, and the readout in the top-left corner says why. Right-click
(or Esc) puts the tool down, back to Auto; with Auto in hand it deselects the dwarf.

| Input | Action |
| --- | --- |
| W A S D or arrow keys | Pan the camera (hold Shift to go faster) |
| Screen edges | Pan the camera when the pointer rests there (can be turned off in Settings) |
| Middle-drag | Drag the map around |
| Mouse wheel, + and - | Zoom between 1x and 4x, towards the pointer |
| K | Crafting panel: every unlocked recipe, by station, and the queue of orders |
| R | Tech tree: every tier, what it unlocks, what has been made, and the research bar |
| I | Show or hide the list of stored goods (the storage panel on the right) |
| M | Show or hide the minimap (click it to jump there) |
| Space | Pause / resume |
| 1, 2, 3 | Normal, double, triple speed |
| Esc | Close a dialog, the crafting panel or the tech tree, put the tool down, deselect the dwarf, or open the in-game menu (with Save game) |
| ` (backtick) | Debug overlay: timing, jobs, paths, chunk borders, light levels |

The top bar shows the day, the time and a sun or a moon, and, when an invasion is coming,
a countdown to the portal opening (then how many invaders are left). The readout in the
top-left corner describes whatever is under the pointer: a block (and the room it's in,
or how badly it's been smashed), a dwarf, or a creature (how hurt it is and what it's up
to). Monsters the colony can see show as red dots on the minimap, the portal as a violet
one.

The interface is sized for easy reading at 100%; **Settings → Interface size** makes it
smaller or larger (75% to 200%), and everything on screen scales together.

Every key can be changed in **Settings → Key bindings**. Keys are matched by physical
position, so the defaults stay put on AZERTY or Dvorak keyboards. Keys the browser
reserves (F3, F5, F11, F12, Tab, and any Ctrl/Alt/Cmd combination) can't be bound.

The game pauses itself when you switch to another tab, and stays paused when you come
back until you press Space. The camera still moves while the game is paused, and you can
mark work while paused too.

### How the colony works

- **Dwarves dig, fell and haul.** An idle dwarf takes the most urgent marked job it can
  reach, walks there (walking, jumping up one tile, climbing ladders and background
  walls, swimming, and dropping up to four tiles; longer falls hurt), and works at it.
  Harder blocks take longer, and dwarves dig faster as their mining skill grows (and with
  a pickaxe). Dug blocks and felled trees drop items (trees give logs, and fibre from
  their leaves), which dwarves carry to storage when nothing more urgent is waiting.
- **Storage is the Hearth plus every chest.** They count as one store: a dwarf puts
  things away at, and fetches them from, whichever is nearest. Room is counted in stacks
  (the Hearth holds 24, each chest 16); when it's full, goods wait on the ground and the
  game says so. The top bar shows the most plentiful goods, the storage panel on the
  right shows everything and how full it is.
- **Building fetches its materials.** A planned block, wall or piece of furniture shows
  see-through where it will go. A dwarf reserves the material in storage, fetches it,
  carries it over and builds. Work whose material isn't in storage waits with an amber
  question mark, and starts by itself once some arrives. Blocks need something to hold
  them up (a block, ladder or door beside them, or a wall behind); a planned block holds
  up the next one, so a row or column can be planned in one drag and gets built outward.
  Walls work the same way, and since dwarves climb walls, a column of walls is its own
  scaffolding. Doors let dwarves through but stop light; ladders can be climbed; glass is
  solid but lets light through. Dwarves won't put a block where it would shut someone in,
  and they step out of the way of a block that's about to go where they stand.
- **Furniture.** Chests add storage room; torches give light (and flicker); a workbench,
  furnace, anvil, loom and kitchen stove are crafting stations. Most furniture stands on
  the floor; torches hang on a wall or beside a block. A click with Auto or Dig marks
  furniture to be taken apart: it comes back as an item, and nothing it held is lost.
- **Crafting.** The crafting panel (K) lists every recipe by where it's made, with the
  materials it takes (in red when the colony is short). Queuing one only asks for it: a
  free dwarf reserves the materials, fetches them, walks to a free station of the right
  kind (by-hand recipes are made right at the store) and puts what it made into storage.
  Each order shows how many are done and whether it's waiting for materials or for a
  station to be built. Crafting gives crafting experience, which makes dwarves quicker.
- **Dwarves equip themselves.** A dwarf with nothing better to do takes better gear from
  storage (a pickaxe, a sword, armour...) and puts back what it used before. Pickaxes
  make digging faster; weapons and armour decide fights.
- **Dwarves eat.** Hunger goes down all the time (a full dwarf lasts more than a day). Below
  about half, a dwarf fetches the most filling food in storage and eats it, at a table if
  one stands within 30 tiles: a meal there goes a quarter further, half again in a room.
  The colony starts with 12 bread and 10 berries. A hungry dwarf works slower; one with
  nothing left to eat starves: the game warns you, and it loses health until it eats, or
  dies of it.
- **Dwarves sleep.** Energy goes down while a dwarf is awake. At nightfall the dwarves
  that need it go to bed, in the nearest free bed or else on the floor by the Hearth
  (which rests them less), and sleep until morning; sleep heals them too. A hungry dwarf
  gets up to eat if there's food. A tired dwarf works slower, and one that runs out of
  energy altogether falls asleep where it stands. The roster shows who is hungry or tired.
- **Rooms.** A space closed in by blocks and doors, with a background wall behind every
  cell of it, is a room (up to 400 cells; a big cave isn't one). A bed in a room with a
  light (a torch, a furnace or stove, the Hearth) gives half as much sleep again, and a table in a
  room the better meal. The readout shows the room under the pointer and what's in it, and
  the debug overlay tints every room. Monsters never appear inside a room.
- **Day and night.** A day is 6 minutes of daylight and 3 of night at normal speed
  (`src/data/time.json`). The light fades out over the last half minute of the day and
  comes back at dawn, and the sky turns deep blue. At night the sun gives a fifth of its
  light (moonlight), so the Hearth, torches, lava and crystals stand out in the dark.
- **Wild food.** Berry bushes grow on the surface and mushrooms on cave floors; Auto marks
  them for picking. A bush gives 3 berries and grows more two days later; a picked
  mushroom is gone. A kitchen stove cooks 2 mushrooms into a filling stew.
- **Monsters come out at night** on dark cells around the colony: never inside a room,
  never in light, never right next to a dwarf, and a few more each night. Light is the
  first defence (torches keep them off), doors and walls the second. At dawn those caught
  in the light slink away; any that found a dark cave stay there.
- **Four kinds of monster.** The Gloomling smashes doors and anything the dwarves built;
  the Cragskitter runs up walls and leaps two tiles but can only break doors; the
  Burrowmaw tunnels through earth and soft stone straight at its prey; the Bilespitter
  can't break anything, but spits bile at dwarves it can see from seven tiles. Monsters
  weigh walking round to an open way in against smashing the nearest door or wall, and
  cracks show how close they are to breaking it. Monsters get a little tougher every day.
- **Breaking in takes time.** Every block has a durability: sand and dirt give way
  soonest, wood holds out more than twice as long, stone longer still, brick longest. A
  lone Gloomling needs about a minute for a wooden door, and a Burrowmaw a quarter of a
  minute for each block of earth. The damage stays with the block, so a pack battering
  the same door breaks it far sooner (three Gloomlings in about 20 seconds), and others
  arriving go for the block that's already giving way.
- **Dwarves fight by themselves.** A dwarf that sees a monster within 7 tiles drops what
  it's doing and fights it: with its fists, a sword, or a crossbow from a distance.
  Weapons set the damage, armour softens every blow, and combat skill grows with every
  hit. A badly hurt dwarf breaks off and runs for the Hearth, where it mends (and fights
  back if cornered there). A sleeping dwarf wakes when it's attacked, when a monster comes
  right up to it, or when a door is being smashed nearby. Meals mend a little too:
  cooked meat most.
- **Invasions.** Every fifth night a portal opens on the surface, some way off to one
  side. The colony is warned a minute and a half before dusk (a horn, and a countdown in
  the top bar), and the portal's place shows as a faint shimmer. At nightfall invaders
  pour through it, more each time: their number grows with the day and with the tier the
  colony has reached in the tech tree. At dawn the portal draws any survivors back.
- **Defences.** Spike traps stab any creature that steps on them; bolt throwers (a
  crossbow on a post) shoot monsters up to 8 tiles away by themselves. Both are built
  like any furniture. Doors are the weak point: plank walls outlast them, and brick and
  stone walls take far longer again.
- **Hunting.** Mossbacks and Woolhorns graze on the hills by day. Click one with Auto and
  a dwarf goes after it: a hurt animal runs, but dwarves are faster. Each leaves raw meat
  (cook it at the kitchen stove) and hides (tan them into leather at a workbench, then
  sew a leather jerkin at the loom).
- **Death and revival.** A dwarf that dies stays where it fell. A rekindling draught,
  brewed at the kitchen stove from dusk essence (which monsters sometimes leave behind),
  a crystal and mushrooms, brings it back: click the fallen dwarf with Auto and a dwarf
  pours one on it. Nothing brings back a dwarf lost in lava. If every dwarf dies, the
  colony has fallen.
- **The tech tree.** Recipes come in six tiers: Campfire, Homestead, Smithy, Forge,
  Delving and the World Gate. A colony starts with the first; every item made for the
  first time earns research (more in later tiers), and a full research bar unlocks the
  next tier. The crafting panel lists only what's unlocked; the tech tree panel (R) shows
  every tier, what it unlocks, and a tick on each item already made.
- **New dwarves.** Each tier from the second on brings new dwarves to the Hearth (one, then
  two at a time), up to twelve in all. They need food and beds like everyone else.
- **Farming.** The Farm tool marks plots along open ground over dirt or clay (grass and
  flowers are cleared away). A dwarf tills the soil into farmland, another sows a seed
  fetched from storage, and the crop grows while its cell has light: sunlight by day, or
  a torch nearby, so a lit cellar farm grows day and night. Wheat takes three days of
  daylight, sunroot two; ripe crops are picked by themselves and give the crop and two
  seeds, and the plot is sown again. A colony starts with six wheat and four sunroot
  seeds. Hovering a plot shows how far it has grown, or that it's too dark to grow.
- **Cooking.** Raw food is edible, but the kitchen stove makes far more of it: raw meat
  fills 15, cooked meat 45; a sunroot 10, baked 32; three handfuls of wheat (5 each) make
  a loaf of bread worth 40. Dwarves eat the most filling food in storage first.
- **The World Gate.** The last tier unlocks the World Gate, an arch of runestones (cut at
  the anvil from deep stone and crystal) built with gold and iron. Once it stands, the
  world is won: the next biome opens for new worlds, and up to three dwarves can step
  through it into a fresh world, keeping their names, skills and gear (or the colony can
  stay and keep playing). The campaign starts in the temperate forest; the snowy north
  opens with the first gate.
- **Saving.** The game saves itself every dawn, and **Save game** in the menu (Esc) saves
  at any time; **Continue** on the title screen picks up the latest save, even after the
  browser is closed. There is one save slot for now (Milestone 7 adds slots, export and
  import). Saves are compressed and kept in the browser's IndexedDB; if the browser
  blocks storage (some private windows), the game says so and saves last only until the
  tab closes.
- **Walls are for climbing.** Every block in the ground has a background wall behind it,
  and a dug-out block leaves its wall behind, so dwarves can climb straight up and down
  the shafts and caves they open (as they climb ladders).
- **Nobody gets stranded.** Dwarves only take work they can reach and come back from, and
  they won't dig out a block if that would leave someone in a hole they can't climb out
  of. Such work shows a red mark until a way opens up.
- **What sunlight reaches, you can see.** Sunlight lights the sky and a few blocks into
  the ground, so the whole surface is visible from the start (night included), and it
  shines further in down every shaft the dwarves open. Lava and glow crystals give off
  light too, but don't give away what's down there: everything sunlight doesn't reach
  stays hidden until a dwarf comes close. Explored places are drawn darker the less light
  reaches them; a tunnel no light reaches stays dimly visible.

### Choosing a world

**New game** opens the New world dialog: type a seed or keep the random one, and pick a
biome. The same seed always produces the same world, in every browser. The page address
can preset the dialog, which is handy for testing and sharing:

| Address | Effect |
| --- | --- |
| `?seed=mossy-cavern-17` | Preset the seed |
| `?biome=snow` | Preset the biome (`temperate` or `snow`), even one the campaign hasn't opened yet |
| `?reveal=1` | Start with the fog of war lifted over the whole map |
| `?hour=22` | Start at that hour (0 to 23) instead of 8 in the morning: 22 is night |

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
    time/          day and night: the clock, the day count, how strong the sun is
    rooms/         room detection: enclosed spaces, found by flood fill
    creatures/     the bestiary, creatures' moves (CreatureNav), CreatureAI, the Spawner
    combat/        damage and armour, line of sight, missiles, damage to doors and blocks
    nav/           how dwarves move, A* pathfinding with a per-tick budget and a path cache
    jobs/          the job board: dig, fell, haul, build, craft, pick... jobs, claims and priorities
    dwarves/       dwarves (data), their behaviour, needs and fighting (DwarfAI), colony settings
    items/         the item registry, items lying in the world, and the colony's storage
    furniture/     the furniture registry and the furniture standing in the world
    crafting/      recipes and the queue of crafting orders
    tech/          the tech tree and the colony's research
    farming/       crops, and the colony's farm plots
    save/          save files: the simulation's state, run-length encoding, versions
  workers/         the world-generation Web Worker
  platform/        browser APIs with graceful failure: storage, saved games (IndexedDB and
                   gzip), keyboard, input guards
  render/          Phaser: scenes, camera, asset manifest, viewport sizing, audio
    world/         chunked tilemaps, terrain atlas and tile art, fog of war, dwarf, item and
                   furniture sprites, designation marks, planned-work ghosts, selection box,
                   tile cursor
  ui/              HTML/CSS overlay in Preact: menus, HUD, settings, debug panel
  debug/           window.debug helpers (dev builds only)
  data/            game content as JSON: tiles, biomes, world generation, items, furniture,
                   recipes, the tech tree, crops, dwarves, time of day, creatures, threats,
                   strings
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
  tile: sunlight, which falls down each column, and glow, from lava, glow crystals, the
  Hearth, torches and furnaces. Both spread by flood fill, dimming faster through blocks and
  water. Any sunlit cell counts as explored, as do cells near a dwarf; glow alone never
  uncovers anything. A dug block relights only the cells within reach of it (a few
  hundred), never the whole world.
- **Fog of war and darkness** share one 400 x 200 texture (one pixel per tile) stretched
  over the world (`render/world/FogOverlay.ts`): unexplored cells are opaque, explored ones
  are darkened by how little light reaches them. Cells are updated only where they're
  revealed or relit, at most once per frame; the whole texture is redrawn only when the
  daylight changes by a visible step, a few times a second at dawn and dusk.
- **Day and night** (`sim/time/TimeOfDay.ts`) are worked out from the tick, so saving the
  tick saves the time of day. The light map itself never changes at nightfall: the sun's
  strength scales the sunlight channel only where it's used (the darkness texture, and
  `Simulation.lightNow`), so night costs nothing to compute.
- **Needs** (hunger, energy, health) are kept on each dwarf and change every tick, at
  rates worked out from the per-day numbers in dwarves.json. Eating and sleeping are
  personal jobs: a dwarf makes one for itself when it needs to (`sim/dwarves/DwarfAI.ts`),
  so they never go on the board for others to take, and a meal reserves its food in
  storage like any other job's materials.
- **Rooms** (`sim/rooms/RoomMap.ts`) come from one flood fill over the open cells of the
  whole world into a typed array of room ids, rebuilt at most every 10 ticks and only after
  blocks, walls, doors or furniture change. Each room counts the beds, tables and lights
  in it.
- **Creatures** (`sim/creatures/`) are plain data like dwarves, moved by `CreatureAI`.
  Each kind gets its own set of moves (`CreatureNav`, the creature counterpart of
  NavGrid): doors stop creatures, `jump` and `safeDrop` vary, climbers cling to walls,
  and a creature that breaks things may plan a path *through* a door or block it can
  smash, at an extra cost worked out from how long the blows it still needs would take
  (capped at 40 steps, so monsters would rather smash a door than walk far round; and a
  battered block is cheaper, so a pack converges on it). So a single A* search decides
  between walking round and breaking in. Creature searches are greedy (a
  weighted heuristic: tunnelling makes costs high), capped at 5,000 cells, and have their
  own budget of 2 per tick, so a horde never slows the dwarves' planning.
- **The Spawner** (`sim/creatures/Spawner.ts`) brings monsters out at night, animals by
  day and invasions every few nights, all from `threats.json`. Built blocks carry a flag
  (`FLAG_BUILT` in the world's cell flags) so monsters that smash built things can tell
  them from the ground.
- **Combat** (`sim/combat/`): armour softens a hit of d to d × s / (s + armour); missiles
  live in a pool (`Projectiles`) and are reused, as are their sprites and the puffs and
  sparks on screen, so a long siege doesn't churn the garbage collector. Damage to doors
  and blocks is kept per cell (`TileDamage`) and drawn as cracks.
- **The tech tree** (`sim/tech/`) knows which tier every recipe belongs to; `Research`
  keeps the tier reached, the research towards the next, and the items made so far.
  Crafting reports each finished item to it, and a tier reached brings its dwarves.
- **Farm plots** (`sim/farming/`) are standing orders: each plot goes untilled, empty,
  growing, ripe and round again, and the simulation posts the till, sow and pick jobs as
  they come due (checked three times a second, along with the light each crop gets).
- **Saving** (`sim/save/`): `captureState` writes down everything the simulation can't
  work out again from the world's cells, naming items, tiles, furniture, creatures,
  recipes and crops by id; `encodeSave` packs that as JSON with the world's grids
  run-length encoded chunk by chunk (`rle.ts`), behind a format version; the platform layer
  (`platform/saves.ts`) gzips the bytes with CompressionStream and keeps them in
  IndexedDB, falling back to memory if storage is blocked. Loading maps every saved id
  onto today's content files, so saves survive the files growing or being reordered, and
  refuses (with a clear message) a save from a newer format, or a damaged one. What a save
  leaves out on purpose: paths, light, rooms, missiles in flight, and what each dwarf and
  creature was in the middle of; a loaded colony simply picks its work up again.
- **Pathfinding** is A* over the moves a dwarf can make (`sim/nav/`): walking, jumping,
  dropping, swimming and climbing ladders or background walls. The moves are worked out
  from the tile grid on the fly, so terrain changes never leave a stale graph. At most 4 searches run
  per tick; a dwarf whose turn doesn't come waits a tick, so a burst of orders never drops
  a frame. Paths are cached, and a terrain change forgets only the paths through its
  chunk. Two flood fills from the Hearth (`HomeMaps`) tell which cells a dwarf can reach
  and come back from, which is how dwarves avoid work that would strand them.
- **Jobs** live on a board (`sim/jobs/JobBoard.ts`): most urgent first, then nearest, then
  oldest. Claiming a job reserves it, so two dwarves never take the same one, and sets
  aside what it needs: its materials in storage and, for a craft, a station. Whenever a
  job is given back or cancelled, those are freed again, and anything the dwarf was
  already carrying goes back to storage before it takes on new work, so materials are
  never lost. Work done is kept on the job, so an interrupted dig or craft isn't lost.
- **Storage** (`sim/items/Items.ts`) is one pool of goods with several access points (the
  Hearth and every chest); a dwarf heads for whichever is nearest, found by one A* search
  with several goal areas. Reserved goods stay in storage until fetched, and `available`
  is what's left for new jobs. Every few ticks the waiting build and craft jobs are handed
  the available materials, most urgent first, and the rest are flagged as missing them.
- **The player only gives orders.** Tools call `Simulation.designate`, `designateBuild`,
  `designateWall`, `designateFurniture`, `designateDismantle`, `queueCraft`,
  `cancelDesignations` and `prioritize`, which only add, remove or change jobs and
  orders. The world changes only through the dwarves' work (and, in Milestone 7, spells).
- **Furniture** (`sim/furniture/`) stands in front of the tile grid, covering a few cells
  from its bottom-left corner; a grid of piece ids answers "what's here?" in one lookup.
  It isn't solid, so it never changes how dwarves move. Blocks a piece stands on can't be
  dug out until it's taken apart.
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
- **Items** are in `src/data/items.json`, **furniture** in `src/data/furniture.json`,
  **recipes** in `src/data/recipes.json`, **dwarves** (names, looks, speeds, skills,
  needs, fighting) in `src/data/dwarves.json`, **day and night** in `src/data/time.json`,
  **creatures** in `src/data/creatures.json` and **threats** (night spawns, invasions,
  animals) in `src/data/threats.json`, all described below. **The tech tree, creatures and spells**
  get their JSON files in Milestones 6 and 7, documented here as they arrive.

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
| `door` | Dwarves walk through it, but it stops light, and monsters (they must break it down). |
| `transparent` | A solid block that lets light through (glass). |
| `light` | Light it gives off, 0 to 15 (15 is daylight). Liquids can glow too (lava is 12). |
| `hp` | Durability: the damage monsters must do to break it. Sand 80, dirt 100, wooden door 200, plank 250, stone 300, brick 500. Without it: hardness × `tileHpPerHardness` from threats.json. |
| `harvest` | Optional. A plant the dwarves can pick: `{ "item": "berries", "count": 3, "becomes": "berry_bush_bare", "regrowDays": 2 }`. `becomes` is the tile left behind (nothing if left out), which turns back into this one `regrowDays` days later (never if left out). |
| `connect` | What the tile visually joins with: `solid` (default for solid tiles), `self` or `none`. |
| `mapColor` | Colour on the minimap. |
| `art` | How the placeholder art is painted (below). |

`art.style` picks a painter: `soil` (speckled earth), `rock` (cobbled stone), `ore` (rock
with nuggets, needs `ore` colours), `crystal` (rock with shards), `ice`, `log` (tree
trunk), `leaves`, `planks`, `bricks`, `glass`, or `sprite` (a small picture drawn from
`rows` of palette characters, as in the `tall_grass`, `ladder` and `wooden_door` entries). `base`, `dark` and `light` are the main colours.
A `cap` (grass, snow) is drawn along a block's top edge only when nothing sits on it.
Edges, outlines and rounded corners are worked out automatically from the neighbours.

Walls use the same art fields, plus `material`: the item a dwarf uses up to build that
wall (walls without one can't be built). Liquids have `base`, `light`, `dark` and `alpha`.
A block that can be built (an item's `builds.tile`) must drop that same item when dug, so
nothing is ever lost; the game checks this at start-up.

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
| `id` | snake_case, unique. Tiles' `drops`, walls' `material` and recipes refer to items by this id. |
| `name`, `description` | Shown in the HUD. |
| `category` | `block`, `material`, `ore`, `tool`, `weapon`, `armor`, `food`, `seed`, `potion` or `furniture`. |
| `stack` | Most of the item in one pile on the ground or in a dwarf's arms, and in one storage slot (default 50). |
| `icon` | The placeholder icon: a `style` (`lump`, `pile`, `ore`, `log`, `plank`, `bar`, `pickaxe`, `chest`, `torch`... see `ICON_STYLES` in `sim/items/ItemRegistry.ts`) with `base`, `dark` and `light` colours and an optional `accent`. |
| `builds` | Optional. What building with it puts in the world: `{ "tile": "plank" }` (the Build tool's palette) or `{ "furniture": "chest" }` (the Furniture tool's). Items that are a wall's `material` appear in the Walls palette. |
| `equip` | Optional. Gear: `slot` (`head`, `body`, `weapon`, `tool` or `accessory`), `tier` (dwarves swap up to higher tiers by themselves), and `digSpeed` (tools), `armor`, or for weapons `damage`, `attackTicks` (ticks between blows) and, for ranged weapons, `range` and `projectile` (`bolt`). |
| `food` | Optional. `{ "hunger": 45, "heal": 12 }`: how much hunger eating one restores (a full dwarf is at 100), and how much health it mends. Dwarves eat the most filling food first. |
| `revive` | Optional. `{ "health": 0.5 }`: poured on a fallen dwarf, it brings them back with this fraction of their health (the rekindling draught). |

Every tile's `drops` must name an item here; the game checks this at start-up. So a new
ore takes three entries: the tile, its ore rule in worldgen.json, and the item it drops.

### Furniture: `src/data/furniture.json`

```json
{
  "id": "workbench",
  "name": "Workbench",
  "size": [2, 1],
  "station": "workbench",
  "mapColor": "#a87a4b",
  "art": { "style": "workbench", "base": "#a87a4b", "dark": "#6b4628", "light": "#c69866", "accent": "#9aa1ab" }
}
```

| Field | Meaning |
| --- | --- |
| `size` | Width and height in cells; it stands on its bottom-left cell. |
| `mount` | `floor` (default: solid ground under its whole width) or `wall` (a background wall behind it, or a block beside it). |
| `storage` | Stacks of goods it adds to the colony's storage (chests). |
| `station` | The crafting station it provides, named by recipes (`workbench`, `furnace`, `anvil`, `loom`, `kitchen`...). |
| `light` | Light it gives off, 0 to 15. |
| `use` | `bed` (a dwarf sleeps in it) or `table` (dwarves eat at it). |
| `trap` | `{ "damage": 14, "cooldownTicks": 30 }`: it stabs any creature standing on it, then needs that long to reset. |
| `turret` | `{ "range": 8, "damage": 9, "cooldownTicks": 40 }`: it shoots bolts at the nearest monster in range it has a clear shot at. |
| `wins` | `true` for the World Gate: building it wins the world. |
| `art` | Placeholder sprite: a `style` (see `FURNITURE_STYLES` in `sim/furniture/FurnitureRegistry.ts`) and colours. |

Each piece of furniture is built from exactly one item whose `builds` names it, and that
item is what comes back when the piece is taken apart.

### Recipes: `src/data/recipes.json`

```json
{
  "id": "iron_bar",
  "output": { "item": "iron_bar", "count": 1 },
  "inputs": [{ "item": "iron_ore", "count": 2 }],
  "station": "furnace",
  "time": 120
}
```

`station` is `none` for recipes made by hand (at the Hearth or a chest), or a station some
furniture provides. `time` is in ticks (20 per second) for a beginner; crafting skill
makes it quicker. Items and stations are checked at start-up. Every recipe must also be
in one tier of the tech tree.

### The tech tree: `src/data/tech.json`

```json
{
  "id": "smithy",
  "name": "Smithy",
  "description": "An anvil: copper tools and arms, iron smelting, the first traps.",
  "research": 120,
  "newItemResearch": 20,
  "dwarves": 2,
  "recipes": ["anvil", "copper_pickaxe", "copper_sword", "iron_bar"]
}
```

`tiers` lists the tiers in order; the colony starts with the first. `recipes` are the
recipes a tier unlocks (every recipe in exactly one tier). Making an item from one of a
tier's recipes for the first time earns `newItemResearch`; `research` is what fills the
tier and unlocks the next (the last tier has nothing after it). `dwarves` is how many new
dwarves come when the tier is reached. A unit test checks that every tier can be made
from what earlier tiers unlock, that there is enough research to fill each tier, and that
the tiers' dwarves bring the colony to `maxDwarves`.

### Crops: `src/data/crops.json`

```json
{
  "soil": ["dirt", "grass", "clay"],
  "farmland": "farmland",
  "tillTicks": 50,
  "plantTicks": 24,
  "crops": [
    {
      "id": "wheat",
      "name": "Wheat",
      "seed": "wheat_seeds",
      "growDays": 3,
      "minLight": 7,
      "stages": ["wheat_sprout", "wheat_young", "wheat_ripe"],
      "harvest": [{ "item": "wheat", "count": 3 }, { "item": "wheat_seeds", "count": 2 }]
    }
  ]
}
```

`soil` lists the blocks the Farm tool can plant over; tilling turns them into the
`farmland` block. A crop grows from its `seed` item while its cell has at least `minLight`
light (0 to 15: full sun is 15, a torch 12), and ripens after `growDays` days' worth of
daylight. `stages` are its tiles from sprout to ripe (neither solid nor replaceable); a
ripe crop gives `harvest`. `tillTicks` and `plantTicks` are a beginner's work time.

### Dwarves: `src/data/dwarves.json`

How many dwarves the colony starts with (`startingDwarves`) and can grow to
(`maxDwarves`), the name parts and colours new dwarves are made from, and the numbers that
set the pace of the game: `movement` (ticks per step for each kind of move, the safe drop
and fall damage), `vision` (how near a dwarf must be to uncover a cell), `storage` (stack
slots the Hearth holds), `work` (ticks to dig a block of hardness 1, to fell a tree, to
pick up and put down, to build a block, a wall or furniture, to take furniture apart, and
how many leaf tiles give one fibre, and to pick a plant), `skills` (the experience each
level needs, how much faster each level works, and the experience for digging, felling,
building, picking and each second of crafting), `startingItems` (what's in storage when a
colony starts) and `needs`. There are 20 ticks per second at normal speed.

`needs` sets how hunger and sleep work. Hunger and energy run from 0 to 100, and the
rates are per in-game day:

| Field | Meaning |
| --- | --- |
| `hungerPerDay` | Hunger lost over a whole day and night. |
| `eatBelow`, `hungryBelow` | A dwarf goes to eat below the first; below the second it's hungry (slower, and it gets up from sleep to eat). |
| `starvingDamagePerDay` | Health lost per day at zero hunger. |
| `energyPerDay` | Energy lost over the daylight hours. |
| `sleepAtNightBelow`, `sleepBelow` | At night a dwarf goes to bed below the first; at any time below the second. |
| `tiredBelow` | Below this a dwarf is tired, and works slower. |
| `sleepPerNight`, `healPerNight` | Energy and health a whole night in bed gives back. |
| `floorSleep`, `roomSleepBonus` | How fast sleep works on the floor, and in a bed in a room with a light, compared with a bed. |
| `slowWork` | How fast a hungry or tired dwarf works (0.7 is 70%). |
| `eatTicks` | How long a meal takes, in ticks. |
| `tableBonus`, `roomTableBonus`, `tableReach` | How much further a meal at a table goes, at a table in a room, and how near (in tiles) a table must be. |

`combat` sets how dwarves fight: `bareHandsDamage` and `attackTicks` (fists, and weapons
that don't set their own pace), `engageRange` (tiles), `engageAbove` and `retreatBelow`
(fractions of health: a dwarf only starts a fight above the first, and breaks off below
the second), `restHealPerDay` (mending by the Hearth), `damagePerLevel` (combat skill),
`xpPerHit` and `reviveTicks`.

### Creatures: `src/data/creatures.json`

```json
{
  "id": "gloomling",
  "name": "Gloomling",
  "hostile": true,
  "attack": "melee",
  "health": 26,
  "damage": 6,
  "attackTicks": 24,
  "sight": 14,
  "movement": { "walkTicks": 7, "jump": 1, "safeDrop": 6, "climbs": "ladders" },
  "breaks": "built",
  "breakDamage": 4,
  "drops": [{ "item": "dusk_essence", "count": 1, "chance": 0.3 }],
  "xp": 12,
  "spawn": { "night": 10, "wave": 10, "fromDay": 1 },
  "mapColor": "#b48cff",
  "art": { "style": "gloomling", "base": "#4b4168", "dark": "#2a2340", "light": "#6e6394", "accent": "#ffd34d" }
}
```

| Field | Meaning |
| --- | --- |
| `hostile` | Monsters hunt dwarves; animals graze and can be hunted. |
| `attack` | `melee` (it must stand next to its prey), `ranged` (it shoots its `projectile` from up to `range` tiles, if it can see its prey) or `none`. |
| `health`, `armor`, `damage`, `attackTicks` | Hit points, armour (as a dwarf's), damage per blow and ticks between blows. Monsters get tougher every day (threats.json `scaling`). |
| `sight` | Monsters notice dwarves within this many tiles (invaders always know where the colony is). |
| `movement` | `walkTicks` per tile (dwarves take 5), `jump` (tiles up onto a ledge), `safeDrop` (the longest drop it takes) and `climbs`: `none`, `ladders`, or `walls` (ladders, background walls and the sides of blocks). |
| `breaks` | What it smashes through: `none`, `doors`, `built` (doors and blocks dwarves built) or `soft` (also natural blocks up to `digHardness`: it tunnels). `breakDamage` per blow, every `breakTicks` (default `attackTicks`), against the block's `hp` in tiles.json; several monsters on one block add up. |
| `drops` | Items left where it dies, each with a `chance` (default 1). |
| `xp` | Combat experience for the dwarf that kills it. |
| `spawn` | Weights for night spawns and invasions (`night`, `wave`), the first day it appears (`fromDay`), and for animals, how common it is in each biome (`"animal": { "temperate": 6, "snow": 1 }`). |
| `art` | A placeholder sprite `style` (see `CREATURE_STYLES` in `sim/creatures/CreatureRegistry.ts`) in these colours. |

### Threats: `src/data/threats.json`

- `night`: monsters appear between `minDistance` and `maxDistance` tiles (across) from the
  Hearth, within `rows` above and below it, never closer than `dwarfDistance` to a dwarf,
  only in cells at most `maxLight` bright, and never in a room. A night brings
  `base + perDay * (day - 1)` of them (at most `max`, and `maxAlive` at once), spread over
  the first `spreadOver` of the night.
- `dawn`: night monsters in at least `leaveLight` light leave, one by one over
  `leaveSeconds`.
- `animals`: at most `max` on the hills (`start` when the world begins), a new one every
  `checkSeconds` by day, between `minDistance` and `maxDistance` from the Hearth.
- `waves`: an invasion every `every` nights, announced `warningSeconds` before dusk;
  `base + perDay * day + perTier * tier` invaders (at most `max`), one every
  `spawnSeconds`, through a portal `portalDistance` tiles from the Hearth. The tier is the
  tech tier the colony has reached (0 for the first).
- `scaling`: health and damage grow by these fractions per day, up to `maxFactor`.
- `projectiles`: missile speeds in tiles per tick; `tileHpPerHardness` (the durability of a
  block without an `hp` of its own: hardness times this); `armorScale` (the `s` in the
  armour formula).

### Day and night: `src/data/time.json`

| Field | Meaning |
| --- | --- |
| `dayMinutes`, `nightMinutes` | Real minutes of daylight and of night at normal speed. |
| `transitionSeconds` | How long the light takes to fade at dusk, and to come back at dawn. |
| `nightLight` | How bright the sun is at night, as a fraction of daylight (moonlight). |
| `dayStartHour`, `nightStartHour` | The hours the clock shows at dawn and at nightfall. |
| `startHour` | The hour a new world starts at. |

### Replacing placeholder art and sound

Every texture and sound is listed in one manifest, `src/render/assets/manifest.ts`, and
game code only refers to manifest keys. To use a real sprite instead of a generated one,
put the PNG under `src/assets/`, import it in the manifest, and change that entry from
`kind: 'generated'` to `kind: 'image'` with the same frame size and frame order. Sounds
work the same way (`kind: 'file'`). The manifest's header comment has a worked example.

## Testing

- `npm test` runs the unit tests in `src/**/*.test.ts`, among them save and load round
  trips (a busy colony saved, loaded and compared, saves surviving reordered content
  files, refused newer or damaged saves) and the tech tree's consistency.
- `npm run smoke` drives the game in headless Chromium twice, once on the production build
  and once on the dev server (`npm run dev`): creating worlds in both biomes, checking the
  picture and that the sunlit surface is visible, marking blocks and a tree and watching
  the dwarves dig, fell and haul, crafting planks and a chest from the felled tree and
  setting the chest down (storage grows), building a block and a wall, the dwarf panel,
  a world started at night (dark sky, the Hearth's light, the clock's moon), dwarves
  fighting off a monster and an invasion portal opening, the tech tree, a farm tilled,
  sown, ripened and harvested, new dwarves arriving, and the World Gate won with three
  dwarves stepping through into a snowy world (dev server, through `window.debug`), the
  locked snowy biome, saving from the menu and Continue after a page reload,
  zooming and panning, the minimap, the simulation ticking at the right rate, pause, menu,
  settings, right-click and mouse-wheel blocking, and high-DPI canvas sizing. Any console error fails the test. Screenshots and
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
  borders, each dwarf's remaining path (cyan), the job it has reserved (gold) and every
  room (each tinted its own colour), and the "Show light levels" box swaps the fog of war
  for the light map. It also counts the rooms, creatures and missiles, shows how strong
  the daylight is, how many monsters have come out tonight, and the day of the next
  invasion.
- In dev builds (`npm run dev`), the browser console has `window.debug`:
  `debug.setSpeed(5)` runs the simulation 5x faster on top of the chosen speed,
  `debug.revealMap()` lifts the fog of war, `debug.spawnItem('stone', 20)` drops items
  beside the Hearth for the dwarves to store, `debug.give('plank', 20)` puts items straight
  into storage, and `debug.stockUp()` stocks a bit of every raw material plus one of each
  crafting station (and a few swords, traps, a bolt thrower and a rekindling draught), for
  trying things out quickly. `debug.skipToNight()` brings nightfall forward to now,
  `debug.spawnCreature('gloomling', 10)` puts a creature on the ground 10 tiles right of
  the Hearth (negative: left), `debug.startWave()` brings an invasion on tonight (the
  warning now, the portal at dusk) and `debug.killMonsters()` clears them all away.
  `debug.techTier(3)` jumps to tier 3 of the tech tree (its new dwarves come too),
  `debug.ripenCrops()` ripens every growing crop, `debug.placeGate()` stands a World Gate
  beside the Hearth (the world is won) and `debug.save()` saves. To start a world at
  night, add `?hour=22` to the address.

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
| 3 | Items, storage, crafting stations, building blocks, walls, ladders, doors | Done |
| 4 | Hunger and sleep, day/night, lighting overlay, room detection | Done |
| 5 | Monsters, combat, invasion waves, defences | Done |
| 6 | Tech tree, farming and cooking, new dwarves, the World Gate, basic save/load | Done |
| 7 | Magic (including spells that reshape the world: the only way the player changes it directly), full save system (slots, export/import), UI polish, balance | Next |
| 8 | Release: bundle optimisation, cross-browser testing, publishing guides | |

## Tech

TypeScript (strict), Vite 8, Phaser 4, Preact, Vitest, Playwright. Requires WebGL.
