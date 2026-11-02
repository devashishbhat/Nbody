import { expect, test } from '@playwright/test';

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
  const clock = page.locator('.nb-bottom-center .nb-num span');
  await expect(clock).not.toHaveText('0.000', { timeout: 10_000 });

  const first = Number(await clock.textContent());
  await page.waitForTimeout(600);
  const second = Number(await clock.textContent());
  expect(second).toBeGreaterThan(first);

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
  await page.selectOption('.nb-select', 'figure-eight');

  const drift = page.locator('.nb-bottom-right .nb-num').first();
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
  const clock = page.locator('.nb-bottom-center .nb-num span');
  await expect(clock).not.toHaveText('0.000', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);
  const paused = await clock.textContent();
  await page.waitForTimeout(500);
  expect(await clock.textContent()).toBe(paused);

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(500);
  expect(Number(await clock.textContent())).toBeGreaterThan(Number(paused));
});

test('switches presets without reloading the page', async ({ page }) => {
  await page.goto('/');

  // The solar system is the default: the Sun plus eight planets.
  const bodies = page.locator('.nb-bottom-right .nb-num').nth(1);
  await expect(bodies).toHaveText('9', { timeout: 10_000 });

  await page.selectOption('.nb-select', 'pythagorean');
  await expect(bodies).toHaveText('3', { timeout: 10_000 });

  await page.selectOption('.nb-select', 'circular-binary');
  await expect(bodies).toHaveText('2', { timeout: 10_000 });
});
