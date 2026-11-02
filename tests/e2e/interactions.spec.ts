import { expect, test, type Page } from '@playwright/test';
import { cameraDistance, cameraMode, clock, massOf, ready, snapshot } from './helpers.ts';

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
    await page.locator('.nb-palette-input').fill('orbiting');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    expect(await cameraMode(page)).toBe('3d');
  });
});
