# Design

Minimalism here is a constraint on what the interface is allowed to do, not a
style applied afterwards.

## Principles

**The canvas is the subject.** It is full-bleed and nothing letterboxes or
scrolls it. Every panel is an overlay.

**Chrome recedes.** Panels sit at 35% opacity after a few seconds of pointer
inactivity and return to full on movement. The default state of the app is a
simulation running with almost nothing on top of it.

**One accent, and colour belongs to the bodies.** The chrome uses a single
accent (`--accent`). Saturated colour anywhere else competes with the
simulation, which is the thing being read.

**Every number is tabular.** Proportional digits change width as they change
value, which reads as flicker in a readout updating sixty times a second. That
flicker would undo the smoothness the entire architecture exists to protect.
Numbers get `.nb-num`, and formatters in `@nbody/ui` return fixed-width strings
whose width stability is asserted in tests.

**Dark first, light supported.** Near-black (`#08080a`) so the chrome sits
quietly. Light mode via `[data-theme='light']` on the same token set.

## Tokens

`packages/ui/src/tokens.css`. Surfaces, text, lines, accent, semantic colours,
two font stacks, a type scale, a spacing scale, one radius, and the panel fade
timing. Add tokens there rather than hard-coding values in components.

## Layout

| Region              | Contents                                                     |
| ------------------- | ------------------------------------------------------------ |
| Top left            | Preset name, preset switcher, command palette (⌘K)           |
| Bottom centre       | Transport: play/pause, step, reverse, speed, sim clock       |
| Right, collapsible  | Inspector: selected body, or global simulation settings      |
| Bottom right        | Diagnostics: energy drift, momentum, N, ms/step, fps         |

On touch, panels become a bottom sheet.

## Scale

Masses span 1e-7 to 1e6 solar masses and distances span six orders of
magnitude, so:

- Mass gets a **log slider** plus a numeric field, never a linear slider.
- Zoom is **exponential**, anchored at the cursor, so one wheel notch covers the
  same proportion of the scale range at a moon or at the Oort cloud.
- Body size has **three modes**: true scale, log-compressed (so the Sun does not
  render Mercury sub-pixel), and uniform dots. Log-compressed is the sensible
  default for the solar system; true scale is the honest one.
- The reference grid snaps to the nearest power-of-ten decade and is labelled,
  which is most of what makes the scale legible.

## Motion

All camera parameters pass through a critically damped spring and are never
applied directly. The exponential form in `approach()` cannot overshoot at any
frame rate, which a mass-spring integration can. Panning carries inertia.

`prefers-reduced-motion` disables bloom, makes trails fade instantly, and makes
camera springs instant. Panel fades go to zero.

## Accessibility

- Contrast: `--text-primary` on `--surface-0` and `--text-secondary` on panel
  surfaces both clear WCAG AA. `--text-tertiary` is for labels only, never for
  values.
- The body palette must stay distinguishable under deuteranopia and
  protanopia. The fallback palette in `@nbody/protocol` is a starting point,
  not a verified set, and has not been checked against a simulator.
- Every control is keyboard reachable, and the keyboard map is discoverable
  through the command palette rather than only documented.
- Panels are landmarks with labels; readouts carry `aria-live="off"` because
  announcing a sixty-hertz number would be hostile.

## What minimalism does not mean

It does not mean hiding the physics. The energy drift readout, the osculating
orbital elements and the ms/step counter are all kept visible, because the thing
that makes this interesting rather than decorative is that the numbers are real.
