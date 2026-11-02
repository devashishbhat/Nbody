import {
  dominantBody,
  sampleOrbit,
  type FrameSample,
  type Scenario,
  type Vec3,
} from '@nbody/protocol';
import { Camera } from './camera.ts';
import {
  createContext,
  createProgram,
  DynamicBuffer,
  parseColor,
  RenderTarget,
  type Program,
} from './gl.ts';
import {
  BLUR_FRAGMENT,
  BODY_FRAGMENT,
  BODY_VERTEX,
  BRIGHT_FRAGMENT,
  COMPOSITE_FRAGMENT,
  GRID_FRAGMENT,
  GRID_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  POST_VERTEX,
  TRAIL_FRAGMENT,
  TRAIL_VERTEX,
} from './shaders.ts';
import {
  DEFAULT_RENDER_OPTIONS,
  type RenderOptions,
  type Renderer,
  type RendererOptions,
} from './types.ts';

/**
 * WebGL2 renderer.
 *
 * Draw order is grid, trails, bodies, overlays, which is also back to front.
 * Depth testing is off throughout: every body is a screen-facing disc with a
 * soft halo, so blending them in draw order looks right, and sorting several
 * thousand instances per frame to get strict 3D occlusion between dots that
 * rarely overlap would cost more than it could possibly show.
 *
 * Blending is premultiplied alpha, which is what the halo needs in order to
 * add rather than wash out what it sits on.
 *
 * The draw path allocates nothing. Every buffer is sized on `setScenario` or
 * on resize, and the per-frame work is writing into them. See
 * docs/CONTRACTS.md.
 */

/** Bodies that may carry a trail. */
const MAX_TRAILS = 64;

/** Samples retained per trail. */
const TRAIL_SAMPLES = 512;

/** Floats per trail vertex: x, y, z, sequence. */
const TRAIL_STRIDE = 4;

/** Floats per body instance: centre, radius, colour, selected. */
const BODY_STRIDE = 8;

/** Floats per overlay line vertex: position, rgba. */
const LINE_STRIDE = 7;

/** Points sampled along a predicted orbit. */
const ORBIT_SAMPLES = 192;

/** Smallest a body may be drawn, so nothing ever becomes invisible. */
const MIN_BODY_PIXELS = 2.2;

/** Pixel range the log radius mode maps a scenario's radii onto. */
const LOG_MIN_PIXELS = 2.6;
const LOG_MAX_PIXELS = 13;

const UNIFORM_PIXELS = 3.2;

/** Bloom works at quarter resolution; the blur hides the difference. */
const BLOOM_DIVISOR = 4;
const BLOOM_THRESHOLD = 0.35;
const BLOOM_INTENSITY = 0.75;

interface Trail {
  /** Index of this trail's block in the shared vertex buffer. */
  slot: number;
  /** Total samples ever written, which drives both the ring and the fading. */
  written: number;
  lastSimTime: number;
  color: Float32Array;
}

export class WebGLRenderer implements Renderer {
  readonly camera = new Camera();

  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;

  private renderOptions: RenderOptions;

  private readonly bodyProgram: Program;
  private readonly trailProgram: Program;
  private readonly gridProgram: Program;
  private readonly lineProgram: Program;
  private readonly brightProgram: Program;
  private readonly blurProgram: Program;
  private readonly compositeProgram: Program;

  private readonly quadBuffer: WebGLBuffer;
  private readonly bodyBuffer: DynamicBuffer;
  private readonly trailBuffer: DynamicBuffer;
  private readonly lineBuffer: DynamicBuffer;

  private readonly bodyVao: WebGLVertexArrayObject;
  private readonly trailVao: WebGLVertexArrayObject;
  private readonly gridVao: WebGLVertexArrayObject;
  private readonly lineVao: WebGLVertexArrayObject;

  private readonly sceneTarget: RenderTarget;
  private readonly bloomPing: RenderTarget;
  private readonly bloomPong: RenderTarget;

  /** Per-instance data, rewritten each frame. */
  private bodyData = new Float32Array(0);
  /** One trail vertex, reused for every append. */
  private readonly trailVertex = new Float32Array(TRAIL_STRIDE);
  private lineData = new Float32Array(0);
  private lineVertexCount = 0;

  private readonly orbitSamples = new Float64Array(ORBIT_SAMPLES * 3);

  /** Appearance per body, indexed by the slot the scenario listed it in. */
  private scenarioColors = new Float32Array(0);
  private scenarioRadii = new Float64Array(0);
  private scenarioTrails: boolean[] = [];
  private scenarioMasses = new Float64Array(0);
  private scenario: Scenario | null = null;

  /** Handle to scenario index, rebuilt whenever the body set changes. */
  private handleToIndex = new Map<number, number>();
  private trails = new Map<number, Trail>();
  private freeTrailSlots: number[] = [];
  private lastTopologyVersion = -1;

  private logMinRadius = 0;
  private logRadiusRange = 1;

  private width = 1;
  private height = 1;
  private lastDrawMs = 0;

  private lastSample: FrameSample | null = null;
  private readonly projected = new Float64Array(2);
  private readonly primaryPosition: [number, number, number] = [0, 0, 0];
  private readonly primaryVelocity: [number, number, number] = [0, 0, 0];
  private readonly bodyPosition: [number, number, number] = [0, 0, 0];
  private readonly bodyVelocity: [number, number, number] = [0, 0, 0];

  private readonly gridLineColor = new Float32Array([0.55, 0.58, 0.68]);
  private readonly gridAxisColor = new Float32Array([0.72, 0.76, 0.88]);
  private readonly selectionColor = new Float32Array([0.95, 0.97, 1]);

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.gl = createContext(options.canvas);
    this.renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options.options };

    const gl = this.gl;

    this.bodyProgram = createProgram(gl, BODY_VERTEX, BODY_FRAGMENT);
    this.trailProgram = createProgram(gl, TRAIL_VERTEX, TRAIL_FRAGMENT);
    this.gridProgram = createProgram(gl, GRID_VERTEX, GRID_FRAGMENT);
    this.lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.brightProgram = createProgram(gl, POST_VERTEX, BRIGHT_FRAGMENT);
    this.blurProgram = createProgram(gl, POST_VERTEX, BLUR_FRAGMENT);
    this.compositeProgram = createProgram(gl, POST_VERTEX, COMPOSITE_FRAGMENT);

    // A single unit quad, reused by the instanced bodies and every full-screen
    // pass. Two triangles as a strip.
    const quad = gl.createBuffer();
    if (!quad) throw new Error('failed to create quad buffer');
    this.quadBuffer = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.bodyBuffer = new DynamicBuffer(gl);
    this.trailBuffer = new DynamicBuffer(gl);
    this.lineBuffer = new DynamicBuffer(gl);

    this.bodyVao = this.createBodyVao();
    this.trailVao = this.createTrailVao();
    this.gridVao = this.createQuadVao();
    this.lineVao = this.createLineVao();

    this.sceneTarget = new RenderTarget(gl);
    this.bloomPing = new RenderTarget(gl);
    this.bloomPong = new RenderTarget(gl);

    // The trail buffer is a fixed size, so it can be allocated once. Doubled,
    // so that any window of TRAIL_SAMPLES consecutive samples is contiguous
    // and a wrapped ring still draws as one line strip.
    this.trailBuffer.reserve(MAX_TRAILS * TRAIL_SAMPLES * 2 * TRAIL_STRIDE * 4);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  get options(): Readonly<RenderOptions> {
    return this.renderOptions;
  }

  setOptions(next: Partial<RenderOptions>): void {
    this.renderOptions = { ...this.renderOptions, ...next };
  }

  private createQuadVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('failed to create vertex array');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private createBodyVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('failed to create vertex array');
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const stride = BODY_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuffer.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  private createTrailVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('failed to create vertex array');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuffer.buffer);
    const stride = TRAIL_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  private createLineVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('failed to create vertex array');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer.buffer);
    const stride = LINE_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
    const count = scenario.bodies.length;

    this.scenarioColors = new Float32Array(count * 3);
    this.scenarioRadii = new Float64Array(count);
    this.scenarioMasses = new Float64Array(count);
    this.scenarioTrails = new Array(count);

    let minRadius = Number.POSITIVE_INFINITY;
    let maxRadius = 0;
    for (let i = 0; i < count; i++) {
      const body = scenario.bodies[i]!;
      parseColor(body.color, this.scenarioColors, i * 3);
      this.scenarioRadii[i] = body.radius;
      this.scenarioMasses[i] = body.mass;
      this.scenarioTrails[i] = body.trail ?? false;
      if (body.radius > 0) {
        if (body.radius < minRadius) minRadius = body.radius;
        if (body.radius > maxRadius) maxRadius = body.radius;
      }
    }

    // The log mode maps [minRadius, maxRadius] onto a pixel range. A scenario
    // whose bodies are all the same size gets a nominal decade so the mapping
    // stays finite.
    if (!Number.isFinite(minRadius) || maxRadius === 0) {
      minRadius = 1;
      maxRadius = 10;
    } else if (maxRadius / minRadius < 1.0001) {
      maxRadius = minRadius * 10;
    }
    this.logMinRadius = Math.log(minRadius);
    this.logRadiusRange = Math.log(maxRadius) - this.logMinRadius;

    this.bodyData = new Float32Array(Math.max(count, 1) * BODY_STRIDE);
    this.lineData = new Float32Array((count * 2 + ORBIT_SAMPLES * 2) * LINE_STRIDE);

    this.trails.clear();
    this.freeTrailSlots = Array.from({ length: MAX_TRAILS }, (_, i) => MAX_TRAILS - 1 - i);
    this.handleToIndex.clear();
    this.lastTopologyVersion = -1;

    const camera = scenario.camera;
    this.camera.snapTo(
      camera?.target[0] ?? 0,
      camera?.target[1] ?? 0,
      camera?.target[2] ?? 0,
      camera?.distance ?? 1,
      camera?.mode ?? '2d',
    );
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const drawWidth = Math.round(this.width * devicePixelRatio);
    const drawHeight = Math.round(this.height * devicePixelRatio);
    this.canvas.width = drawWidth;
    this.canvas.height = drawHeight;

    this.camera.setViewport(this.width, this.height);
    this.sceneTarget.resize(drawWidth, drawHeight);
    this.bloomPing.resize(drawWidth / BLOOM_DIVISOR, drawHeight / BLOOM_DIVISOR);
    this.bloomPong.resize(drawWidth / BLOOM_DIVISOR, drawHeight / BLOOM_DIVISOR);
  }

  /**
   * Pairs handles with scenario entries.
   *
   * Handles are assigned sequentially in scenario body order on load, so when
   * the counts agree the pairing is positional. When they do not, the body set
   * has changed under us and the existing map is kept for handles that are
   * still present, which keeps colours stable through a merge.
   */
  private syncHandles(sample: FrameSample): void {
    if (sample.topologyVersion === this.lastTopologyVersion) return;
    this.lastTopologyVersion = sample.topologyVersion;

    if (this.scenario && sample.count === this.scenario.bodies.length) {
      this.handleToIndex.clear();
      for (let i = 0; i < sample.count; i++) {
        this.handleToIndex.set(sample.handles[i]!, i);
      }
    }

    // Retire trails whose body is gone, returning their slots.
    const live = new Set<number>();
    for (let i = 0; i < sample.count; i++) live.add(sample.handles[i]!);
    for (const [handle, trail] of this.trails) {
      if (!live.has(handle)) {
        this.freeTrailSlots.push(trail.slot);
        this.trails.delete(handle);
      }
    }
  }

  draw(sample: FrameSample, nowMs: number): void {
    const gl = this.gl;
    const dt = this.lastDrawMs === 0 ? 0 : Math.min(0.1, (nowMs - this.lastDrawMs) / 1000);
    this.lastDrawMs = nowMs;

    this.lastSample = sample;
    this.syncHandles(sample);

    // A followed body moves the camera target before the easing runs, so the
    // follow is itself damped rather than rigid.
    const followed = this.camera.following;
    if (followed !== 0) {
      const slot = this.slotOfHandle(sample, followed);
      if (slot >= 0) {
        const d = slot * 3;
        this.camera.trackFollowed(
          sample.positions[d]!,
          sample.positions[d + 1]!,
          sample.positions[d + 2]!,
        );
      }
    }

    this.camera.update(this.renderOptions.reducedMotion ? 1 : dt);

    if (this.renderOptions.showTrails) this.updateTrails(sample);

    const target = this.renderOptions.bloom && !this.renderOptions.reducedMotion;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? this.sceneTarget.framebuffer : null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.031, 0.031, 0.039, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.renderOptions.showGrid) this.drawGrid();
    if (this.renderOptions.showTrails) this.drawTrails();
    this.drawBodies(sample);
    this.drawOverlays(sample);

    if (target) this.drawBloom();
  }

  private slotOfHandle(sample: FrameSample, handle: number): number {
    for (let i = 0; i < sample.count; i++) {
      if (sample.handles[i] === handle) return i;
    }
    return -1;
  }

  private appearanceIndex(handle: number): number {
    const index = this.handleToIndex.get(handle);
    return index === undefined ? -1 : index;
  }

  private drawGrid(): void {
    const gl = this.gl;
    const program = this.gridProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.gridVao);

    gl.uniformMatrix4fv(
      program.uniforms['uInverseViewProjection']!,
      false,
      this.camera.inverseViewProjection,
    );
    gl.uniform2f(program.uniforms['uOrigin']!, this.camera.originX, this.camera.originY);
    gl.uniform3fv(program.uniforms['uLineColor']!, this.gridLineColor);
    gl.uniform3fv(program.uniforms['uAxisColor']!, this.gridAxisColor);
    gl.uniform1f(program.uniforms['uOpacity']!, 0.1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /** Appends the current position of each tracked body to its ring. */
  private updateTrails(sample: FrameSample): void {
    const simTime = sample.simTime;

    for (let i = 0; i < sample.count; i++) {
      const handle = sample.handles[i]!;
      const index = this.appearanceIndex(handle);
      if (index < 0 || !this.scenarioTrails[index]) continue;

      let trail = this.trails.get(handle);
      if (!trail) {
        const slot = this.freeTrailSlots.pop();
        // More bodies asked for trails than there are slots. The cap exists
        // because WebGL2 has no primitive restart, so each trail is its own
        // draw call; 64 covers every few-body preset, and a large preset reads
        // better by particle density anyway.
        if (slot === undefined) continue;
        trail = {
          slot,
          written: 0,
          lastSimTime: Number.NaN,
          color: this.scenarioColors.subarray(index * 3, index * 3 + 3),
        };
        this.trails.set(handle, trail);
      }

      // Only append when simulation time has actually moved. Otherwise a
      // paused simulation would pile thousands of identical samples into the
      // ring and erase the visible history.
      if (trail.lastSimTime === simTime) continue;
      trail.lastSimTime = simTime;

      const d = i * 3;
      this.trailVertex[0] = sample.positions[d]!;
      this.trailVertex[1] = sample.positions[d + 1]!;
      this.trailVertex[2] = sample.positions[d + 2]!;
      this.trailVertex[3] = trail.written;

      const ring = trail.written % TRAIL_SAMPLES;
      const base = trail.slot * TRAIL_SAMPLES * 2;
      const bytes = TRAIL_STRIDE * 4;
      // Written twice, TRAIL_SAMPLES apart, so a wrapped window stays
      // contiguous and draws as a single strip.
      this.trailBuffer.uploadRange((base + ring) * bytes, this.trailVertex);
      this.trailBuffer.uploadRange((base + ring + TRAIL_SAMPLES) * bytes, this.trailVertex);
      trail.written++;
    }
  }

  private drawTrails(): void {
    if (this.trails.size === 0) return;
    const gl = this.gl;
    const program = this.trailProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.trailVao);

    gl.uniformMatrix4fv(program.uniforms['uViewProjection']!, false, this.camera.viewProjection);
    gl.uniform3f(
      program.uniforms['uOrigin']!,
      this.camera.originX,
      this.camera.originY,
      this.camera.originZ,
    );
    gl.uniform1f(program.uniforms['uSamples']!, TRAIL_SAMPLES);
    gl.uniform1f(program.uniforms['uFadeEnabled']!, this.renderOptions.reducedMotion ? 0 : 1);
    gl.uniform1f(program.uniforms['uOpacity']!, 0.62);

    for (const trail of this.trails.values()) {
      if (trail.written < 2) continue;
      const count = Math.min(trail.written, TRAIL_SAMPLES);
      const last = (trail.written - 1) % TRAIL_SAMPLES;
      const start = trail.slot * TRAIL_SAMPLES * 2 + last + TRAIL_SAMPLES - count + 1;

      gl.uniform3fv(program.uniforms['uColor']!, trail.color);
      gl.uniform1f(program.uniforms['uHead']!, trail.written - 1);
      gl.drawArrays(gl.LINE_STRIP, start, count);
    }

    gl.bindVertexArray(null);
  }

  private drawBodies(sample: FrameSample): void {
    const gl = this.gl;
    const count = sample.count;
    if (count === 0) return;

    if (this.bodyData.length < count * BODY_STRIDE) {
      this.bodyData = new Float32Array(count * BODY_STRIDE);
    }

    const data = this.bodyData;
    const originX = this.camera.originX;
    const originY = this.camera.originY;
    const originZ = this.camera.originZ;
    const selected = this.renderOptions.selectedHandle;

    for (let i = 0; i < count; i++) {
      const d = i * 3;
      const o = i * BODY_STRIDE;
      // f64 subtraction first, then narrow: this is what preserves precision
      // at solar-system scale.
      data[o] = sample.positions[d]! - originX;
      data[o + 1] = sample.positions[d + 1]! - originY;
      data[o + 2] = sample.positions[d + 2]! - originZ;

      const index = this.appearanceIndex(sample.handles[i]!);
      if (index >= 0) {
        data[o + 3] = this.scenarioRadii[index]!;
        data[o + 4] = this.scenarioColors[index * 3]!;
        data[o + 5] = this.scenarioColors[index * 3 + 1]!;
        data[o + 6] = this.scenarioColors[index * 3 + 2]!;
      } else {
        // A body the renderer has not been told about yet, which happens for
        // one frame after it is spawned. Neutral rather than invisible.
        data[o + 3] = 0;
        data[o + 4] = 0.85;
        data[o + 5] = 0.85;
        data[o + 6] = 0.85;
      }
      data[o + 7] = sample.handles[i] === selected ? 1 : 0;
    }

    this.bodyBuffer.upload(data, count * BODY_STRIDE);

    const program = this.bodyProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.bodyVao);

    gl.uniformMatrix4fv(program.uniforms['uViewProjection']!, false, this.camera.viewProjection);
    gl.uniform2f(program.uniforms['uViewport']!, this.width, this.height);
    gl.uniform1f(program.uniforms['uProj11']!, this.camera.projection[5]!);
    gl.uniform1i(
      program.uniforms['uRadiusMode']!,
      this.renderOptions.radiusMode === 'true'
        ? 0
        : this.renderOptions.radiusMode === 'log'
          ? 1
          : 2,
    );
    gl.uniform1f(program.uniforms['uMinPx']!, MIN_BODY_PIXELS);
    gl.uniform1f(program.uniforms['uUniformPx']!, UNIFORM_PIXELS);
    gl.uniform1f(program.uniforms['uLogMinPx']!, LOG_MIN_PIXELS);
    gl.uniform1f(program.uniforms['uLogMaxPx']!, LOG_MAX_PIXELS);
    gl.uniform1f(program.uniforms['uLogMinRadius']!, this.logMinRadius);
    gl.uniform1f(program.uniforms['uLogRadiusRange']!, this.logRadiusRange);
    gl.uniform3fv(program.uniforms['uSelectionColor']!, this.selectionColor);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  private pushLineVertex(
    offset: number,
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): number {
    const data = this.lineData;
    data[offset] = x - this.camera.originX;
    data[offset + 1] = y - this.camera.originY;
    data[offset + 2] = z - this.camera.originZ;
    data[offset + 3] = r;
    data[offset + 4] = g;
    data[offset + 5] = b;
    data[offset + 6] = a;
    return offset + LINE_STRIDE;
  }

  private drawOverlays(sample: FrameSample): void {
    const showVelocities = this.renderOptions.showVelocities;
    const showOrbit = this.renderOptions.showPredictedOrbit;
    const showHandle = this.renderOptions.velocityHandleScale > 0;
    if (!showVelocities && !showOrbit && !showHandle) return;

    const required = (sample.count * 2 + ORBIT_SAMPLES * 2 + 10) * LINE_STRIDE;
    if (this.lineData.length < required) this.lineData = new Float32Array(required);

    let offset = 0;

    if (showVelocities) {
      // Scaled so a typical velocity reads as a visible arrow at the current
      // zoom rather than a pixel or a streak across the viewport.
      const scale = this.camera.distance * 0.18;
      let fastest = 0;
      for (let i = 0; i < sample.count; i++) {
        const d = i * 3;
        const speed = Math.hypot(
          sample.velocities[d]!,
          sample.velocities[d + 1]!,
          sample.velocities[d + 2]!,
        );
        if (speed > fastest) fastest = speed;
      }
      const factor = fastest > 0 ? scale / fastest : 0;

      for (let i = 0; i < sample.count; i++) {
        const d = i * 3;
        const x = sample.positions[d]!;
        const y = sample.positions[d + 1]!;
        const z = sample.positions[d + 2]!;
        offset = this.pushLineVertex(offset, x, y, z, 0.48, 0.64, 0.97, 0.75);
        offset = this.pushLineVertex(
          offset,
          x + sample.velocities[d]! * factor,
          y + sample.velocities[d + 1]! * factor,
          z + sample.velocities[d + 2]! * factor,
          0.48,
          0.64,
          0.97,
          0,
        );
      }
    }

    if (showOrbit && this.renderOptions.selectedHandle !== 0 && this.scenario) {
      offset = this.appendPredictedOrbit(sample, offset);
    }

    if (this.renderOptions.velocityHandleScale > 0) {
      offset = this.appendVelocityHandle(sample, offset);
    }

    this.lineVertexCount = offset / LINE_STRIDE;
    if (this.lineVertexCount < 2) return;

    const gl = this.gl;
    this.lineBuffer.upload(this.lineData, offset);

    const program = this.lineProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.lineVao);
    gl.uniformMatrix4fv(program.uniforms['uViewProjection']!, false, this.camera.viewProjection);
    gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    gl.bindVertexArray(null);
  }

  /**
   * Draws the osculating orbit of the selected body about the dominant mass.
   *
   * The instantaneous two-body orbit it would follow if everything else
   * vanished. For a planet around a star that is very nearly its real path,
   * and it updates the moment a mass or a velocity is dragged, which is what
   * makes editing a parameter instructive rather than merely reactive.
   */
  private appendPredictedOrbit(sample: FrameSample, startOffset: number): number {
    const scenario = this.scenario!;
    const selectedSlot = this.slotOfHandle(sample, this.renderOptions.selectedHandle);
    if (selectedSlot < 0) return startOffset;

    const primarySlot = this.dominantSlot(sample);
    if (primarySlot < 0 || primarySlot === selectedSlot) return startOffset;

    const primaryIndex = this.appearanceIndex(sample.handles[primarySlot]!);
    const selectedIndex = this.appearanceIndex(sample.handles[selectedSlot]!);
    if (primaryIndex < 0 || selectedIndex < 0) return startOffset;

    const p = primarySlot * 3;
    const s = selectedSlot * 3;
    this.primaryPosition[0] = sample.positions[p]!;
    this.primaryPosition[1] = sample.positions[p + 1]!;
    this.primaryPosition[2] = sample.positions[p + 2]!;
    this.primaryVelocity[0] = sample.velocities[p]!;
    this.primaryVelocity[1] = sample.velocities[p + 1]!;
    this.primaryVelocity[2] = sample.velocities[p + 2]!;
    this.bodyPosition[0] = sample.positions[s]!;
    this.bodyPosition[1] = sample.positions[s + 1]!;
    this.bodyPosition[2] = sample.positions[s + 2]!;
    this.bodyVelocity[0] = sample.velocities[s]!;
    this.bodyVelocity[1] = sample.velocities[s + 1]!;
    this.bodyVelocity[2] = sample.velocities[s + 2]!;

    const written = sampleOrbit(
      scenario.G,
      this.scenarioMasses[primaryIndex]!,
      this.scenarioMasses[selectedIndex]!,
      this.primaryPosition as unknown as Vec3,
      this.primaryVelocity as unknown as Vec3,
      this.bodyPosition as unknown as Vec3,
      this.bodyVelocity as unknown as Vec3,
      this.orbitSamples,
      ORBIT_SAMPLES,
    );
    if (written < 2) return startOffset;

    let offset = startOffset;
    const r = this.scenarioColors[selectedIndex * 3]!;
    const g = this.scenarioColors[selectedIndex * 3 + 1]!;
    const b = this.scenarioColors[selectedIndex * 3 + 2]!;

    for (let i = 0; i + 1 < written; i++) {
      const a = i * 3;
      const c = (i + 1) * 3;
      offset = this.pushLineVertex(
        offset,
        this.orbitSamples[a]!,
        this.orbitSamples[a + 1]!,
        this.orbitSamples[a + 2]!,
        r,
        g,
        b,
        0.3,
      );
      offset = this.pushLineVertex(
        offset,
        this.orbitSamples[c]!,
        this.orbitSamples[c + 1]!,
        this.orbitSamples[c + 2]!,
        r,
        g,
        b,
        0.3,
      );
    }
    return offset;
  }

  /**
   * The selected body's velocity as a draggable arrow.
   *
   * Drawn at the scale the interaction layer uses to hit-test it, so what you
   * can grab is exactly what you can see.
   */
  private appendVelocityHandle(sample: FrameSample, startOffset: number): number {
    const slot = this.slotOfHandle(sample, this.renderOptions.selectedHandle);
    if (slot < 0) return startOffset;

    const scale = this.renderOptions.velocityHandleScale;
    const d = slot * 3;
    const x = sample.positions[d]!;
    const y = sample.positions[d + 1]!;
    const z = sample.positions[d + 2]!;
    const tipX = x + sample.velocities[d]! * scale;
    const tipY = y + sample.velocities[d + 1]! * scale;
    const tipZ = z + sample.velocities[d + 2]! * scale;

    let offset = startOffset;
    offset = this.pushLineVertex(offset, x, y, z, 0.95, 0.97, 1, 0.35);
    offset = this.pushLineVertex(offset, tipX, tipY, tipZ, 0.95, 0.97, 1, 0.9);

    // A small cross at the tip, so the grab point is visible rather than
    // implied by the end of a line.
    const arm = Math.hypot(tipX - x, tipY - y, tipZ - z) * 0.045;
    offset = this.pushLineVertex(offset, tipX - arm, tipY, tipZ, 0.95, 0.97, 1, 0.9);
    offset = this.pushLineVertex(offset, tipX + arm, tipY, tipZ, 0.95, 0.97, 1, 0.9);
    offset = this.pushLineVertex(offset, tipX, tipY - arm, tipZ, 0.95, 0.97, 1, 0.9);
    offset = this.pushLineVertex(offset, tipX, tipY + arm, tipZ, 0.95, 0.97, 1, 0.9);
    return offset;
  }

  private dominantSlot(sample: FrameSample): number {
    let best = -1;
    let bestMass = -Infinity;
    for (let i = 0; i < sample.count; i++) {
      const index = this.appearanceIndex(sample.handles[i]!);
      if (index < 0) continue;
      const mass = this.scenarioMasses[index]!;
      if (mass > bestMass) {
        bestMass = mass;
        best = i;
      }
    }
    return best;
  }

  private drawBloom(): void {
    const gl = this.gl;

    // Bright pass into the quarter-resolution ping target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomPing.framebuffer);
    gl.viewport(0, 0, this.bloomPing.width, this.bloomPing.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.brightProgram.program);
    gl.bindVertexArray(this.gridVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(this.brightProgram.uniforms['uSource']!, 0);
    gl.uniform1f(this.brightProgram.uniforms['uThreshold']!, BLOOM_THRESHOLD);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Separable blur: horizontal into pong, vertical back into ping.
    gl.useProgram(this.blurProgram.program);
    gl.uniform1i(this.blurProgram.uniforms['uSource']!, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomPong.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomPing.texture);
    gl.uniform2f(this.blurProgram.uniforms['uDirection']!, 1 / this.bloomPing.width, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomPing.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomPong.texture);
    gl.uniform2f(this.blurProgram.uniforms['uDirection']!, 0, 1 / this.bloomPing.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(this.compositeProgram.uniforms['uScene']!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomPing.texture);
    gl.uniform1i(this.compositeProgram.uniforms['uBloom']!, 1);
    gl.uniform1f(this.compositeProgram.uniforms['uIntensity']!, BLOOM_INTENSITY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
  }

  /**
   * Nearest body to a point, in screen space, on the CPU.
   *
   * Projecting every body costs a matrix multiply each, which at these counts
   * is microseconds and happens only on a click rather than every frame. A GPU
   * picking pass would need a readback, and a readback stalls the pipeline.
   */
  pick(clientX: number, clientY: number): number | null {
    const sample = this.lastSample;
    if (!sample) return null;

    const threshold = 20;
    let best = -1;
    let bestDistance = threshold * threshold;

    for (let i = 0; i < sample.count; i++) {
      const d = i * 3;
      if (
        !this.camera.project(
          sample.positions[d]!,
          sample.positions[d + 1]!,
          sample.positions[d + 2]!,
          this.projected,
        )
      ) {
        continue;
      }
      const dx = this.projected[0]! - clientX;
      const dy = this.projected[1]! - clientY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }

    return best < 0 ? null : best;
  }

  positionOf(slot: number, out: Float64Array): boolean {
    const sample = this.lastSample;
    if (!sample || slot < 0 || slot >= sample.count) return false;
    const d = slot * 3;
    out[0] = sample.positions[d]!;
    out[1] = sample.positions[d + 1]!;
    out[2] = sample.positions[d + 2]!;
    return true;
  }

  /**
   * Scenario index for a handle, or -1.
   *
   * The renderer already maintains this to look up colours and radii, and the
   * interface layer needs it to turn a click into the body the user means.
   */
  indexOfHandle(handle: number): number {
    return this.appearanceIndex(handle);
  }

  /** Handle of a slot in the last drawn sample, or 0. */
  handleOf(slot: number): number {
    const sample = this.lastSample;
    if (!sample || slot < 0 || slot >= sample.count) return 0;
    return sample.handles[slot]!;
  }

  /**
   * Diagnostics, for debugging what the renderer thinks it is drawing.
   *
   * A renderer is hard to inspect from the outside: everything interesting has
   * already been handed to the GPU. This reports the state that decides what
   * gets drawn, which is where the faults actually are.
   */
  debugStats(): {
    trails: number;
    trailSamples: number;
    mappedHandles: number;
    bodies: number;
    radiusMode: string;
  } {
    let trailSamples = 0;
    for (const trail of this.trails.values()) trailSamples += trail.written;
    return {
      trails: this.trails.size,
      trailSamples,
      mappedHandles: this.handleToIndex.size,
      bodies: this.lastSample?.count ?? 0,
      radiusMode: this.renderOptions.radiusMode,
    };
  }

  dispose(): void {
    const gl = this.gl;
    for (const program of [
      this.bodyProgram,
      this.trailProgram,
      this.gridProgram,
      this.lineProgram,
      this.brightProgram,
      this.blurProgram,
      this.compositeProgram,
    ]) {
      gl.deleteProgram(program.program);
    }
    for (const vao of [this.bodyVao, this.trailVao, this.gridVao, this.lineVao]) {
      gl.deleteVertexArray(vao);
    }
    this.bodyBuffer.dispose();
    this.trailBuffer.dispose();
    this.lineBuffer.dispose();
    gl.deleteBuffer(this.quadBuffer);
    this.sceneTarget.dispose();
    this.bloomPing.dispose();
    this.bloomPong.dispose();
    this.trails.clear();
    this.lastSample = null;
  }
}

export function createWebGLRenderer(options: RendererOptions): Renderer {
  return new WebGLRenderer(options);
}

/** Re-exported so the shell can report the dominant body in a readout. */
export { dominantBody };
