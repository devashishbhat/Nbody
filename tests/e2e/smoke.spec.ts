import { expect, test } from '@playwright/test';
import { clock, diagnostic } from './helpers.ts';

/**
 * Vertical slice smoke test.
 *
 * Phase 0's claim is that engine, worker, interpolator, renderer and shell
 * form a working whole. That claim is only worth anything if a real browser
 * confirms it, because every interesting failure mode here (the worker chunk
 * not resolving, the frame buffer being transferred and then read, the
 * animation loop never starting) is invisible to a node test.
 */

test('loads a preset and runs it', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  const canvas = page.locator('canvas.nb-canvas');
  await expect(canvas).toBeVisible();

  // Simulation time advancing is proof that the worker loaded the scenario,
  // stepped it, published frames, and that the main thread interpolated them.
  const reading = clock(page);
  await expect(reading).not.toHaveText('0.0 d', { timeout: 10_000 });

  const first = await reading.textContent();
  await page.waitForTimeout(600);
  expect(await reading.textContent()).not.toBe(first);

  expect(errors).toEqual([]);
});

test('has WebGL2 available', async ({ page }) => {
  await page.goto('/');
  const supported = await page.evaluate(
    () => !!document.createElement('canvas').getContext('webgl2'),
  );
  expect(supported).toBe(true);
});

test('draws moving content rather than a static or empty canvas', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  const canvas = page.locator('canvas.nb-canvas');

  // Comparing screenshot buffers needs no image decoder and tests exactly the
  // right thing: pixels that change between two moments can only come from a
  // renderer that is drawing something in motion. An empty canvas, a crashed
  // context or a frozen loop all produce identical buffers.
  const first = await canvas.screenshot();
  await page.waitForTimeout(500);
  const second = await canvas.screenshot();

  expect(first.equals(second)).toBe(false);
  // A plausible amount of data for a rendered frame, not a 1x1 placeholder.
  expect(first.byteLength).toBeGreaterThan(2000);
});

test('comes to rest when paused', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  const canvas = page.locator('canvas.nb-canvas');
  await page.getByRole('button', { name: 'Pause' }).click();

  // Pausing does not stop motion instantly, and should not: the playback ring
  // still holds frames from before the pause at earlier simulation times, so
  // the interpolated view eases to a halt over a few publish cycles rather
  // than snapping.
  //
  // How long that takes in wall time depends on how many animation frames the
  // browser gets, which under a parallel test run is not predictable. So this
  // polls for the property that actually matters, that it does come to rest,
  // instead of asserting a fixed settling time.
  await expect(async () => {
    const first = await canvas.screenshot();
    await page.waitForTimeout(250);
    const second = await canvas.screenshot();
    expect(first.equals(second)).toBe(true);
  }).toPass({ timeout: 10_000 });
});

test('keeps energy drift negligible on the figure-eight', async ({ page }) => {
  await page.goto('/');
  // The strictest preset: yoshida4, no softening, and an orbit that stops
  // closing if anything perturbs the state. If interpolation, a live edit or
  // the stepping budget were corrupting state, this is where it would show.
  await page.waitForFunction(() => window.nbody !== undefined);
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.nb-palette-input').fill('Figure Eight');
  await page.keyboard.press('Enter');

  const drift = diagnostic(page, 'Energy drift');
  await expect(drift).toBeVisible();
  await page.waitForTimeout(2500);

  const text = (await drift.textContent()) ?? '';
  expect(text).not.toBe('diverged');

  const value = Number(text.replace('e', 'E'));
  expect(Number.isFinite(value)).toBe(true);
  expect(Math.abs(value)).toBeLessThan(1e-6);
});

test('pauses and resumes', async ({ page }) => {
  await page.goto('/');
  const reading = clock(page);
  await expect(reading).not.toHaveText('0.0 d', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);
  const paused = await reading.textContent();
  await page.waitForTimeout(500);
  expect(await reading.textContent()).toBe(paused);

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(500);
  expect(await reading.textContent()).not.toBe(paused);
});

test('switches presets without reloading the page', async ({ page }) => {
  await page.goto('/');

  // The solar system is the default: the Sun plus eight planets.
  const bodies = diagnostic(page, 'Bodies');
  await expect(bodies).toHaveText('9', { timeout: 10_000 });

  // Presets are chosen from the command palette now, not a select.
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.nb-palette-input').fill('Pythagorean');
  await page.keyboard.press('Enter');
  await expect(bodies).toHaveText('3', { timeout: 10_000 });

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.nb-palette-input').fill('Circular');
  await page.keyboard.press('Enter');
  await expect(bodies).toHaveText('2', { timeout: 10_000 });
});
