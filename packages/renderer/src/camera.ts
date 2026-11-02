import {
  angleDelta,
  approach,
  clamp,
  identity,
  invert,
  lookAt,
  mat4,
  multiply,
  orthographic,
  perspective,
  transformPoint,
  type Mat4,
} from './math.ts';
import type { CameraController, CameraMode } from './types.ts';

/**
 * The camera, in both modes.
 *
 * Physics is always three dimensional; only the camera is 2D by default,
 * because the solar system is nearly planar and reads far better flat. The
 * same object serves both modes so that switching cannot desynchronise two
 * sets of state, and so `distance` means one thing throughout: the
 * orthographic half-height in 2D, the orbit radius in 3D. Zoom is therefore a
 * single scalar in both.
 *
 * ## Why everything is damped
 *
 * No parameter is ever applied directly. Each has a target that input writes
 * to and a current value that eases toward it, which is half of what makes the
 * app feel smooth (frame interpolation is the other half). The easing is
 * exponential rather than a mass-spring, so it cannot overshoot at any frame
 * rate.
 *
 * ## Why zoom is damped in log space
 *
 * Easing `distance` linearly from 10^6 to 1 would spend almost all its time in
 * the first few percent of the journey and then arrive in a rush. Easing the
 * logarithm makes every octave of zoom take the same time, which is also why
 * wheel input multiplies rather than adds.
 *
 * ## The render origin
 *
 * `originX/Y/Z` is the camera target, and the renderer subtracts it from world
 * positions in f64 before narrowing to f32. That is what keeps precision at
 * solar-system scale: see the frame layout notes in @nbody/protocol. In render
 * space the camera therefore always looks at the origin.
 */

/** Easing rate. Higher settles faster; 14 is about 70 ms to visually settle. */
const SPRING_RATE = 14;

/** Vertical field of view in 3D mode. */
const FOV_Y = (50 * Math.PI) / 180;

/** Zoom bounds, in world units of half-height or orbit radius. */
const MIN_DISTANCE = 1e-9;
const MAX_DISTANCE = 1e12;

/** Elevation is clamped just short of the poles to keep `up` well defined. */
const MAX_ELEVATION = Math.PI / 2 - 1e-3;

export class Camera implements CameraController {
  mode: CameraMode = '2d';

  /** Current, eased values. */
  private x = 0;
  private y = 0;
  private z = 0;
  private logDistance = 0;
  private azimuth = 0;
  private elevation = Math.PI / 2;

  /** Targets that input writes to. */
  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetLogDistance = 0;
  private targetAzimuth = 0;
  private targetElevation = Math.PI / 2;

  private followHandle = 0;

  /** Viewport in CSS pixels. */
  private width = 1;
  private height = 1;

  readonly view: Mat4 = identity(mat4());
  readonly projection: Mat4 = identity(mat4());
  readonly viewProjection: Mat4 = identity(mat4());
  readonly inverseViewProjection: Mat4 = identity(mat4());

  private readonly scratch = new Float64Array(4);

  get originX(): number {
    return this.x;
  }

  get originY(): number {
    return this.y;
  }

  get originZ(): number {
    return this.z;
  }

  /**
   * Half-height of the view at the target, in world units, in BOTH modes.
   *
   * Not the eye distance. Treating it as the orbit radius in 3D made the same
   * number frame a scenario completely differently in each mode: with a 50
   * degree field of view, the visible height at the target is only 0.93 times
   * the eye distance, against 2 times the half-height in orthographic. A
   * preset framed in 2D then showed less than half as much when switched to
   * 3D, which is how the galaxy presets ended up mostly off screen.
   *
   * Defining it as the visible half-height instead makes a scenario's camera
   * distance mean one thing, and makes switching modes keep the framing.
   */
  get distance(): number {
    return Math.exp(this.logDistance);
  }

  /** Eye distance in 3D, derived so the framing matches 2D. */
  private get eyeDistance(): number {
    return this.distance / Math.tan(FOV_Y / 2);
  }

  /** Pixels per world unit at the target plane. Drives body sizing. */
  get pixelsPerWorld(): number {
    return this.height / (2 * this.distance);
  }

  get following(): number {
    return this.followHandle;
  }

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  setTarget(x: number, y: number, z: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;
  }

  /** Jumps to a framing with no easing. For loading a scenario. */
  snapTo(x: number, y: number, z: number, distance: number, mode: CameraMode): void {
    this.mode = mode;
    this.setTarget(x, y, z);
    this.x = x;
    this.y = y;
    this.z = z;
    const clamped = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.targetLogDistance = Math.log(clamped);
    this.logDistance = this.targetLogDistance;
    this.targetAzimuth = 0;
    this.azimuth = 0;
    this.targetElevation = mode === '2d' ? Math.PI / 2 : 0.45;
    this.elevation = this.targetElevation;
    this.followHandle = 0;
    this.update(0);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Easing into the new orientation rather than cutting makes the switch
    // legible: you see which way the plane was facing.
    this.targetElevation = mode === '2d' ? MAX_ELEVATION : 0.45;
    if (mode === '2d') this.targetAzimuth = this.azimuth;
  }

  /**
   * Multiplies zoom, keeping the world point under the cursor fixed.
   *
   * Anchoring is what makes zoom feel like a physical action rather than a
   * slider: the thing you are pointing at stays where it is. Only meaningful
   * in 2D; an orbit camera zooms toward its target by definition.
   */
  zoomBy(factor: number, anchorClientX = this.width / 2, anchorClientY = this.height / 2): void {
    const before = Math.exp(this.targetLogDistance);
    const next = clamp(before / factor, MIN_DISTANCE, MAX_DISTANCE);
    this.targetLogDistance = Math.log(next);

    if (this.mode !== '2d') return;

    // Offset of the cursor from the viewport centre, in pixels.
    const dx = anchorClientX - this.width / 2;
    const dy = anchorClientY - this.height / 2;

    // World units per pixel before and after, at the target plane.
    const worldPerPixelBefore = (2 * before) / this.height;
    const worldPerPixelAfter = (2 * next) / this.height;
    const shift = worldPerPixelBefore - worldPerPixelAfter;

    this.targetX += dx * shift;
    // Screen y grows downward, world y grows upward.
    this.targetY -= dy * shift;
    this.followHandle = 0;
  }

  panBy(deltaClientX: number, deltaClientY: number): void {
    const worldPerPixel = (2 * Math.exp(this.targetLogDistance)) / this.height;

    if (this.mode === '2d') {
      this.targetX -= deltaClientX * worldPerPixel;
      this.targetY += deltaClientY * worldPerPixel;
    } else {
      // Pan along the camera's own right and up axes, so dragging moves the
      // scene the way it looks like it should from the current angle.
      const cosAzimuth = Math.cos(this.azimuth);
      const sinAzimuth = Math.sin(this.azimuth);
      const cosElevation = Math.cos(this.elevation);
      const sinElevation = Math.sin(this.elevation);

      const rightX = -sinAzimuth;
      const rightY = cosAzimuth;

      const upX = -cosAzimuth * sinElevation;
      const upY = -sinAzimuth * sinElevation;
      const upZ = cosElevation;

      const sx = -deltaClientX * worldPerPixel;
      const sy = deltaClientY * worldPerPixel;

      this.targetX += rightX * sx + upX * sy;
      this.targetY += rightY * sx + upY * sy;
      this.targetZ += upZ * sy;
    }

    this.followHandle = 0;
  }

  orbitBy(deltaAzimuth: number, deltaElevation: number): void {
    if (this.mode !== '3d') return;
    this.targetAzimuth += deltaAzimuth;
    this.targetElevation = clamp(
      this.targetElevation + deltaElevation,
      -MAX_ELEVATION,
      MAX_ELEVATION,
    );
  }

  follow(handle: number): void {
    this.followHandle = handle;
  }

  /** Points the camera at a followed body. Called before `update` each frame. */
  trackFollowed(x: number, y: number, z: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;
  }

  /** Advances the easing and rebuilds the matrices. */
  update(dt: number): void {
    if (dt > 0) {
      this.x = approach(this.x, this.targetX, SPRING_RATE, dt);
      this.y = approach(this.y, this.targetY, SPRING_RATE, dt);
      this.z = approach(this.z, this.targetZ, SPRING_RATE, dt);
      this.logDistance = approach(this.logDistance, this.targetLogDistance, SPRING_RATE, dt);
      // Azimuth takes the short way round, so crossing the seam at pi does
      // not spin the camera the long way.
      this.azimuth +=
        angleDelta(this.azimuth, this.targetAzimuth) * (1 - Math.exp(-SPRING_RATE * dt));
      this.elevation = approach(this.elevation, this.targetElevation, SPRING_RATE, dt);
    }

    const aspect = this.width / this.height;
    const distance = this.distance;

    if (this.mode === '2d') {
      // Symmetric and generous: in orthographic projection the depth range
      // costs nothing but clipping the system would be very visible.
      orthographic(this.projection, distance, aspect, -1e4 * distance, 1e4 * distance);
      lookAt(this.view, 0, 0, distance, 0, 0, 0, 0, 1, 0);
    } else {
      const eye = this.eyeDistance;
      perspective(this.projection, FOV_Y, aspect, eye * 1e-3, eye * 1e4);
      const cosElevation = Math.cos(this.elevation);
      const eyeX = eye * cosElevation * Math.cos(this.azimuth);
      const eyeY = eye * cosElevation * Math.sin(this.azimuth);
      const eyeZ = eye * Math.sin(this.elevation);
      lookAt(this.view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 0, 1);
    }

    multiply(this.viewProjection, this.projection, this.view);
    if (!invert(this.inverseViewProjection, this.viewProjection)) {
      identity(this.inverseViewProjection);
    }
  }

  /**
   * Projects a world position to CSS pixels.
   *
   * Returns false when the point is behind the camera, which only happens in
   * 3D mode. `out` receives x and y in pixels.
   */
  project(worldX: number, worldY: number, worldZ: number, out: Float64Array): boolean {
    transformPoint(
      this.scratch,
      this.viewProjection,
      worldX - this.x,
      worldY - this.y,
      worldZ - this.z,
    );
    const w = this.scratch[3];
    if (w <= 0) return false;
    out[0] = ((this.scratch[0] / w) * 0.5 + 0.5) * this.width;
    out[1] = (1 - ((this.scratch[1] / w) * 0.5 + 0.5)) * this.height;
    return true;
  }

  /**
   * Maps a pixel to a world position on the z = 0 plane in 2D mode.
   *
   * Used for dragging bodies and for spawning one where the pointer is. In 3D
   * there is no single right answer, so this stays 2D only and the interaction
   * layer restricts those gestures accordingly.
   */
  unproject2d(clientX: number, clientY: number, out: Float64Array): void {
    const worldPerPixel = (2 * this.distance) / this.height;
    out[0] = this.x + (clientX - this.width / 2) * worldPerPixel;
    out[1] = this.y - (clientY - this.height / 2) * worldPerPixel;
    out[2] = 0;
  }
}
