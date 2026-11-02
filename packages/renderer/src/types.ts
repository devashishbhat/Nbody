import type { CameraMode, FrameSample, Scenario } from '@nbody/protocol';

export type { CameraMode };

/** How a body's drawn size relates to its physical radius. */
export type RadiusMode = 'true' | 'log' | 'uniform';

export interface RenderOptions {
  /**
   * `true` draws physical radii, which at solar-system zoom means everything
   * is a minimum-size dot, because the solar system really is almost entirely
   * empty. `log` maps the scenario's radius range onto a legible pixel range
   * and hands over to true scale once you have zoomed in far enough for the
   * real disc to be larger. `uniform` draws every body the same size.
   */
  radiusMode: RadiusMode;
  showTrails: boolean;
  showGrid: boolean;
  showVelocities: boolean;
  /** Forward integration of the selected body, drawn as a faint path. */
  showPredictedOrbit: boolean;
  bloom: boolean;
  /** Handle of the selected body, or 0. Highlighted and used by the overlays. */
  selectedHandle: number;
  /**
   * World units per unit of velocity for the selected body's drag handle.
   *
   * Shared with the interaction layer rather than fixed in either, because the
   * handle has to be drawn exactly where clicking will grab it. 0 hides it.
   */
  velocityHandleScale: number;
  /** Suppresses bloom, trail fading and camera easing. */
  reducedMotion: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  radiusMode: 'log',
  showTrails: true,
  showGrid: true,
  showVelocities: false,
  showPredictedOrbit: false,
  bloom: true,
  selectedHandle: 0,
  velocityHandleScale: 0,
  reducedMotion: false,
};

/**
 * Camera contract.
 *
 * Implemented by `Camera`, which the UI uses directly. Every value passes
 * through damped easing rather than being applied immediately; see the notes
 * on that class.
 */
export interface CameraController {
  mode: CameraMode;

  /** World-space origin the renderer subtracts before narrowing to f32. */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;

  /** Orthographic half-height in 2D, orbit radius in 3D. */
  readonly distance: number;
  readonly pixelsPerWorld: number;
  /** Handle being followed, or 0. */
  readonly following: number;

  setTarget(x: number, y: number, z: number): void;
  setMode(mode: CameraMode): void;
  zoomBy(factor: number, anchorClientX?: number, anchorClientY?: number): void;
  panBy(deltaClientX: number, deltaClientY: number): void;
  orbitBy(deltaAzimuth: number, deltaElevation: number): void;
  follow(handle: number): void;

  project(worldX: number, worldY: number, worldZ: number, out: Float64Array): boolean;
  unproject2d(clientX: number, clientY: number, out: Float64Array): void;
}

export interface Renderer {
  readonly camera: CameraController;

  /**
   * Updates per-body appearance. Call on every scenario change.
   *
   * Does not touch the camera or existing trails, because an edit to a mass
   * produces a new scenario object and must not throw away the view the user
   * has arranged.
   */
  setScenario(scenario: Scenario): void;

  /** Frames the camera and clears trails. Call when a scenario is LOADED. */
  resetView(scenario: Scenario): void;

  /** Discards trail history, keeping the camera. Call when time restarts. */
  clearTrails(): void;

  /** Draws one frame. Called from requestAnimationFrame. Allocates nothing. */
  draw(sample: FrameSample, nowMs: number): void;

  resize(width: number, height: number, devicePixelRatio: number): void;

  setOptions(options: Partial<RenderOptions>): void;
  readonly options: Readonly<RenderOptions>;

  /**
   * Nearest body to a point in CSS pixels, as a slot index into the last
   * drawn sample, or null. Screen-space and CPU-side, so there is no GPU
   * readback stall.
   */
  pick(clientX: number, clientY: number): number | null;

  /** World position of a slot in the last drawn sample. */
  positionOf(slot: number, out: Float64Array): boolean;

  /** Handle of a slot in the last drawn sample, or 0. */
  handleOf(slot: number): number;

  /** Scenario index for a handle, or -1. */
  indexOfHandle(handle: number): number;

  dispose(): void;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  options?: Partial<RenderOptions>;
}

/** Thrown when WebGL2 is unavailable, so the shell can say so plainly. */
export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL2 is not available in this browser');
    this.name = 'WebGLUnavailableError';
  }
}
