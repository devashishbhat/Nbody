/**
 * Column-major 4x4 matrices, the layout WebGL expects.
 *
 * Every function writes into a caller-supplied output array and returns it.
 * Nothing here allocates, because all of it runs inside the frame loop. See
 * docs/CONTRACTS.md.
 */

export type Mat4 = Float32Array;

export function mat4(): Mat4 {
  return new Float32Array(16);
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/**
 * Orthographic projection from a half-height and an aspect ratio.
 *
 * Used by the 2D camera. The half-height is the camera's `distance`, so
 * zooming is a single scalar in both modes.
 */
export function orthographic(
  out: Mat4,
  halfHeight: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const halfWidth = halfHeight * aspect;
  out.fill(0);
  out[0] = 1 / halfWidth;
  out[5] = 1 / halfHeight;
  out[10] = -2 / (far - near);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

/** Perspective projection. `fovY` is the vertical field of view in radians. */
export function perspective(
  out: Mat4,
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Right-handed look-at. */
export function lookAt(
  out: Mat4,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  upX: number,
  upY: number,
  upZ: number,
): Mat4 {
  let fx = centerX - eyeX;
  let fy = centerY - eyeY;
  let fz = centerZ - eyeZ;
  let length = Math.hypot(fx, fy, fz);
  if (length === 0) {
    // Degenerate: eye sits on the target. Any orientation will do, so pick one
    // rather than producing NaNs that propagate into every vertex.
    return identity(out);
  }
  fx /= length;
  fy /= length;
  fz /= length;

  // s = f x up
  let sx = fy * upZ - fz * upY;
  let sy = fz * upX - fx * upZ;
  let sz = fx * upY - fy * upX;
  length = Math.hypot(sx, sy, sz);
  if (length === 0) {
    // Looking straight along `up`. Nudge the basis instead of dividing by zero.
    sx = 1;
    sy = 0;
    sz = 0;
    length = 1;
  }
  sx /= length;
  sy /= length;
  sz /= length;

  // u = s x f
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;

  out[0] = sx;
  out[1] = ux;
  out[2] = -fx;
  out[3] = 0;
  out[4] = sy;
  out[5] = uy;
  out[6] = -fy;
  out[7] = 0;
  out[8] = sz;
  out[9] = uz;
  out[10] = -fz;
  out[11] = 0;
  out[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
  out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
  out[14] = fx * eyeX + fy * eyeY + fz * eyeZ;
  out[15] = 1;
  return out;
}

/** out = a * b. `out` may alias neither input. */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let column = 0; column < 4; column++) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * General 4x4 inverse. Returns null when the matrix is singular.
 *
 * Needed by the grid, which reconstructs a world-space ray per fragment and so
 * needs the inverse of the view-projection.
 */
export function invert(out: Mat4, m: Mat4): Mat4 | null {
  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a03 = m[3];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a13 = m[7];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];
  const a23 = m[11];
  const a30 = m[12];
  const a31 = m[13];
  const a32 = m[14];
  const a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (determinant === 0) return null;
  const inverse = 1 / determinant;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverse;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverse;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverse;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverse;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverse;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverse;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverse;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverse;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverse;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverse;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverse;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverse;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverse;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverse;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverse;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverse;
  return out;
}

/** Transforms a point by a matrix, writing x, y, z, w into `out`. */
export function transformPoint(
  out: Float32Array | Float64Array,
  m: Mat4,
  x: number,
  y: number,
  z: number,
): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
}

/**
 * Critically damped exponential approach.
 *
 * Every camera parameter goes through this. It cannot overshoot at any time
 * step, which a mass-spring integration can, and it is frame-rate independent
 * to first order so camera motion does not change character with frame rate.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
