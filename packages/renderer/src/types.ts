import type { FrameSample, Scenario } from '@nbody/protocol';

/**
 * Renderer contract.
 *
 * Lane C implements this with WebGL2. It is defined here, in Phase 0, so that
 * the app shell and the UI can be built against it before the real renderer
 * exists, and so that swapping the provisional Canvas2D implementation for the
 * WebGL2 one changes exactly one call site.
 */
export interface Renderer {
  /** Called once per animation frame with the interpolated sample. */
  draw(sample: FrameSample, nowMs: number): void;

  /** Called when the scenario changes, to rebuild per-body state. */
  setScenario(scenario: Scenario): void;

  /** Device pixel ratio aware. Driven by a ResizeObserver in the shell. */
  resize(width: number, height: number, devicePixelRatio: number): void;

  camera: CameraController;

  /** Nearest body to a point in CSS pixels, or null. Screen-space, no readback. */
  pick(clientX: number, clientY: number): number | null;

  dispose(): void;
}

/**
 * Camera contract.
 *
 * Every value passes through a critically damped spring rather than being
 * applied directly. That is what makes zoom and pan feel continuous instead of
 * stepped, and it is the second half of the smoothness requirement after frame
 * interpolation.
 */
export interface CameraController {
  mode: '2d' | '3d';

  /** Target the camera eases toward. Never read back for rendering. */
  setTarget(x: number, y: number, z: number): void;
  /** Multiplies the current zoom, anchored at a point in CSS pixels. */
  zoomBy(factor: number, anchorClientX: number, anchorClientY: number): void;
  panBy(deltaClientX: number, deltaClientY: number): void;
  orbitBy(deltaAzimuth: number, deltaElevation: number): void;

  /** Keeps the view centred on a body handle. 0 clears it. */
  follow(handle: number): void;

  /**
   * World-space origin the renderer subtracts before narrowing to f32.
   *
   * Anchoring on the camera is what keeps precision at solar-system scale: see
   * writeRelativePositionsF32 in @nbody/protocol.
   */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;

  /** Advances the springs. Called once per frame before draw. */
  update(dtSeconds: number): void;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** Body size mapping. See docs/DESIGN.md. */
  radiusMode?: 'true' | 'log' | 'uniform';
  background?: string;
}
