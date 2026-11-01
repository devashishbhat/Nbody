import { type FrameSample, type Scenario } from '@nbody/protocol';
import type { CameraController, Renderer, RendererOptions } from './types.ts';

/**
 * Provisional Canvas2D renderer.
 *
 * LANE C: this is scaffolding, not a starting point to extend. It exists so
 * that the app shell, the engine and the interpolator form a working vertical
 * slice from day one, and so there is something to compare the WebGL2
 * renderer's output against. Replace it wholesale; do not grow it.
 *
 * It implements the Renderer and CameraController contracts honestly,
 * including the camera-anchored f32 conversion and the damped springs, so the
 * shell's wiring does not change when the real renderer lands.
 */

/** Critically damped spring. Settles without overshoot at any frame rate. */
function approach(current: number, target: number, rate: number, dt: number): number {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

class SimpleCamera implements CameraController {
  mode: '2d' | '3d' = '2d';

  originX = 0;
  originY = 0;
  originZ = 0;

  /** Orthographic half-height in world units. */
  distance = 1;

  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetDistance = 1;
  private followHandle = 0;

  azimuth = 0;
  elevation = Math.PI / 2;
  private targetAzimuth = 0;
  private targetElevation = Math.PI / 2;

  setTarget(x: number, y: number, z: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;
  }

  zoomBy(factor: number): void {
    // Zoom is exponential, so each wheel notch covers the same proportion of
    // the scale range whether you are looking at a moon or at the Oort cloud.
    this.targetDistance = Math.min(1e12, Math.max(1e-9, this.targetDistance / factor));
  }

  panBy(dx: number, dy: number): void {
    const scale = (this.distance * 2) / this.viewportHeight;
    this.targetX -= dx * scale;
    this.targetY += dy * scale;
    this.followHandle = 0;
  }

  orbitBy(dAzimuth: number, dElevation: number): void {
    this.targetAzimuth += dAzimuth;
    this.targetElevation = Math.min(
      Math.PI / 2,
      Math.max(-Math.PI / 2, this.targetElevation + dElevation),
    );
  }

  follow(handle: number): void {
    this.followHandle = handle;
  }

  get following(): number {
    return this.followHandle;
  }

  viewportHeight = 1;

  update(dt: number): void {
    const rate = 14;
    this.originX = approach(this.originX, this.targetX, rate, dt);
    this.originY = approach(this.originY, this.targetY, rate, dt);
    this.originZ = approach(this.originZ, this.targetZ, rate, dt);
    this.distance = approach(this.distance, this.targetDistance, rate, dt);
    this.azimuth = approach(this.azimuth, this.targetAzimuth, rate, dt);
    this.elevation = approach(this.elevation, this.targetElevation, rate, dt);
  }

  frame(distance: number, x = 0, y = 0, z = 0): void {
    this.targetDistance = distance;
    this.distance = distance;
    this.setTarget(x, y, z);
    this.originX = x;
    this.originY = y;
    this.originZ = z;
  }
}

export function createCanvas2DRenderer(options: RendererOptions): Renderer {
  const canvas = options.canvas;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2d canvas context unavailable');

  const camera = new SimpleCamera();
  const background = options.background ?? '#08080a';

  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastMs = 0;

  // Pre-allocated. The draw path must not allocate.
  let relative = new Float32Array(0);
  let colors: string[] = [];
  let radii = new Float64Array(0);
  let screenX = new Float64Array(0);
  let screenY = new Float64Array(0);

  function ensure(count: number): void {
    if (relative.length >= count * 3) return;
    relative = new Float32Array(count * 3);
    radii = new Float64Array(count);
    screenX = new Float64Array(count);
    screenY = new Float64Array(count);
  }

  return {
    camera,

    setScenario(scenario: Scenario): void {
      ensure(scenario.bodies.length);
      colors = scenario.bodies.map((b) => b.color);
      for (let i = 0; i < scenario.bodies.length; i++) {
        radii[i] = scenario.bodies[i]!.radius;
      }
      const distance = scenario.camera?.distance ?? 1;
      const target = scenario.camera?.target ?? [0, 0, 0];
      camera.mode = scenario.camera?.mode ?? '2d';
      camera.frame(distance, target[0], target[1], target[2]);
    },

    resize(nextWidth: number, nextHeight: number, nextDpr: number): void {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      camera.viewportHeight = height;
    },

    draw(sample: FrameSample, nowMs: number): void {
      const dt = lastMs === 0 ? 1 / 60 : Math.min(0.1, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      camera.update(dt);

      const count = sample.count;
      ensure(count);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      // Positions are narrowed to f32 only after the camera origin is removed
      // in f64, which is what preserves precision when zoomed in.
      const positions = sample.positions;
      const ox = camera.originX;
      const oy = camera.originY;
      const oz = camera.originZ;
      for (let i = 0; i < count; i++) {
        const d = i * 3;
        relative[d] = positions[d] - ox;
        relative[d + 1] = positions[d + 1] - oy;
        relative[d + 2] = positions[d + 2] - oz;
      }

      const scale = height / (camera.distance * 2);
      const cx = width / 2;
      const cy = height / 2;

      for (let i = 0; i < count; i++) {
        const d = i * 3;
        screenX[i] = cx + relative[d] * scale;
        screenY[i] = cy - relative[d + 1] * scale;
      }

      for (let i = 0; i < count; i++) {
        const pixels = Math.max(1.5, Math.min(40, (radii[i] || 0) * scale));
        context.beginPath();
        context.arc(screenX[i], screenY[i], pixels, 0, Math.PI * 2);
        context.fillStyle = colors[i] ?? '#e8e6e3';
        context.fill();
      }
    },

    pick(clientX: number, clientY: number): number | null {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best = -1;
      let bestDistance = 18 * 18;
      for (let i = 0; i < screenX.length; i++) {
        const dx = screenX[i] - px;
        const dy = screenY[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDistance) {
          bestDistance = d2;
          best = i;
        }
      }
      return best < 0 ? null : best;
    },

    dispose(): void {
      colors = [];
    },
  };
}

export { approach };
