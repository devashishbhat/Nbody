import { expect, type Page } from '@playwright/test';
import type { Scenario } from '@nbody/protocol';

/**
 * The handle the app exposes on `window`.
 *
 * Typed here rather than cast at each call site, so the tests exercise the
 * real shapes and a change to them fails the typecheck rather than a run.
 */
interface NbodyHandle {
  client: {
    snapshot: () => Promise<Scenario>;
  };
  renderer: {
    camera: {
      distance: number;
      mode: '2d' | '3d';
      project: (x: number, y: number, z: number, out: Float64Array) => boolean;
    };
    positionOf: (slot: number, out: Float64Array) => boolean;
    setOptions: (options: Record<string, unknown>) => void;
    debugStats: () => {
      trails: number;
      trailSamples: number;
      mappedHandles: number;
      bodies: number;
      radiusMode: string;
    };
  };
}

declare global {
  interface Window {
    nbody?: NbodyHandle;
  }
}

/** Loads the app and waits until the simulation is actually running. */
export async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas.nb-canvas')).toBeVisible();
  await page.waitForFunction(() => window.nbody !== undefined);
  await page.waitForTimeout(900);
}

/** The live simulation state, as a scenario. */
export function snapshot(page: Page): Promise<Scenario> {
  return page.evaluate(() => window.nbody!.client.snapshot());
}

export function cameraDistance(page: Page): Promise<number> {
  return page.evaluate(() => window.nbody!.renderer.camera.distance);
}

export function cameraMode(page: Page): Promise<'2d' | '3d'> {
  return page.evaluate(() => window.nbody!.renderer.camera.mode);
}

export function massOf(scenario: Scenario, name: string): number {
  const body = scenario.bodies.find((candidate) => candidate.name === name);
  if (!body) throw new Error(`no body called ${name}`);
  return body.mass;
}

/** The simulation clock, as displayed. */
export function clock(page: Page) {
  return page.locator('.nb-clock span');
}

/** A named row in the diagnostics panel. */
export function diagnostic(page: Page, label: string) {
  return page.locator('.nb-bottom-left .nb-row', { hasText: label }).locator('.nb-num');
}
