/**
 * @nbody/renderer
 *
 * LANE C owns this package.
 *
 * The Renderer and CameraController contracts in `types.ts` are fixed in
 * Phase 0; the WebGL2 implementation behind them is Lane C's work. The
 * Canvas2D renderer is provisional scaffolding that keeps the app runnable in
 * the meantime, and is meant to be replaced rather than extended.
 */
export { createCanvas2DRenderer, approach } from './canvas2d.ts';
export type { CameraController, Renderer, RendererOptions } from './types.ts';
