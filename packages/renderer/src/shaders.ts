/**
 * GLSL ES 3.0 sources.
 *
 * Kept as strings in one file so the whole shading model can be read in one
 * place, and so the renderer logic is not interleaved with it.
 */

/** Pixel offsets must become clip-space offsets, which needs the w term. */
const SCREEN_OFFSET = /* glsl */ `
vec4 offsetByPixels(vec4 clip, vec2 pixels, vec2 viewport) {
  return clip + vec4(pixels * 2.0 / viewport * clip.w, 0.0, 0.0);
}
`;

/**
 * Bodies.
 *
 * One instanced draw call for every body. The disc is an analytic signed
 * distance field evaluated in the fragment shader, so it stays perfectly round
 * and perfectly antialiased at any zoom, which a textured sprite does not, and
 * it costs no texture fetch.
 *
 * Bodies are shaded as spheres rather than filled as discs. The billboard's
 * surface normal is recovered from the fragment's position within the disc,
 * which costs one square root and gives a correct terminator, a lit rim, and
 * limb darkening on the star. It is the difference between a diagram and
 * something that looks like it is in space.
 *
 * Size mapping is in the vertex shader because it depends on the projected
 * depth. `pixelsPerWorld = proj11 * viewportHeight / (2 * clip.w)` happens to
 * be correct for both projections: in orthographic, clip.w is 1 and proj11 is
 * 1/halfHeight, which reduces to the constant scale; in perspective, clip.w is
 * the eye distance, giving the usual falloff. One formula, both cameras.
 */
export const BODY_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aCenter;
layout(location = 2) in float aRadius;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aSelected;
layout(location = 5) in float aEmissive;

uniform mat4 uViewProjection;
uniform mat4 uView;
uniform vec2 uViewport;
uniform float uProj11;

/** Render-space position of the system's star. */
uniform vec3 uLightPosition;
/** 0 when the system has no dominant mass to light it. */
uniform float uShading;

uniform int uRadiusMode;
uniform float uMinPx;
uniform float uUniformPx;
uniform float uLogMinPx;
uniform float uLogMaxPx;
uniform float uLogMinRadius;
uniform float uLogRadiusRange;

out vec2 vOffsetPx;
out vec3 vColor;
out float vRadiusPx;
out float vSelected;
out float vEmissive;
/** Direction to the star, in view space, where the billboard's normal lives. */
out vec3 vLightDir;

${SCREEN_OFFSET}

void main() {
  vec4 clip = uViewProjection * vec4(aCenter, 1.0);
  float pixelsPerWorld = uProj11 * uViewport.y / (2.0 * max(clip.w, 1e-9));
  float truePx = aRadius * pixelsPerWorld;

  float px;
  if (uRadiusMode == 0) {
    px = truePx;
  } else if (uRadiusMode == 2) {
    px = uUniformPx;
  } else {
    // Map the scenario's radius range onto a legible pixel range, then let the
    // true size win once it is larger. At solar-system zoom every physical
    // radius is far below one pixel, so a mode tied to true size can only show
    // identical dots; this keeps the hierarchy visible while still resolving
    // into a real disc when you zoom in.
    float t = clamp(
      (log(max(aRadius, 1e-30)) - uLogMinRadius) / max(uLogRadiusRange, 1e-6),
      0.0,
      1.0
    );
    px = max(mix(uLogMinPx, uLogMaxPx, t), truePx);
  }

  px = max(px, uMinPx);
  if (aSelected > 0.5) px = max(px, uMinPx * 1.6);
  vRadiusPx = px;

  // Room for the glow and, when selected, the ring outside it.
  float extent = px * 1.8 + 4.0 + aSelected * 6.0;
  vOffsetPx = aCorner * extent;
  vColor = aColor;
  vSelected = aSelected;
  vEmissive = aEmissive;

  // The billboard's surface normal is expressed in view space, so the light
  // direction has to be too. Only the rotation of the view matrix matters for
  // a direction, which is what mat3 takes.
  vec3 toLight = uLightPosition - aCenter;
  float reach = length(toLight);
  // The star is at its own centre, so normalising there would be a division by
  // zero. It is drawn emissive anyway and never reads this.
  vLightDir = reach > 0.0 ? normalize(mat3(uView) * toLight) : vec3(0.0, 0.0, 1.0);

  gl_Position = offsetByPixels(clip, vOffsetPx, uViewport);
}
`;

export const BODY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vOffsetPx;
in vec3 vColor;
in float vRadiusPx;
in float vSelected;
in float vEmissive;
in vec3 vLightDir;

uniform vec3 uSelectionColor;
uniform float uShading;

out vec4 outColor;

void main() {
  float d = length(vOffsetPx);

  // One-pixel antialiasing, independent of zoom because the distance is
  // already in pixels.
  float disc = 1.0 - smoothstep(vRadiusPx - 0.75, vRadiusPx + 0.75, d);

  // Position on the disc, which for a camera-facing billboard is also the
  // sphere's surface: a unit disc maps to the visible hemisphere, with the
  // normal's z recovered from the other two components. This is what turns a
  // flat circle into something that reads as a ball.
  vec2 p = vOffsetPx / max(vRadiusPx, 0.001);
  float r2 = min(dot(p, p), 1.0);
  vec3 normal = vec3(p, sqrt(1.0 - r2));

  vec3 surface;
  float glowStrength;

  if (uShading < 0.5 || vEmissive > 0.5) {
    // A star, or a system with no dominant mass to light it. Stars are not
    // lit from outside, but they are not flat either: a real one is dimmer
    // toward the edge, because there you look obliquely through the
    // photosphere and see a cooler, higher layer. The usual linear limb
    // darkening law is enough to read as a sphere rather than a disc.
    float mu = normal.z;
    float limb = uShading < 0.5 ? 1.0 : 0.62 + 0.38 * mu;
    surface = vColor * limb;
    glowStrength = 0.30;
  } else {
    // Lit from the star. The terminator is the single strongest cue that
    // these are spheres in space rather than circles on a screen.
    float lambert = max(dot(normal, vLightDir), 0.0);

    // Ambient, because a pure black night side on a body a few pixels across
    // reads as a bite taken out of the disc rather than as shadow. Higher
    // than physical realism would suggest for the same reason: at this scale
    // legibility and plausibility are both served by letting the dark side
    // stay faintly visible.
    float lit = 0.14 + 0.86 * lambert;

    // A bright edge where the surface turns away from the camera but still
    // faces the star, which is what makes a lit sphere look like one.
    float rim = pow(1.0 - normal.z, 3.5) * lambert * 0.5;

    surface = vColor * lit + vColor * rim;
    // Planets are not light sources. Giving them the same halo as a star is
    // most of what made every body look like a glowing dot.
    glowStrength = 0.10;
  }

  // A short exponential halo. Scaled by the body's own size so a star glows
  // and a pebble does not, and floored so the smallest bodies stay visible.
  float falloff = max(vRadiusPx * 0.55, 1.2);
  float glow = exp(-max(d - vRadiusPx, 0.0) / falloff) * glowStrength;

  float alpha = clamp(disc + glow, 0.0, 1.0);
  vec3 color = surface * disc + vColor * glow * 0.85;

  if (vSelected > 0.5) {
    float ringRadius = vRadiusPx + 4.0;
    float ring = 1.0 - smoothstep(0.8, 1.8, abs(d - ringRadius));
    color += uSelectionColor * ring;
    alpha = clamp(alpha + ring * 0.9, 0.0, 1.0);
  }

  if (alpha < 0.002) discard;
  outColor = vec4(color * alpha, alpha);
}
`;

/**
 * Trails.
 *
 * A line strip per tracked body, read out of a ring buffer. Positions are
 * absolute f32, not camera-relative, because a trail outlives any particular
 * camera position and rewriting the whole history every frame to re-anchor it
 * would cost more than it saves. The resulting precision floor is about two
 * metres at 30 AU, which only becomes visible at a zoom where the body's own
 * disc is millions of pixels across.
 *
 * Age comes from the sample's sequence number against the current head, so
 * fading needs no per-frame rewrite of the buffer.
 */
export const TRAIL_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aSequence;

uniform mat4 uViewProjection;
uniform vec3 uOrigin;
uniform float uHead;
uniform float uSamples;
uniform float uFadeEnabled;

out float vAge;

void main() {
  gl_Position = uViewProjection * vec4(aPosition - uOrigin, 1.0);
  float age = clamp((uHead - aSequence) / max(uSamples, 1.0), 0.0, 1.0);
  vAge = mix(0.0, age, uFadeEnabled);
}
`;

export const TRAIL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in float vAge;

uniform vec3 uColor;
uniform float uOpacity;

out vec4 outColor;

void main() {
  // Slightly faster than linear, so the recent path reads as the subject and
  // the old path as context.
  float alpha = pow(1.0 - vAge, 1.7) * uOpacity;
  if (alpha < 0.004) discard;
  outColor = vec4(uColor * alpha, alpha);
}
`;

/**
 * Reference grid.
 *
 * A single full-screen quad. The fragment shader reconstructs a world-space
 * ray from the inverse view-projection and intersects it with the z = 0 plane,
 * which works unchanged in both camera modes and gives a correct horizon in
 * perspective for free.
 *
 * Cell size is chosen per fragment from `fwidth`, which is the actual world
 * distance covered by one pixel there. That makes the grid scale-free: it
 * snaps to whichever power of ten keeps cells near 90 pixels, and cross-fades
 * between decades so zooming never pops. Most of what makes an astronomical
 * scale legible is this plus the scale bar.
 */
export const GRID_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

out vec2 vNdc;

void main() {
  vNdc = aCorner;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

export const GRID_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vNdc;

uniform mat4 uInverseViewProjection;
uniform vec2 uOrigin;
uniform vec3 uLineColor;
uniform vec3 uAxisColor;
uniform float uOpacity;

out vec4 outColor;

const float LOG10 = 0.4342944819032518;
const float TARGET_PIXELS_PER_CELL = 90.0;

float log10f(float x) {
  return log(x) * LOG10;
}

/** Coverage of the nearest grid line, antialiased to one pixel. */
float gridCoverage(vec2 coord, float cell) {
  vec2 scaled = coord / cell;
  vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), 1e-12);
  return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
}

void main() {
  vec4 near = uInverseViewProjection * vec4(vNdc, -1.0, 1.0);
  vec4 far = uInverseViewProjection * vec4(vNdc, 1.0, 1.0);
  near /= near.w;
  far /= far.w;

  vec3 direction = far.xyz - near.xyz;
  if (abs(direction.z) < 1e-12) discard;

  float t = -near.z / direction.z;
  // Behind the camera, or beyond the far plane: there is no ground there.
  if (t < 0.0 || t > 1.0) discard;

  vec2 world = near.xy + direction.xy * t + uOrigin;

  float pixelSpan = max(max(fwidth(world.x), fwidth(world.y)), 1e-30);
  float decades = log10f(pixelSpan * TARGET_PIXELS_PER_CELL);
  float lowerDecade = floor(decades);
  float blend = decades - lowerDecade;

  float fine = pow(10.0, lowerDecade);
  float coarse = fine * 10.0;

  // The fine grid fades out as it approaches the pixel limit and the coarse
  // one takes over, so there is never a frame where lines appear or vanish.
  float coverage = max(gridCoverage(world, fine) * (1.0 - blend), gridCoverage(world, coarse));

  // The two principal axes, drawn a little stronger than the grid.
  vec2 axisDistance = abs(world) / max(fwidth(world), 1e-30);
  float axis = 1.0 - min(min(axisDistance.x, axisDistance.y), 1.0);

  vec3 color = mix(uLineColor, uAxisColor, axis);
  float alpha = max(coverage * uOpacity, axis * uOpacity * 2.2);

  // Fade toward the horizon in perspective, where cells compress into noise.
  alpha *= 1.0 - smoothstep(0.75, 1.0, t);

  if (alpha < 0.003) discard;
  outColor = vec4(color * alpha, alpha);
}
`;

/** Plain coloured lines, for the overlays. */
export const LINE_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 uViewProjection;

out vec4 vColor;

void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
  vColor = aColor;
}
`;

export const LINE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;

out vec4 outColor;

void main() {
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}
`;

/** Shared full-screen quad vertex stage for the post-processing passes. */
export const POST_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

out vec2 vUv;

void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

/**
 * Bright pass.
 *
 * Keeps only what is brighter than the threshold, so the bloom is a halo
 * around stars rather than a general haze over the whole frame.
 */
export const BRIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSource;
uniform float uThreshold;

out vec4 outColor;

void main() {
  vec3 color = texture(uSource, vUv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float keep = max(luminance - uThreshold, 0.0) / max(luminance, 1e-5);
  outColor = vec4(color * keep, 1.0);
}
`;

/** Separable Gaussian. Run once horizontally, once vertically. */
export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSource;
uniform vec2 uDirection;

out vec4 outColor;

const float WEIGHTS[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
  vec3 sum = texture(uSource, vUv).rgb * WEIGHTS[0];
  for (int i = 1; i < 5; i++) {
    vec2 offset = uDirection * float(i);
    sum += texture(uSource, vUv + offset).rgb * WEIGHTS[i];
    sum += texture(uSource, vUv - offset).rgb * WEIGHTS[i];
  }
  outColor = vec4(sum, 1.0);
}
`;

/** Composites the scene with the blurred highlights. */
export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uIntensity;

out vec4 outColor;

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  outColor = vec4(scene + bloom * uIntensity, 1.0);
}
`;
