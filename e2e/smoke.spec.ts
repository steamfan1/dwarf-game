/**
 * Smoke tests: boot the game in a real browser and check what a player would notice
 * first. Any console error or uncaught exception fails the test (see fixtures.ts).
 */
import { createWorld, expect, readNumber, test } from './fixtures';
import { decodePng, pixelAt } from './png';

test('a new world: dwarves dig and fell what the player marks; camera, minimap, pause and menus', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#game canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('1-title.png') });

  await createWorld(page, { seed: 'smoke-test' });
  await expect(page.getByTestId('minimap')).toBeVisible();
  // Three dwarves start beside the Hearth.
  await expect(page.getByTestId('roster-dwarf')).toHaveCount(3);
  await page.waitForTimeout(800);
  const world = decodePng(await page.screenshot({ path: testInfo.outputPath('2-world.png') }));

  // The camera starts centred two tiles above the Hearth, which stands on flat ground, at
  // the default zoom (one tile is 32 CSS pixels). Check the picture itself: ground is drawn
  // on both sides of the Hearth, and sky above it. Sky is blue (much more blue than red);
  // dirt, clay, stone and grass are not.
  const viewport = page.viewportSize()!;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const tile = 32;
  const blueness = (x: number, y: number): number => {
    const [red, , blue] = pixelAt(world, x, y);
    return blue - red;
  };
  const groundY = centre.y + 6 * tile; // the middle of the third row below the surface
  for (const dx of [-6, 6]) {
    expect(blueness(centre.x + dx * tile, groundY), `ground ${dx} tiles from the Hearth`).toBeLessThan(30);
  }
  expect(blueness(centre.x, centre.y - 7 * tile), 'sky above the Hearth').toBeGreaterThan(40);

  // Light shows the whole sunlit surface, explored or not. On the minimap (one pixel per
  // tile), the first thing under the sky in every column is ground or a tree, never the
  // colour of an unexplored cell (Minimap.ts UNEXPLORED, rgb 11 12 17).
  const hiddenColumns = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="minimap"] canvas')!;
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let hidden = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const o = (y * width + x) * 4;
        const [r, g, b] = [data[o]!, data[o + 1]!, data[o + 2]!];
        if (b > 150 && b - r > 30) continue; // sky (or a pool of water)
        if (Math.abs(r - 11) <= 2 && Math.abs(g - 12) <= 2 && Math.abs(b - 17) <= 2) hidden++;
        break;
      }
    }
    return hidden;
  });
  expect(hiddenColumns, 'columns whose surface is still hidden in the dark').toBe(0);

  // The debug overlay (backtick) shows the simulation tick, which advances 20 times a
  // second at 1x as long as frames come at least 4 times a second (longer frames are
  // clamped). CI draws in software at about 15 frames a second, which is enough. The
  // overlay refreshes a few times a second, hence the wide margin.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await expect.poll(() => readNumber(page, 'debug-ticks')).toBeGreaterThan(0);
  const start = await readNumber(page, 'debug-ticks');
  await page.waitForTimeout(1500);
  const ticked = (await readNumber(page, 'debug-ticks')) - start;
  testInfo.annotations.push({ type: 'ticks in 1.5 s', description: String(ticked) });
  expect(ticked, 'ticks in 1.5 s at 1x (about 30)').toBeGreaterThan(15);
  expect(ticked, 'ticks in 1.5 s at 1x (about 30)').toBeLessThan(45);

  // The mouse hasn't moved since it clicked "Create world", so the camera must stay put:
  // it should not mistake an unknown mouse position for one at a screen edge.
  const settled = await page.getByTestId('debug-camera').textContent();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('debug-camera')).toHaveText(settled ?? '');

  // Only dwarves change the world: a click with the Select tool (Q) marks nothing.
  const readout = page.getByTestId('hover-title');
  const jobs = page.getByTestId('debug-jobs');
  const surfaceY = centre.y + 3 * tile; // the row of ground the Hearth stands on
  await expect(page.getByTestId('tool-auto')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyQ');
  await page.mouse.move(centre.x + 3 * tile, surfaceY);
  await expect(readout).toHaveText('Grassy dirt');
  await page.mouse.down();
  await page.mouse.up();
  await expect(readout).toHaveText('Grassy dirt');
  await expect(jobs).toContainText(/^0 dig/);

  // The Auto tool (E, and the tool a world starts with) marks a block with a click and
  // takes the mark away with a second click.
  await page.keyboard.press('KeyE');
  await page.mouse.down();
  await page.mouse.up();
  await expect(jobs).toContainText(/^1 dig/);
  await page.mouse.down();
  await page.mouse.up();
  await expect(jobs).toContainText(/^0 dig/);

  // With the Dig tool (F), dragging along the ground marks three blocks right of the Hearth.
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('tool-dig')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.down();
  await page.mouse.move(centre.x + 5 * tile, surfaceY, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('hover-readout')).toContainText(/Marked for digging|on the way|is on it/);
  await expect(jobs).toContainText(/^[1-3] dig/);
  await page.screenshot({ path: testInfo.outputPath('3-marked.png') });
  // The readout in the top-left corner, at its widest here, never covers the top bar.
  const readoutBox = (await page.getByTestId('hover-readout').boundingBox())!;
  const topBarBox = (await page.getByTestId('top-bar').boundingBox())!;
  expect(readoutBox.x + readoutBox.width, 'right edge of the hover readout').toBeLessThan(topBarBox.x);

  // At triple speed the dwarves dig all three, then carry the dirt to the Hearth.
  await page.keyboard.press('Digit3');
  await expect(jobs).toContainText(/^0 dig/, { timeout: 30_000 });
  await expect(page.getByTestId('stored-dirt')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('4-dug.png') });

  // The Fell trees tool (C) marks the whole tree when any part of it is clicked; the
  // dwarves cut it down and store the wood. The nearest tree stands six columns right.
  await page.keyboard.press('KeyC');
  await page.mouse.move(centre.x + 6 * tile, centre.y);
  await expect(readout).toHaveText('Oak trunk');
  await page.mouse.down();
  await page.mouse.up();
  await expect(jobs).toContainText(/ 1 fell/);
  await expect(jobs).toContainText(/ 0 fell/, { timeout: 30_000 });
  await expect(page.getByTestId('stored-log')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('5-felled.png') });

  // Esc puts the tool down (back to Auto). Picking a dwarf in the roster opens its
  // details; Esc closes them, rather than opening the menu.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-auto')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('roster-dwarf').first().click();
  await expect(page.getByTestId('dwarf-details')).toBeVisible();
  await expect(page.getByTestId('dwarf-details')).toContainText('Mining');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dwarf-details')).toBeHidden();
  await expect(page.getByTestId('game-menu')).toBeHidden();

  // Zoom with the + key and the mouse wheel (over the world, not the roster); pan with D.
  await page.mouse.move(centre.x, centre.y);
  await expect(page.getByTestId('debug-zoom')).toHaveText('2×');
  await page.keyboard.press('Equal');
  await expect(page.getByTestId('debug-zoom')).toHaveText('3×');
  await page.mouse.wheel(0, 300);
  await expect(page.getByTestId('debug-zoom')).toHaveText('2×');
  const cameraX = await readNumber(page, 'debug-camera', 0);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await expect.poll(() => readNumber(page, 'debug-camera', 0)).toBeGreaterThan(cameraX + 2);

  // Resting the mouse at the left edge of the screen pans left; moving it away stops.
  const beforeEdge = await readNumber(page, 'debug-camera', 0);
  await page.mouse.move(2, viewport.height / 2);
  await expect.poll(() => readNumber(page, 'debug-camera', 0)).toBeLessThan(beforeEdge - 2);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect
    .poll(async () => {
      const before = await page.getByTestId('debug-camera').textContent();
      await page.waitForTimeout(500);
      return (await page.getByTestId('debug-camera').textContent()) === before;
    }, { message: 'the camera stops once the mouse leaves the edge' })
    .toBe(true);

  // Space pauses: the tick counter stops.
  await page.keyboard.press('Space');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  const pausedAt = await readNumber(page, 'debug-ticks');
  await page.waitForTimeout(800);
  expect(await readNumber(page, 'debug-ticks')).toBe(pausedAt);

  // Key 2 resumes at double speed.
  await page.keyboard.press('Digit2');
  await expect(page.getByTestId('debug-speed')).toHaveText('2×');

  // Esc opens the in-game menu, which names the world; Settings opens from there.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await expect(page.getByTestId('world-info')).toContainText('smoke-test');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(page.getByTestId('game-menu')).toBeVisible();

  // Quit to title.
  await page.getByRole('button', { name: 'Quit to title' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('crafting and building: planks and a chest from a felled tree, then the Furniture, Build and Walls tools', async ({ page, browserErrors }, testInfo) => {
  test.setTimeout(150_000);
  await page.goto('./');
  await createWorld(page, { seed: 'smoke-test' });
  const viewport = page.viewportSize()!;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const tile = 32;
  const surfaceY = centre.y + 3 * tile; // the ground the Hearth stands on
  const openY = centre.y + 2 * tile; // the open row the Hearth stands in
  const readout = page.getByTestId('hover-readout');
  await page.keyboard.press('Backquote'); // the debug overlay counts the jobs
  const jobs = page.getByTestId('debug-jobs');
  await expect(jobs).toContainText(/^0 dig/);
  await page.keyboard.press('Digit3');

  // Materials: fell the tree six columns right (logs and fibre), and dig two blocks of ground.
  await page.keyboard.press('KeyC');
  await page.mouse.move(centre.x + 6 * tile, centre.y);
  await expect(page.getByTestId('hover-title')).toHaveText('Oak trunk');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press('KeyF');
  await page.mouse.move(centre.x + 3 * tile, surfaceY);
  await page.mouse.down();
  await page.mouse.move(centre.x + 4 * tile, surfaceY, { steps: 3 });
  await page.mouse.up();
  await expect(jobs).toContainText(/^0 dig · 0 fell/, { timeout: 40_000 });
  await expect(page.getByTestId('stored-log')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('stored-dirt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('stored-fiber')).toBeVisible({ timeout: 30_000 });

  // Crafting (K): two crafts of planks by hand (a log makes two), then a chest from four planks.
  // Paused while queuing, so the first plank can't be finished before the second click
  // adds to its order.
  const pause = page.getByTitle(/^Pause or resume/);
  await page.keyboard.press('KeyK');
  await expect(page.getByTestId('crafting-panel')).toBeVisible();
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('queue-planks-1').click();
  await page.getByTestId('queue-planks-1').click();
  await expect(page.getByTestId('craft-order')).toHaveCount(1);
  await expect(page.getByTestId('craft-order')).toContainText('of 2');
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('m3-1-crafting.png') });
  await expect(page.getByTestId('craft-order')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('stored-plank')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('queue-chest-1').click();
  await expect(page.getByTestId('stored-chest')).toBeVisible({ timeout: 40_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crafting-panel')).toBeHidden();

  /** Move along the open row left of the Hearth until the hover readout offers `hint`; click there. */
  const placeLeftOfHearth = async (hint: RegExp, from: number): Promise<number> => {
    for (let dx = from; dx >= from - 6; dx--) {
      await page.mouse.move(centre.x + dx * tile, openY);
      await page.waitForTimeout(300);
      if (hint.test((await readout.textContent()) ?? '')) {
        await page.mouse.down();
        await page.mouse.up();
        return dx;
      }
    }
    throw new Error(`Nowhere left of the Hearth offered "${hint.source}"`);
  };

  // Furniture (T): set the chest down left of the Hearth. Storage gets room for 16 more stacks.
  await expect(page.getByTestId('storage-used')).toContainText('/ 24 stacks');
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.getByTestId('palette-chest').click();
  const chestAt = await placeLeftOfHearth(/Click to set it down here/, -2);
  await expect(jobs).toContainText(/ 1 build/);
  await page.screenshot({ path: testInfo.outputPath('m3-2-chest-planned.png') });
  await expect(jobs).toContainText(/ 0 build/, { timeout: 40_000 });
  await expect(page.getByTestId('storage-used')).toContainText('/ 40 stacks');
  // (A dwarf passing in front of it would be named instead, so allow a moment.)
  await page.mouse.move(centre.x + chestAt * tile, openY);
  await expect(page.getByTestId('hover-title')).toHaveText('Chest', { timeout: 15_000 });

  // Build (B): a dirt block on the ground, further left.
  await page.keyboard.press('KeyB');
  await page.getByTestId('palette-dirt').click();
  const blockAt = await placeLeftOfHearth(/Click or drag to build here/, chestAt - 2);
  await expect(jobs).toContainText(/ 1 build/);
  await expect(jobs).toContainText(/ 0 build/, { timeout: 40_000 });
  await page.mouse.move(centre.x + blockAt * tile, openY);
  await expect(page.getByTestId('hover-title')).toHaveText('Dirt');

  // Walls (V): a dirt wall on top of that block, held up by it.
  await page.keyboard.press('KeyV');
  await page.getByTestId('palette-dirt').click();
  await page.mouse.move(centre.x + blockAt * tile, openY - tile);
  await expect(readout).toContainText('Click or drag to put up a wall here');
  await page.mouse.down();
  await page.mouse.up();
  await expect(jobs).toContainText(/ 1 build/);
  await expect(jobs).toContainText(/ 0 build/, { timeout: 40_000 });
  await expect(page.getByTestId('hover-title')).toHaveText('Dirt wall', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.mouse.move(centre.x, centre.y - 4 * tile);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('m3-3-built.png') });

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('night: a world started at 22:00 is dark but for the Hearth, and the clock shows the moon', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./?hour=22');
  await createWorld(page, { seed: 'smoke-test' });
  const clock = page.getByTestId('clock');
  await expect(clock).toContainText('Day 1');
  await expect(clock).toContainText(/22:\d0/);
  await expect(clock).toHaveClass(/night/);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-daylight')).toHaveText(/^2\d%$/);
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(800);
  const shot = decodePng(await page.screenshot({ path: testInfo.outputPath('night.png') }));

  // The camera starts centred two tiles above the Hearth (one tile is 32 CSS pixels).
  const viewport = page.viewportSize()!;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const tile = 32;
  const brightness = (x: number, y: number): number => {
    const [red, green, blue] = pixelAt(shot, x, y);
    return red + green + blue;
  };
  // Only moonlight reaches the open sky far from the colony; the Hearth's fire lights the
  // air just above it. The darkest of a few points well away from the Hearth (in case a
  // treetop is in the way of one): the daytime sky there is far brighter (over 400).
  const farSky = Math.min(
    ...[-9, -4.5, 8].map((dx) => brightness(centre.x + dx * tile, centre.y - 7.5 * tile)),
  );
  const nearHearth = brightness(centre.x, centre.y - tile);
  testInfo.annotations.push({ type: 'brightness', description: `far sky ${farSky}, above the Hearth ${nearHearth}` });
  expect(farSky, 'the night sky far from the Hearth').toBeLessThan(160);
  expect(nearHearth, 'the sky lit by the Hearth').toBeGreaterThan(farSky + 60);

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('night, dev build: tired dwarves lie down by the Hearth and sleep', async ({ page, browserErrors }, testInfo) => {
  test.skip(testInfo.project.name !== 'dev', 'window.debug exists only in dev builds');
  await page.goto('./?hour=22');
  await createWorld(page, { seed: 'smoke-test' });
  // Wear the dwarves out (through the dev build's window.debug), rather than waiting; and
  // send off the night's first monster, so nothing wakes them (the next comes a minute later).
  await page.evaluate(() => {
    const debug = (window as unknown as { debug: { killMonsters(): void; app: { session: { sim: { dwarves: Array<{ energy: number }> } } } } }).debug;
    for (const dwarf of debug.app.session.sim.dwarves) dwarf.energy = 40;
    debug.killMonsters();
  });
  // No beds yet, so all three sleep on the floor by the Hearth.
  await expect(page.getByTestId('roster-dwarf')).toHaveText([/Asleep on the floor/, /Asleep on the floor/, /Asleep on the floor/], {
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('night-asleep.png') });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

/** The dev build's window.debug, as far as these tests use it. */
interface DevDebug {
  spawnCreature(id: string, dx?: number): void;
  startWave(): void;
  app: {
    centerCameraOn(x: number, y: number): void;
    session: { sim: { portal: { x: number; y: number } | null } };
  };
}

test('monsters, dev build: dwarves fight off a gloomling, and an invasion portal opens at dusk', async ({ page, browserErrors }, testInfo) => {
  test.skip(testInfo.project.name !== 'dev', 'window.debug exists only in dev builds');
  test.setTimeout(90_000);
  await page.goto('./');
  await createWorld(page, { seed: 'smoke-test' });
  await page.keyboard.press('Backquote'); // the debug overlay counts the creatures
  await page.evaluate(() => (window as unknown as { debug: DevDebug }).debug.spawnCreature('gloomling', 7));
  await expect(page.getByTestId('debug-creatures')).toContainText(/^1 hostile/);
  await expect(page.getByTestId('roster-dwarf').filter({ hasText: 'Fighting a Gloomling' }).first()).toBeVisible({ timeout: 15_000 });
  // The fight is east of the Hearth, where the overlay would hide it.
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('m5-1-fight.png') });
  await page.keyboard.press('Backquote');
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('debug-creatures')).toContainText(/^0 hostile/, { timeout: 30_000 });

  // An invasion tonight: a warning with a countdown in the top bar, then the portal opens at dusk.
  await page.keyboard.press('Backquote');
  await page.evaluate(() => (window as unknown as { debug: DevDebug }).debug.startWave());
  await expect(page.getByTestId('threat')).toContainText(/Invasion in \d:\d\d/);
  await page.screenshot({ path: testInfo.outputPath('m5-2-warning.png') });
  await expect(page.getByTestId('threat')).toContainText(/Invaders: \d+/, { timeout: 30_000 });
  await page.keyboard.press('Digit1');
  await page.evaluate(() => {
    const debug = (window as unknown as { debug: DevDebug }).debug;
    const portal = debug.app.session.sim.portal;
    if (portal) debug.app.centerCameraOn(portal.x, portal.y - 2);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('m5-3-portal.png') });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('a snowy world can be chosen in the New world dialog', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./');
  await createWorld(page, { seed: 'frost-hollow', biome: 'snow' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('snow-world.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('world-info')).toContainText('Frozen north');
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('?reveal=1 lifts the fog of war over the whole map', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./?seed=smoke-test&reveal=1');
  await createWorld(page, { seed: 'smoke-test' });
  // Zoomed all the way out, most of the map is in view.
  await page.mouse.move(640, 360);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Minus');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('revealed.png') });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('right-click and the mouse wheel are kept away from the browser', async ({ page, browserErrors }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible({ timeout: 30_000 });

  const defaultPrevented = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas')!;
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    canvas.dispatchEvent(contextMenu);
    canvas.dispatchEvent(wheel);
    return { contextMenu: contextMenu.defaultPrevented, wheel: wheel.defaultPrevented };
  });
  expect(defaultPrevented).toEqual({ contextMenu: true, wheel: true });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test.describe('on a high-DPI screen', () => {
  test.use({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });

  test('the canvas renders at full resolution and follows window resizes', async ({ page, browserErrors }, testInfo) => {
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible({ timeout: 30_000 });

    const canvasSize = () =>
      page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => ({
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
      }));

    await expect.poll(canvasSize).toEqual({ width: 1600, height: 1000, cssWidth: 800, cssHeight: 500 });
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect.poll(canvasSize).toEqual({ width: 2000, height: 1200, cssWidth: 1000, cssHeight: 600 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('4-title-hidpi.png') });

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
