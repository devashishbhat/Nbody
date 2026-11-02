import { expect, test, type Page } from '@playwright/test';
import {
  cameraDistance,
  cameraMode,
  clock,
  diagnostic,
  massOf,
  ready,
  snapshot,
} from './helpers.ts';

/**
 * The interactive half of the product.
 *
 * Loading a preset and watching it is only half of what this is for. The other
 * half is changing it, and every gesture below is one a visitor will try in
 * the first minute.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test('selects a body by clicking it', async ({ page }) => {
  await ready(page);
  // The Sun is the heaviest body and sits near the centre of the view.
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Selecting switches the inspector from system settings to the body.
  await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');
  await expect(page.locator('.nb-name')).toHaveValue(/\w+/);
});

test('changes a mass and the simulation responds', async ({ page }) => {
  await ready(page);
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');

  expect(massOf(await snapshot(page), 'Sun')).toBeCloseTo(1, 6);

  // The exact field, so the assertion is about a precise value rather than
  // wherever a slider happened to land.
  const field = page.locator('.nb-inspector input.nb-input').nth(1);
  await field.fill('2');
  await field.blur();

  await page.waitForTimeout(400);
  expect(massOf(await snapshot(page), 'Sun')).toBe(2);
});

test('undoes an edit', async ({ page }) => {
  await ready(page);
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');

  const field = page.locator('.nb-inspector input.nb-input').nth(1);
  await field.fill('5');
  await field.blur();
  await page.waitForTimeout(300);
  expect(massOf(await snapshot(page), 'Sun')).toBe(5);

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  expect(massOf(await snapshot(page), 'Sun')).toBeCloseTo(1, 6);
});

test('changes a global setting live without restarting', async ({ page }) => {
  await ready(page);
  const timeBefore = await clock(page).textContent();

  await page.selectOption('.nb-inspector select >> nth=0', 'yoshida4');
  await page.waitForTimeout(500);

  const after = await snapshot(page);
  expect(after.integrator).toBe('yoshida4');
  // Still running from where it was, not restarted.
  expect(await clock(page).textContent()).not.toBe(timeBefore);
});

test('zooms with the wheel, anchored at the pointer', async ({ page }) => {
  await ready(page);
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;

  const before = await cameraDistance(page);
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);

  expect(await cameraDistance(page)).toBeLessThan(before);
});

test('slings a new body into the system with shift and drag', async ({ page }) => {
  await ready(page);
  const before = (await snapshot(page)).bodies.length;
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;

  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 420, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 340, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await page.waitForTimeout(400);
  const after = await snapshot(page);
  expect(after.bodies.length).toBe(before + 1);
  const added = after.bodies.at(-1)!;
  // It was aimed, so it is moving.
  expect(Math.hypot(...added.velocity)).toBeGreaterThan(0);
});

test('opens the command palette and loads a preset', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.nb-palette')).toBeVisible();

  await page.locator('.nb-palette-input').fill('figure');
  await page.keyboard.press('Enter');

  await expect(page.locator('.nb-palette')).toBeHidden();
  await expect(page.locator('.nb-preset-name')).toHaveText('Figure Eight');
  await page.waitForTimeout(400);
  expect((await snapshot(page)).bodies).toHaveLength(3);
});

test('builds a share link that reloads the same system', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);

  // Edit something, so the link has to carry a scenario rather than a preset id.
  const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const field = page.locator('.nb-inspector input.nb-input').nth(1);
  await field.fill('3');
  await field.blur();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator('.nb-status')).toContainText('Link copied');

  const url = page.url();
  expect(url).toContain('#s=');

  await page.goto(url);
  await page.waitForFunction(() => window.nbody !== undefined);
  await page.waitForTimeout(700);
  expect(massOf(await snapshot(page), 'Sun')).toBe(3);
});

test('keyboard shortcuts drive the simulation', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  const paused = await clock(page).textContent();
  await page.waitForTimeout(400);
  expect(await clock(page).textContent()).toBe(paused);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await clock(page).textContent()).not.toBe(paused);

  await page.keyboard.press('?');
  await expect(page.locator('.nb-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-help')).toBeHidden();
});

test('switches to the orbiting camera', async ({ page }) => {
  await ready(page);
  expect(await cameraMode(page)).toBe('2d');
  await page.keyboard.press('d');
  await page.waitForTimeout(300);
  expect(await cameraMode(page)).toBe('3d');
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 430, height: 850 } });

  test('keeps the simulation visible and opens the inspector on selection', async ({ page }) => {
    await ready(page);

    // The inspector is a sheet over the simulation here rather than a column
    // beside it, so it must not be covering half the screen before anyone has
    // asked for it.
    await expect(page.locator('.nb-inspector')).toBeHidden();
    await expect(page.locator('.nb-collapsed')).toBeVisible();

    // Selecting a body is also the request to see it.
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
    const point = await page.evaluate(() => {
      const renderer = window.nbody!.renderer;
      const position = new Float64Array(3);
      const screen = new Float64Array(2);
      renderer.positionOf(0, position);
      renderer.camera.project(position[0]!, position[1]!, position[2]!, screen);
      return { x: screen[0]!, y: screen[1]! };
    });
    await page.mouse.click(box.x + point.x, box.y + point.y);

    await expect(page.locator('.nb-inspector')).toBeVisible();
    await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');

    // And the transport is still reachable with the sheet open.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});

test.describe('editing preserves the view', () => {
  /**
   * Editing a body replaces the scenario object, which is indistinguishable
   * from loading a new one by identity alone. When the renderer could not tell
   * the difference, changing a mass snapped the camera back to the preset's
   * framing and mode and wiped every trail, which is a long way from what
   * "set the Sun's mass to 2" asks for.
   */
  async function cameraState(page: Page) {
    return page.evaluate(() => ({
      mode: window.nbody!.renderer.camera.mode,
      distance: window.nbody!.renderer.camera.distance,
    }));
  }

  test('keeps the camera when a mass changes', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('d');
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
    await page.mouse.move(box.x + 500, box.y + 400);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(700);

    const before = await cameraState(page);
    expect(before.mode).toBe('3d');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');
    const field = page.locator('.nb-inspector input.nb-input').nth(1);
    await field.fill('2');
    await field.blur();
    await page.waitForTimeout(700);

    expect(massOf(await snapshot(page), 'Sun')).toBe(2);

    const after = await cameraState(page);
    expect(after.mode).toBe('3d');
    // Allow for the easing still settling, but not for a snap back to the
    // preset's distance of 32.
    expect(after.distance).toBeCloseTo(before.distance, 1);
  });

  test('keeps the trails when a setting changes', async ({ page }) => {
    await ready(page);
    await page.waitForTimeout(1500);

    const samples = () => page.evaluate(() => window.nbody!.renderer.debugStats().trailSamples);
    const before = await samples();
    expect(before).toBeGreaterThan(0);

    await page.selectOption('.nb-inspector select >> nth=0', 'yoshida4');
    await page.waitForTimeout(300);

    // Still accumulating on the same history rather than starting over.
    expect(await samples()).toBeGreaterThanOrEqual(before);
  });

  test('does frame the camera when a scenario is loaded', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('d');
    await page.waitForTimeout(600);
    expect((await cameraState(page)).mode).toBe('3d');

    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.nb-palette-input').fill('Figure Eight');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    // The figure-eight is a flat preset, so loading it must reassert that.
    expect((await cameraState(page)).mode).toBe('2d');
  });
});

test.describe('camera controls are reachable', () => {
  test('switches the camera from the inspector', async ({ page }) => {
    await ready(page);
    expect(await cameraMode(page)).toBe('2d');

    // The orbiting camera used to be reachable only by pressing D, with no
    // control anywhere, which made it effectively invisible.
    await page.selectOption('.nb-inspector select >> nth=3', '3d');
    await page.waitForTimeout(400);

    expect(await cameraMode(page)).toBe('3d');
  });

  test('switches the camera from the command palette', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('ControlOrMeta+k');
    // Specific enough to beat the accretion preset, whose description reads
    // "planetesimals orbiting a star".
    await page.locator('.nb-palette-input').fill('orbiting camera');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    expect(await cameraMode(page)).toBe('3d');
  });
});

test.describe('moving around the view', () => {
  async function origin(page: Page) {
    return page.evaluate(() => ({
      x: window.nbody!.renderer.camera.originX,
      y: window.nbody!.renderer.camera.originY,
      distance: window.nbody!.renderer.camera.distance,
    }));
  }

  test('drags the view by exactly the distance dragged', async ({ page }) => {
    await ready(page);
    const before = await origin(page);
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;

    // Empty canvas, clear of the bodies and every panel.
    await page.mouse.move(box.x + 400, box.y + 620);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 400 + i * 15, box.y + 620);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await origin(page);
    // 150 pixels right moves the view 150 pixels' worth of world to the left.
    // The scale comes from the viewport rather than a constant, because the
    // half-height is defined against the viewport height and hardcoding it
    // here just tests the test.
    const height = page.viewportSize()!.height;
    const worldPerPixel = (2 * before.distance) / height;
    expect(before.x - after.x).toBeCloseTo(150 * worldPerPixel, 4);
  });

  test('keeps dragging when the pointer crosses a panel', async ({ page }) => {
    // The handlers live on the window rather than the canvas, so a drag that
    // wanders over the inspector or off the edge does not simply stop.
    await ready(page);
    const before = await origin(page);
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;

    await page.mouse.move(box.x + 700, box.y + 400);
    await page.mouse.down();
    // Straight into the inspector column on the right.
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 700 + i * 40, box.y + 400);
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(Math.abs((await origin(page)).x - before.x)).toBeGreaterThan(0);
  });

  test('pans on a trackpad two-finger scroll', async ({ page }) => {
    // A two-axis scroll is a trackpad, and on a trackpad this gesture means
    // move the view. Treating it as zoom is most of what made the app feel
    // undraggable on a laptop.
    await ready(page);
    const before = await origin(page);
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
    await page.mouse.move(box.x + 500, box.y + 400);

    for (let i = 0; i < 8; i++) await page.mouse.wheel(12, 6);
    await page.waitForTimeout(300);

    const after = await origin(page);
    expect(after.x).not.toBeCloseTo(before.x, 6);
    expect(after.y).not.toBeCloseTo(before.y, 6);
    // And it did not zoom.
    expect(after.distance).toBeCloseTo(before.distance, 6);
  });

  test('still zooms on a mouse wheel', async ({ page }) => {
    await ready(page);
    const before = await origin(page);
    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
    await page.mouse.move(box.x + 500, box.y + 400);

    // A wheel notch: vertical only, and large.
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(400);

    expect((await origin(page)).distance).toBeLessThan(before.distance * 0.8);
  });
});

test.describe('reset', () => {
  // Note the exact match. The preset button's accessible name begins "Preset",
  // which contains "reset", so a substring match picks up both.
  const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset', exact: true });

  test('restarts the clock and discards the trails', async ({ page }) => {
    await ready(page);
    await page.waitForTimeout(2000);

    const trailSamples = () =>
      page.evaluate(() => window.nbody!.renderer.debugStats().trailSamples);

    const before = await trailSamples();
    expect(before).toBeGreaterThan(100);
    const clockBefore = Number.parseFloat((await clock(page).textContent()) ?? '0');

    await resetButton(page).click();
    await page.waitForTimeout(250);

    // The history is gone, not merely added to. Leaving it meant the bodies
    // jumped back to the start while their old paths stayed on screen, joined
    // to the new positions by a straight line, which looks exactly like a
    // reset that did not happen.
    expect(await trailSamples()).toBeLessThan(before);
    expect(Number.parseFloat((await clock(page).textContent()) ?? '0')).toBeLessThan(clockBefore);
  });

  test('puts the bodies back where they started', async ({ page }) => {
    await ready(page);

    // Paused first, so the comparison is against a stationary state rather
    // than whatever the simulation drifted to between the two reads.
    await page.getByRole('button', { name: 'Pause' }).click();
    await resetButton(page).click();
    await page.waitForTimeout(250);
    const first = (await snapshot(page)).bodies.find((b) => b.name === 'Earth')!.position;

    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1500);
    const moved = (await snapshot(page)).bodies.find((b) => b.name === 'Earth')!.position;
    expect(Math.hypot(moved[0] - first[0], moved[1] - first[1])).toBeGreaterThan(0.05);

    await page.getByRole('button', { name: 'Pause' }).click();
    await resetButton(page).click();
    await page.waitForTimeout(250);
    const second = (await snapshot(page)).bodies.find((b) => b.name === 'Earth')!.position;

    // Reset is repeatable and lands in the same place every time, which is
    // what "back to the start" has to mean.
    expect(second[0]).toBeCloseTo(first[0], 9);
    expect(second[1]).toBeCloseTo(first[1], 9);
  });

  test('keeps a mass edit, and keeps the view', async ({ page }) => {
    await ready(page);

    const box = (await page.locator('canvas.nb-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.nb-inspector-bar .nb-label')).toHaveText('Body');
    const field = page.locator('.nb-inspector input.nb-input').nth(1);
    await field.fill('2');
    await field.blur();
    await page.waitForTimeout(300);

    await page.mouse.move(box.x + 500, box.y + 400);
    await page.mouse.wheel(0, -240);
    // Long enough for the zoom easing to settle, or the comparison is against
    // a value still in motion.
    await page.waitForTimeout(900);
    const zoomed = await page.evaluate(() => window.nbody!.renderer.camera.distance);

    await resetButton(page).click();
    await page.waitForTimeout(500);

    // Reset puts the bodies back. It does not undo the control panel, and it
    // does not take back the view you arranged.
    expect(massOf(await snapshot(page), 'Sun')).toBe(2);
    // A relative bound, not a decimal count: the easing is asymptotic and
    // never lands exactly. What matters is that the camera is still where it
    // was and has not been thrown back to the preset's framing of 9 AU.
    const after = await page.evaluate(() => window.nbody!.renderer.camera.distance);
    expect(Math.abs(after - zoomed) / zoomed).toBeLessThan(1e-3);
  });
});

test.describe('collisions', () => {
  test('offers every mode and reveals bounciness for the ones that need it', async ({ page }) => {
    await ready(page);

    const collisions = page.locator('.nb-inspector select').nth(2);
    await expect(collisions).toHaveValue('none');

    const options = await collisions
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toEqual(['none', 'realistic', 'merge', 'bounce']);

    // Bounciness only means something where there is a rebound to scale.
    const bounciness = page.locator('.nb-field', { hasText: 'Bounciness' });
    await expect(bounciness).toBeHidden();

    await collisions.selectOption('realistic');
    await expect(bounciness).toBeVisible();
    expect((await snapshot(page)).collisions).toBe('realistic');

    await collisions.selectOption('merge');
    await expect(bounciness).toBeHidden();
  });

  test('accretes planetesimals into fewer, larger bodies', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.nb-palette-input').fill('Planet Formation');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);

    const bodies = diagnostic(page, 'Bodies');
    const before = Number.parseInt((await bodies.textContent()) ?? '0', 10);
    expect(before).toBeGreaterThan(100);

    await page.waitForTimeout(6000);

    const after = Number.parseInt((await bodies.textContent()) ?? '0', 10);
    expect(after).toBeLessThan(before);

    // Mass is conserved through every merge, so the survivors are bigger
    // rather than bodies having been lost.
    const total = (await snapshot(page)).bodies.reduce((sum, b) => sum + b.mass, 0);
    expect(total).toBeCloseTo(1 + 300 * 3e-4, 6);
  });
});
