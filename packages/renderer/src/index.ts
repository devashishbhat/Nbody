/**
 * @nbody/renderer
 *
 * Hand-written WebGL2. The draw calls needed are few and specific: instanced
 * discs, a handful of line strips, one full-screen grid quad and an optional
 * two-pass bloom. A general scene graph would add bundle weight and per-frame
 * indirection for none of it.
 */
export { Camera } from './camera.ts';
export { createWebGLRenderer, WebGLRenderer } from './webgl-renderer.ts';
export { WebGLUnavailableError, DEFAULT_RENDER_OPTIONS } from './types.ts';
export type {
  CameraController,
  CameraMode,
  RadiusMode,
  RenderOptions,
  Renderer,
  RendererOptions,
} from './types.ts';
export { approach, clamp } from './math.ts';
