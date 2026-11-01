import type { RefState } from './state.ts';

/**
 * Barnes-Hut octree.
 *
 * Direct summation costs O(N^2), measured at 59 ms per force evaluation for
 * N=5000: three and a half times over a 60 Hz frame budget. No constant-factor
 * work closes a gap that large, so the work itself has to shrink. This brings
 * it to O(N log N) by replacing distant clusters with their centre of mass.
 *
 * The opening criterion is `s / d < theta`, where `s` is the node's width and
 * `d` the distance from the body to the node's centre of mass. Smaller theta
 * is more accurate and slower.
 *
 * ## Measured cost
 *
 * At N=5000 the build is 0.6 ms and the traversal is everything else. The
 * traversal is interaction-bound, not memory-bound: the whole tree is about
 * 150 KB and sits in L2, so there are no misses to remove. Packing the
 * traversal fields into one cache line per node, which is what the layout
 * below does, measured neutral. It is kept because it is a reasonable layout,
 * not because it bought anything.
 *
 * That leaves theta as the only real lever, and it is a steep one:
 *
 *   theta 0.3   47 ms    mean relative error 2e-3
 *   theta 0.5   18 ms    mean 6e-3,  worst 6e-2
 *   theta 0.7   10 ms    mean 1.4e-2, worst 2.5e-1
 *   theta 1.0    4.6 ms  mean 3.9e-2, worst 4e-1
 *   direct      59 ms    exact
 *
 * So N=5000 inside a 60 Hz frame needs theta of about 0.7, not the 0.5 that is
 * right for a few hundred bodies. For a cluster being looked at rather than
 * measured, a 1.4% mean error in acceleration is invisible: the collective
 * dynamics is what you see, and that is governed by the aggregate field the
 * tree reproduces well. Presets above a couple of thousand bodies set theta
 * explicitly, and the control is exposed in the UI.
 *
 * ## Layout
 *
 * The fields the traversal reads live interleaved in a single array at a
 * stride of 8 doubles, one 64-byte cache line per node. The child-index table
 * is separate because it is only read when a node opens, and the geometric
 * fields only the build needs are separate too.
 *
 * Node objects and recursion are both avoided in the traversal; it uses an
 * explicit index stack.
 *
 * Centres of mass accumulate during insertion rather than in a second
 * bottom-up pass: each body adds its mass and mass-weighted position to every
 * node on its path down, so one descent per body builds the whole tree.
 *
 * ## Coincident bodies
 *
 * Subdivision stops at MAX_DEPTH. Without that bound two bodies at the same
 * position would subdivide forever, and "same position" is not hypothetical:
 * it is what a merge produces, and what dragging one body onto another
 * produces. Past the limit a leaf keeps its chain and the force loop sums it
 * directly.
 */

/** Children per node. Octree. */
const CHILDREN = 8;

/**
 * Doubles per node in the interleaved traversal array.
 *
 * Eight, so each node occupies exactly one 64-byte cache line.
 */
const NODE_STRIDE = 8;

/** Offsets within a node's slot. */
const COM_X = 0;
const COM_Y = 1;
const COM_Z = 2;
const MASS = 3;
const WIDTH_SQ = 4;
/** Bitmask of present children. 0 means leaf. Held as a double to stay in line. */
const MASK = 5;
/** First body in a leaf, or -1. Also a double, for the same reason. */
const BODY = 6;

/**
 * Deepest subdivision.
 *
 * 24 levels resolves 2^24, about 17 million to one, which across a 30 AU box
 * separates bodies a few hundred kilometres apart.
 */
const MAX_DEPTH = 24;

/**
 * Bodies a leaf may hold before subdividing.
 *
 * One per leaf is the textbook formulation and it is wasteful: it makes a node
 * for every body plus all the internal nodes above them. Bucketing took the
 * N=5000 tree from roughly 20,000 nodes to 2,300 and the build from several
 * milliseconds to 0.6, and summing a handful of bodies in a chain is work the
 * cache handles well.
 */
const LEAF_CAPACITY = 8;

/**
 * Traversal stack size.
 *
 * Depth-first descent through a tree of branching factor 8 never holds more
 * than (8 - 1) * depth + 8 entries, since only one node is expanded at a time.
 */
const STACK_SIZE = (CHILDREN - 1) * MAX_DEPTH + CHILDREN;

export class BarnesHutTree {
  /** Interleaved traversal data, NODE_STRIDE doubles per node. */
  private node = new Float64Array(0);

  /** Child indices, CHILDREN per node. Only read when a node opens. */
  private child = new Int32Array(0);

  /** Geometric centre and half-width. Build only. */
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  private cz = new Float64Array(0);
  private half = new Float64Array(0);

  /** Build only. */
  private depth = new Int32Array(0);
  private bodyCount = new Int32Array(0);

  /** Chains bodies sharing a leaf. -1 terminates. */
  private bodyNext = new Int32Array(0);

  private readonly stack = new Int32Array(STACK_SIZE);

  private nodeCount = 0;
  private capacity = 0;

  /** Nodes in the most recent tree, for the diagnostics readout. */
  get nodes(): number {
    return this.nodeCount;
  }

  private reserve(nodes: number, bodies: number): void {
    if (nodes > this.capacity) {
      const capacity = Math.max(nodes, this.capacity * 2, 64);
      this.node = new Float64Array(capacity * NODE_STRIDE);
      this.child = new Int32Array(capacity * CHILDREN);
      this.cx = new Float64Array(capacity);
      this.cy = new Float64Array(capacity);
      this.cz = new Float64Array(capacity);
      this.half = new Float64Array(capacity);
      this.depth = new Int32Array(capacity);
      this.bodyCount = new Int32Array(capacity);
      this.capacity = capacity;
    }
    if (bodies > this.bodyNext.length) {
      this.bodyNext = new Int32Array(Math.max(bodies, 64));
    }
  }

  /** Doubles the node pool, preserving the tree built so far. */
  private grow(): void {
    const capacity = this.capacity * 2;

    const node = new Float64Array(capacity * NODE_STRIDE);
    node.set(this.node);
    this.node = node;

    const child = new Int32Array(capacity * CHILDREN);
    child.set(this.child);
    this.child = child;

    const copy64 = (old: Float64Array) => {
      const next = new Float64Array(capacity);
      next.set(old);
      return next;
    };
    this.cx = copy64(this.cx);
    this.cy = copy64(this.cy);
    this.cz = copy64(this.cz);
    this.half = copy64(this.half);

    const copy32 = (old: Int32Array) => {
      const next = new Int32Array(capacity);
      next.set(old);
      return next;
    };
    this.depth = copy32(this.depth);
    this.bodyCount = copy32(this.bodyCount);

    this.capacity = capacity;
  }

  private newNode(cx: number, cy: number, cz: number, half: number, depth: number): number {
    if (this.nodeCount >= this.capacity) this.grow();
    const n = this.nodeCount++;

    const base = n * NODE_STRIDE;
    this.node[base + COM_X] = 0;
    this.node[base + COM_Y] = 0;
    this.node[base + COM_Z] = 0;
    this.node[base + MASS] = 0;
    this.node[base + WIDTH_SQ] = 4 * half * half;
    this.node[base + MASK] = 0;
    this.node[base + BODY] = -1;

    this.cx[n] = cx;
    this.cy[n] = cy;
    this.cz[n] = cz;
    this.half[n] = half;
    this.depth[n] = depth;
    this.bodyCount[n] = 0;
    return n;
  }

  /** Index of the child octant containing a point. */
  private octantOf(node: number, x: number, y: number, z: number): number {
    return (
      (x >= this.cx[node] ? 1 : 0) | (y >= this.cy[node] ? 2 : 0) | (z >= this.cz[node] ? 4 : 0)
    );
  }

  /** Returns the child node for an octant, creating it if absent. */
  private childNode(node: number, octant: number): number {
    const mask = this.node[node * NODE_STRIDE + MASK];
    const bit = 1 << octant;
    if ((mask & bit) !== 0) {
      return this.child[node * CHILDREN + octant];
    }

    const q = this.half[node] * 0.5;
    const created = this.newNode(
      this.cx[node] + (octant & 1 ? q : -q),
      this.cy[node] + (octant & 2 ? q : -q),
      this.cz[node] + (octant & 4 ? q : -q),
      q,
      this.depth[node] + 1,
    );
    // `grow` may have replaced the arrays, so index the live ones.
    this.child[node * CHILDREN + octant] = created;
    this.node[node * NODE_STRIDE + MASK] = mask | bit;
    return created;
  }

  /** Builds the tree for the state's current positions. */
  build(state: RefState): void {
    const n = state.count;
    this.reserve(Math.max(1, Math.ceil(n / 2)), n);
    this.nodeCount = 0;
    if (n === 0) return;

    const { x, y, z, mass } = state;

    // The root is a cube, not a bounding box: octant subdivision has to stay
    // isotropic or the s/d criterion becomes direction dependent.
    let minX = x[0];
    let maxX = x[0];
    let minY = y[0];
    let maxY = y[0];
    let minZ = z[0];
    let maxZ = z[0];
    for (let i = 1; i < n; i++) {
      if (x[i] < minX) minX = x[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i];
      if (y[i] > maxY) maxY = y[i];
      if (z[i] < minZ) minZ = z[i];
      if (z[i] > maxZ) maxZ = z[i];
    }

    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    // Non-zero even when every body is coincident, so the geometry stays well
    // defined. The slight inflation keeps the extreme bodies strictly inside
    // the root rather than exactly on a face.
    const half = span > 0 ? span * 0.5 * 1.0000001 : 1;

    this.newNode((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5, half, 0);

    for (let i = 0; i < n; i++) this.bodyNext[i] = -1;
    for (let i = 0; i < n; i++) this.insert(i, x[i], y[i], z[i], mass[i], state);

    // Turn accumulated mass-weighted positions into centres of mass.
    const data = this.node;
    for (let node = 0; node < this.nodeCount; node++) {
      const base = node * NODE_STRIDE;
      const m = data[base + MASS];
      if (m > 0) {
        data[base + COM_X] /= m;
        data[base + COM_Y] /= m;
        data[base + COM_Z] /= m;
      } else {
        // A wholly massless subtree still needs a defined distance for the
        // opening criterion. Its contribution is zero either way.
        data[base + COM_X] = this.cx[node];
        data[base + COM_Y] = this.cy[node];
        data[base + COM_Z] = this.cz[node];
      }
    }
  }

  /**
   * Inserts one body, accumulating into every node on its path.
   *
   * Each node is visited exactly once per insertion, so mass accumulates
   * exactly once per node. Overflowing a leaf redistributes its whole chain
   * one level down, which is why the inserted body is already placed by the
   * time `split` returns.
   */
  private insert(
    index: number,
    px: number,
    py: number,
    pz: number,
    m: number,
    state: RefState,
  ): void {
    const data = this.node;
    let node = 0;

    for (;;) {
      const base = node * NODE_STRIDE;
      data[base + MASS] += m;
      data[base + COM_X] += m * px;
      data[base + COM_Y] += m * py;
      data[base + COM_Z] += m * pz;

      if (data[base + MASK] === 0) {
        this.bodyNext[index] = data[base + BODY];
        data[base + BODY] = index;
        this.bodyCount[node]++;

        if (this.bodyCount[node] > LEAF_CAPACITY && this.depth[node] < MAX_DEPTH) {
          this.split(node, state);
        }
        return;
      }

      node = this.childNode(node, this.octantOf(node, px, py, pz));
    }
  }

  /**
   * Redistributes an overflowing leaf's bodies one level down.
   *
   * Recurses when every body lands in the same octant, which is the normal
   * case for a tight cluster. MAX_DEPTH bounds the recursion, so a stack of
   * coincident bodies stops subdividing and stays a chain instead.
   */
  private split(node: number, state: RefState): void {
    const { x, y, z, mass } = state;
    const data = this.node;
    const base = node * NODE_STRIDE;

    let j = data[base + BODY];
    data[base + BODY] = -1;
    this.bodyCount[node] = 0;

    while (j !== -1) {
      const next = this.bodyNext[j];

      const bx = x[j];
      const by = y[j];
      const bz = z[j];
      const bm = mass[j];

      const child = this.childNode(node, this.octantOf(node, bx, by, bz));
      const childBase = child * NODE_STRIDE;
      this.node[childBase + MASS] += bm;
      this.node[childBase + COM_X] += bm * bx;
      this.node[childBase + COM_Y] += bm * by;
      this.node[childBase + COM_Z] += bm * bz;

      this.bodyNext[j] = this.node[childBase + BODY];
      this.node[childBase + BODY] = j;
      this.bodyCount[child]++;

      j = next;
    }

    const mask = this.node[node * NODE_STRIDE + MASK];
    const childBase = node * CHILDREN;
    for (let k = 0; k < CHILDREN; k++) {
      if ((mask & (1 << k)) === 0) continue;
      const child = this.child[childBase + k];
      if (this.bodyCount[child] > LEAF_CAPACITY && this.depth[child] < MAX_DEPTH) {
        this.split(child, state);
      }
    }
  }

  /**
   * Writes accelerations for the current positions into `state.ax/ay/az`.
   *
   * Rebuilds the tree, so callers do not. Allocates nothing after the first
   * call at a given body count.
   */
  accelerations(state: RefState, G: number, softening: number, theta: number): void {
    this.build(state);

    const n = state.count;
    const { x, y, z, mass, ax, ay, az, locked } = state;
    ax.fill(0, 0, n);
    ay.fill(0, 0, n);
    az.fill(0, 0, n);
    if (n === 0) return;

    const eps2 = softening * softening;
    const thetaSq = theta * theta;
    const stack = this.stack;
    const data = this.node;
    const child = this.child;
    const bodyNext = this.bodyNext;

    for (let i = 0; i < n; i++) {
      // Locked bodies exert force but do not receive it, so their rows stay
      // zero and their traversal is skipped entirely.
      if (locked[i] !== 0) continue;

      const xi = x[i];
      const yi = y[i];
      const zi = z[i];

      let sx = 0;
      let sy = 0;
      let sz = 0;

      let top = 0;
      stack[top++] = 0;

      while (top > 0) {
        const node = stack[--top];
        const base = node * NODE_STRIDE;

        const nodeMass = data[base + MASS];
        if (nodeMass === 0) continue;

        const dx = data[base + COM_X] - xi;
        const dy = data[base + COM_Y] - yi;
        const dz = data[base + COM_Z] - zi;
        const d2 = dx * dx + dy * dy + dz * dz;

        // s/d < theta, squared to avoid a square root. d2 of zero means the
        // body sits on its own subtree's centre of mass, which must open.
        if (data[base + WIDTH_SQ] < thetaSq * d2) {
          const r2 = d2 + eps2;
          const invR = 1 / Math.sqrt(r2);
          const s = G * nodeMass * invR * invR * invR;
          sx += s * dx;
          sy += s * dy;
          sz += s * dz;
          continue;
        }

        const mask = data[base + MASK];

        if (mask === 0) {
          // Leaf: sum its body chain directly, skipping self-interaction.
          for (let j = data[base + BODY]; j !== -1; j = bodyNext[j]) {
            if (j === i) continue;
            const ddx = x[j] - xi;
            const ddy = y[j] - yi;
            const ddz = z[j] - zi;
            const r2 = ddx * ddx + ddy * ddy + ddz * ddz + eps2;
            if (r2 === 0) continue;
            const invR = 1 / Math.sqrt(r2);
            const s = G * mass[j] * invR * invR * invR;
            sx += s * ddx;
            sy += s * ddy;
            sz += s * ddz;
          }
          continue;
        }

        const childBase = node * CHILDREN;
        for (let k = 0; k < CHILDREN; k++) {
          if ((mask & (1 << k)) !== 0) stack[top++] = child[childBase + k];
        }
      }

      ax[i] = sx;
      ay[i] = sy;
      az[i] = sz;
    }
  }
}
