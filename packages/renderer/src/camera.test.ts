import { describe, expect, it } from 'vitest';
import { Camera } from './camera.ts';

/** A settled camera, so assertions are about the target rather than the easing. */
function settle(camera: Camera): void {
  for (let i = 0; i < 400; i++) camera.update(1 / 60);
}

function make(width = 1200, height = 800): Camera {
  const camera = new Camera();
  camera.setViewport(width, height);
  camera.snapTo(0, 0, 0, 10, '2d');
  return camera;
}

const point = new Float64Array(3);

describe('framing', () => {
  it('snaps without easing, so loading a scenario does not fly the camera in', () => {
    const camera = make();
    camera.snapTo(5, -3, 0, 42, '2d');
    expect(camera.originX).toBe(5);
    expect(camera.originY).toBe(-3);
    expect(camera.distance).toBeCloseTo(42, 9);
  });

  it('reports pixels per world unit from the viewport and the half-height', () => {
    const camera = make(1200, 800);
    // 800 pixels spans 2 * 10 world units.
    expect(camera.pixelsPerWorld).toBeCloseTo(40, 9);
  });
});

describe('anchored zoom', () => {
  it('keeps the world point under the cursor fixed', () => {
    // What makes zoom feel like a physical action rather than a slider. The
    // thing you are pointing at must not slide away.
    const camera = make();
    const cursorX = 950;
    const cursorY = 220;

    camera.unproject2d(cursorX, cursorY, point);
    const before = [point[0], point[1]] as const;

    camera.zoomBy(4, cursorX, cursorY);
    settle(camera);

    camera.unproject2d(cursorX, cursorY, point);
    expect(point[0]).toBeCloseTo(before[0], 9);
    expect(point[1]).toBeCloseTo(before[1], 9);
  });

  it('holds the point across many successive zooms', () => {
    // Drift would accumulate here if the anchoring were approximate.
    const camera = make();
    const cursorX = 300;
    const cursorY = 650;

    camera.unproject2d(cursorX, cursorY, point);
    const before = [point[0], point[1]] as const;

    for (let i = 0; i < 25; i++) {
      camera.zoomBy(1.2, cursorX, cursorY);
      settle(camera);
    }

    camera.unproject2d(cursorX, cursorY, point);
    expect(point[0]).toBeCloseTo(before[0], 6);
    expect(point[1]).toBeCloseTo(before[1], 6);
  });

  it('zooms about the centre when no anchor is given', () => {
    const camera = make();
    camera.zoomBy(2);
    settle(camera);
    expect(camera.distance).toBeCloseTo(5, 9);
    expect(camera.originX).toBeCloseTo(0, 9);
  });

  it('is exponential, so each notch covers the same proportion', () => {
    const camera = make();
    camera.zoomBy(2);
    settle(camera);
    const once = camera.distance;
    camera.zoomBy(2);
    settle(camera);
    expect(once / camera.distance).toBeCloseTo(2, 9);
  });

  it('clamps rather than reaching zero or infinity', () => {
    const camera = make();
    for (let i = 0; i < 200; i++) camera.zoomBy(10);
    settle(camera);
    expect(camera.distance).toBeGreaterThan(0);
    expect(Number.isFinite(camera.distance)).toBe(true);

    for (let i = 0; i < 400; i++) camera.zoomBy(0.1);
    settle(camera);
    expect(Number.isFinite(camera.distance)).toBe(true);
  });
});

describe('panning', () => {
  it('moves the view by exactly the dragged distance', () => {
    // Dragging 100 pixels must move the scene 100 pixels, or the content
    // slides out from under the pointer.
    const camera = make(1200, 800);
    camera.unproject2d(600, 400, point);
    const before = point[0];

    camera.panBy(100, 0);
    settle(camera);

    camera.unproject2d(600, 400, point);
    const worldPerPixel = (2 * camera.distance) / 800;
    expect(before - point[0]).toBeCloseTo(100 * worldPerPixel, 9);
  });

  it('cancels any follow, since the user has taken over', () => {
    const camera = make();
    camera.follow(7);
    expect(camera.following).toBe(7);
    camera.panBy(10, 10);
    expect(camera.following).toBe(0);
  });
});

describe('projection round trip', () => {
  it('projects and unprojects to the same pixel in 2D', () => {
    const camera = make(1200, 800);
    camera.snapTo(3, -2, 0, 7, '2d');

    const screen = new Float64Array(2);
    for (const [x, y] of [
      [3, -2],
      [5.5, 0.25],
      [-1, -6],
    ]) {
      expect(camera.project(x!, y!, 0, screen)).toBe(true);
      camera.unproject2d(screen[0]!, screen[1]!, point);
      expect(point[0]).toBeCloseTo(x!, 4);
      expect(point[1]).toBeCloseTo(y!, 4);
    }
  });

  it('puts the camera target at the centre of the viewport', () => {
    const camera = make(1200, 800);
    camera.snapTo(12, 34, 0, 5, '2d');
    const screen = new Float64Array(2);
    camera.project(12, 34, 0, screen);
    expect(screen[0]).toBeCloseTo(600, 3);
    expect(screen[1]).toBeCloseTo(400, 3);
  });
});

describe('easing', () => {
  it('approaches a new target without reaching it instantly', () => {
    const camera = make();
    camera.setTarget(100, 0, 0);
    camera.update(1 / 60);
    expect(camera.originX).toBeGreaterThan(0);
    expect(camera.originX).toBeLessThan(100);
    settle(camera);
    expect(camera.originX).toBeCloseTo(100, 6);
  });

  it('does not move at all when the time step is zero', () => {
    // The snapTo path depends on this: it calls update(0) to build matrices
    // without advancing anything.
    const camera = make();
    camera.setTarget(100, 0, 0);
    camera.update(0);
    expect(camera.originX).toBe(0);
  });
});

describe('modes', () => {
  it('ignores orbit input in 2D', () => {
    const camera = make();
    const before = camera.viewProjection.slice();
    camera.orbitBy(1, 0.5);
    settle(camera);
    expect([...camera.viewProjection]).toEqual([...before]);
  });

  it('responds to orbit input in 3D', () => {
    const camera = make();
    camera.setMode('3d');
    settle(camera);
    const before = camera.viewProjection.slice();
    camera.orbitBy(0.8, 0.2);
    settle(camera);
    expect([...camera.viewProjection]).not.toEqual([...before]);
  });

  it('keeps every matrix finite in both modes', () => {
    const camera = make();
    for (const mode of ['2d', '3d', '2d'] as const) {
      camera.setMode(mode);
      settle(camera);
      expect([...camera.viewProjection].every(Number.isFinite)).toBe(true);
      expect([...camera.inverseViewProjection].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('direct manipulation', () => {
  /**
   * Dragging and following must not go through the easing.
   *
   * Easing is right when the camera is moving on its own, after a wheel notch
   * or a programmatic jump. It is wrong whenever something is being held or
   * tracked, because the lag means the thing is never where it should be. At a
   * wide view that reads as sluggishness; at a close one the subject leaves the
   * screen entirely.
   */
  it('pans by exactly the dragged distance, with no lag', () => {
    const camera = make(1200, 800);
    const worldPerPixel = (2 * camera.distance) / 800;

    const before = camera.originX;
    camera.panBy(100, 0);

    // Before `update` runs. A camera that only moved its target would still
    // be sitting where it started here, and the content would trail the
    // pointer for the whole drag.
    expect(before - camera.originX).toBeCloseTo(100 * worldPerPixel, 9);
  });

  it('does not drift after the drag ends', () => {
    const camera = make(1200, 800);
    camera.panBy(100, -40);
    const settledX = camera.originX;
    const settledY = camera.originY;

    settle(camera);

    // Current and target were moved together, so there is nothing left to
    // ease toward and the view stays where it was released.
    expect(camera.originX).toBeCloseTo(settledX, 12);
    expect(camera.originY).toBeCloseTo(settledY, 12);
  });

  it('orbits immediately in 3D', () => {
    const camera = make();
    camera.setMode('3d');
    settle(camera);
    const before = camera.viewProjection.slice();

    camera.orbitBy(0.4, 0.1);
    camera.update(0);

    expect([...camera.viewProjection]).not.toEqual([...before]);
  });

  it('centres a followed body exactly', () => {
    // The case that exposed this: following a body while zoomed in far enough
    // to see its disc. An eased camera is thousands of view-widths behind.
    const camera = make(1200, 800);
    camera.snapTo(0, 0, 0, 1e-4, '2d');
    camera.follow(7);

    const screen = new Float64Array(2);
    for (let step = 0; step < 50; step++) {
      // A body crossing many view-widths per frame.
      const x = step * 0.05;
      camera.trackFollowed(x, -x * 0.3, 0);
      camera.update(1 / 60);

      expect(camera.project(x, -x * 0.3, 0, screen)).toBe(true);
      expect(screen[0]).toBeCloseTo(600, 6);
      expect(screen[1]).toBeCloseTo(400, 6);
    }
  });
});

describe('zoom and follow are independent', () => {
  it('keeps following while zooming', () => {
    // Anchoring zoom at the cursor drags the target off the followed body, so
    // it used to cancel the follow. Zooming in on the thing you asked to
    // follow then lost it, which is the opposite of what the gesture means.
    const camera = make();
    camera.follow(42);

    camera.zoomBy(2, 900, 150);
    settle(camera);

    expect(camera.following).toBe(42);
  });

  it('still anchors at the cursor when not following', () => {
    const camera = make();
    const cursorX = 950;
    const cursorY = 220;

    camera.unproject2d(cursorX, cursorY, point);
    const before = [point[0], point[1]] as const;

    camera.zoomBy(4, cursorX, cursorY);
    settle(camera);

    camera.unproject2d(cursorX, cursorY, point);
    expect(point[0]).toBeCloseTo(before[0], 9);
    expect(point[1]).toBeCloseTo(before[1], 9);
  });

  it('still zooms toward the body while following', () => {
    const camera = make();
    camera.follow(42);
    const before = camera.distance;
    camera.zoomBy(4, 900, 150);
    settle(camera);
    expect(camera.distance).toBeCloseTo(before / 4, 9);
  });
});
