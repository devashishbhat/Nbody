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

test('draws the bodies rather than an empty canvas', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);

  // Sample the rendered pixels. A canvas that stayed at the background colour
  // would mean the renderer never received a frame.
  const distinctColours = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.nb-canvas') as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  });

  expect(distinctColours).toBeGreaterThan(3);
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
