import { WebGLUnavailableError } from './types.ts';

/**
 * Minimal WebGL2 helpers.
 *
 * Deliberately small. The renderer draws instanced points, a few line strips,
 * one full-screen quad and an optional two-pass blur; a scene graph would add
 * bundle weight and per-frame indirection for none of that.
 */

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    // The simulation is the only thing on screen and it is opaque, so there is
    // nothing to preserve between frames. Antialiasing is off because bodies
    // are antialiased analytically in the fragment shader, which is both
    // sharper and cheaper than multisampling the whole frame.
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new WebGLUnavailableError();
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    // Numbered, because a shader compile error without line numbers is
    // genuinely painful to locate.
    const numbered = source
      .split('\n')
      .map((line, index) => `${String(index + 1).padStart(3)} | ${line}`)
      .join('\n');
    throw new Error(`${kind} shader failed to compile: ${log}\n${numbered}`);
  }
  return shader;
}

export interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Record<string, WebGLUniformLocation | null>;
  readonly attributes: Record<string, number>;
}

/**
 * Compiles, links, and resolves every uniform and attribute location up front.
 *
 * Resolving by name once rather than per frame matters: `getUniformLocation`
 * is a string lookup that can force a pipeline flush in some drivers.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('failed to create program');

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`program failed to link: ${log}`);
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    // Array uniforms report as `name[0]`; store them under the bare name.
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }

  const attributes: Record<string, number> = {};
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < attributeCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    if (!info) continue;
    attributes[info.name] = gl.getAttribLocation(program, info.name);
  }

  return { program, uniforms, attributes };
}

/** A growable GPU buffer backed by a typed array. */
export class DynamicBuffer {
  readonly buffer: WebGLBuffer;

  private readonly gl: WebGL2RenderingContext;
  private readonly target: number;
  private readonly usage: number;
  private capacityBytes = 0;

  constructor(gl: WebGL2RenderingContext, target?: number, usage?: number) {
    this.gl = gl;
    this.target = target ?? gl.ARRAY_BUFFER;
    this.usage = usage ?? gl.DYNAMIC_DRAW;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('failed to create buffer');
    this.buffer = buffer;
  }

  /**
   * Uploads `length` elements from `data`.
   *
   * Reallocates only when the buffer has to grow, so a steady-state frame is a
   * single `bufferSubData` with no driver-side allocation.
   */
  upload(data: Float32Array, length = data.length): void {
    const gl = this.gl;
    const bytes = length * 4;
    gl.bindBuffer(this.target, this.buffer);
    if (bytes > this.capacityBytes) {
      // Over-allocate so that a slowly growing scenario does not reallocate
      // every frame.
      this.capacityBytes = Math.max(bytes * 2, 1024);
      gl.bufferData(this.target, this.capacityBytes, this.usage);
    }
    gl.bufferSubData(this.target, 0, data, 0, length);
  }

  /** Allocates without uploading, for buffers written in pieces. */
  reserve(bytes: number): void {
    const gl = this.gl;
    if (bytes <= this.capacityBytes) return;
    this.capacityBytes = bytes;
    gl.bindBuffer(this.target, this.buffer);
    gl.bufferData(this.target, bytes, this.usage);
  }

  /** Writes a sub-range. Requires `reserve` to have covered it. */
  uploadRange(byteOffset: number, data: Float32Array, length = data.length): void {
    const gl = this.gl;
    gl.bindBuffer(this.target, this.buffer);
    gl.bufferSubData(this.target, byteOffset, data, 0, length);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.buffer);
  }
}

/** A colour render target, for the bloom passes. */
export class RenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width = 0;
  height = 0;

  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    if (!framebuffer || !texture) throw new Error('failed to create render target');
    this.framebuffer = framebuffer;
    this.texture = texture;
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}

/** Parses `#rrggbb` into linear-ish float components. */
export function parseColor(hex: string, out: Float32Array, offset = 0): void {
  const value = Number.parseInt(hex.slice(1), 16);
  out[offset] = ((value >> 16) & 0xff) / 255;
  out[offset + 1] = ((value >> 8) & 0xff) / 255;
  out[offset + 2] = (value & 0xff) / 255;
}
