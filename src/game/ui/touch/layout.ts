// src/game/ui/touch/layout.ts (Area J - phone and tablet)
// The touch HUD is solved, not hand-placed. A phone in portrait has about 390 px of width to hold two thumb
// clusters and still show the fight; the old fixed stack overlapped itself there (screens/INDEX.md, note 1).
// So the geometry is a solver: both thumbs get a pivot in their bottom corner, every button is given a bearing off
// its thumb, and it travels out along that bearing until it clears the sticks, the other controls, the safe area,
// the HUD band and the fight window - only sliding around the arc once the bearing itself is exhausted, which is
// what lets a portrait phone hold a straight column up each edge. If a set cannot be placed, the sticks shrink by
// a notch and the whole solve runs again, so the layout degrades by getting smaller rather than by overlapping,
// and past the point where even the smallest sticks help it relaxes preferences one at a time rather than ever
// dropping a control.
//
// Everything here is pure: no DOM, no React, no window. `tests/touch-layout.test.mjs` runs it over a matrix of
// real device viewports and asserts the invariants directly.

import { MIN_TARGET_PX } from "../../input/touch-input.ts";

/** A control's box in CSS pixels, measured from the top-left of the viewport. */
export interface Rect { x: number; y: number; w: number; h: number }

/** A thumb's pivot: where the thumb's root sits and how far it can sweep from there. */
export interface Thumb { x: number; y: number; reach: number }

export interface Viewport {
  width: number;
  height: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
}

export type ControlId = "stance" | "swing" | "grip" | "strike" | "guard" | "overdrive" | "ability";
export type LayoutProfile = "phone-portrait" | "phone-landscape" | "tablet-portrait" | "tablet-landscape";

export interface Placement {
  id: ControlId;
  kind: "stick" | "button";
  side: "left" | "right";
  rect: Rect;
  /** Distance from the owning thumb's pivot to the far corner of the control, for the reach assertion. */
  reachPx: number;
}

export interface TouchLayout {
  profile: LayoutProfile;
  /** Stick diameter the solve settled on; the input mapping reads the live rect, so this is only the size. */
  stickPx: number;
  left: Thumb;
  right: Thumb;
  controls: Placement[];
  /** The part of the screen the fight must keep. No control may enter it. */
  fightWindow: Rect;
  /** Band along the top that the match HUD owns. No control may enter it. */
  hudBand: Rect;
  /** False only if even the smallest stick could not seat every control; the layout is still overlap-free. */
  fits: boolean;
}

/** Clear space kept between any two controls, and between a control and a stick. */
export const CONTROL_GAP = 12;
/** The house slant. A plate is skewed by this, so the ink it lays down is wider than the box it was given. */
export const SLANT_DEG = 12;
/** A plate's hard offset shadow, and the distance it travels down when pressed. Both hang below the box. */
export const PLATE_DROP_PX = 6;
/** Smallest stick the solver will fall back to before it gives up. */
export const MIN_STICK_PX = 104;
/**
 * Angles the solver may try, in order, as an offset on a slot's designed angle. The designed angle is first and is
 * tried at every radius before the next one is considered, so a roomy screen gets the layout exactly as drawn and
 * a cramped one slides a control a few degrees around its thumb's arc rather than dropping it on top of something.
 */
const ANGLE_FAN: readonly number[] = [0, 10, -10, 20, -20, 32, -32, 45, -45, 60, -60];

interface Slot {
  id: ControlId;
  side: "left" | "right";
  /** Degrees counter-clockwise from screen-right, around the thumb pivot. 90 is straight up the edge. */
  angle: number;
  /** Where the walk starts: 1 on the first arc off the stick, 2 a button-height further out. It is a floor, not a
   * position - a ring-2 control keeps walking until it clears whatever ring 1 actually put in its way. */
  ring: 1 | 2;
  /** Multiplier on the base button size. STRIKE is the one control you must never miss. */
  scale: number;
  /** True for controls that only exist once the arcade kit is unlocked. */
  kit: boolean;
}

interface Profile {
  /** Button width as a multiple of the base size; portrait phones have no width to spare, so they stay square. */
  aspect: number;
  /** Base button size as a fraction of the viewport's short edge. */
  btnScale: number;
  /** Stick diameter cap as a fraction of the viewport height. */
  stickHeightCap: number;
  /** Clear channel kept between the two sticks, as a fraction of the width. */
  channel: number;
  /** Strip along the top the match HUD owns. A landscape phone wears a shallower bar than a portrait one. */
  hudBand: number;
  /** The fight window's left edge and width, as fractions of the viewport width. */
  fightX: number;
  fightW: number;
  /** The fight window's bottom edge, as a fraction of the viewport height. */
  fightBottom: number;
  slots: readonly Slot[];
}

// Placement order is crowding order: the swing thumb carries three buttons and gets first pick of its arc, then
// the stance thumb fills in around whatever is left.
//
// A portrait phone is 360 to 430 px wide and the two thumbs already own both bottom corners, so anything sent
// around the arc lands in the middle of the fight - which is the failure the phone capture caught. So portrait
// does not fan: each thumb gets a column straight up its own edge (90 degrees is the edge), and the one control
// that cannot fit a column - the kit's ABILITY, which would need a third ring past the thumb's reach - drops into
// the channel between the two pads, along the bottom edge. Nothing ever crosses the middle of the screen.
const COLUMN_SLOTS: readonly Slot[] = [
  { id: "strike", side: "right", angle: 90, ring: 1, scale: 1.26, kit: false },
  { id: "guard", side: "right", angle: 90, ring: 2, scale: 1, kit: false },
  { id: "ability", side: "right", angle: 162, ring: 1, scale: 1, kit: true },
  { id: "grip", side: "left", angle: 90, ring: 1, scale: 1, kit: false },
  { id: "overdrive", side: "left", angle: 90, ring: 2, scale: 1, kit: true },
];

// Every other shape of screen is a different room. A landscape phone is twice as wide as a thumb can sweep and a
// tablet is wider still, so the arc never approaches the centre and the controls can fan the way a pad does: up
// the edge, then around and inboard along the bottom.
const FAN_SLOTS: readonly Slot[] = [
  { id: "strike", side: "right", angle: 94, ring: 1, scale: 1.26, kit: false },
  { id: "guard", side: "right", angle: 145, ring: 1, scale: 1, kit: false },
  { id: "ability", side: "right", angle: 118, ring: 2, scale: 1, kit: true },
  { id: "grip", side: "left", angle: 86, ring: 1, scale: 1, kit: false },
  { id: "overdrive", side: "left", angle: 36, ring: 1, scale: 1, kit: true },
];

const PROFILES: Readonly<Record<LayoutProfile, Profile>> = {
  "phone-portrait": {
    aspect: 1, btnScale: 0.152, stickHeightCap: 0.26, channel: 0.3,
    // 0.52 rather than a rounder number: it is the line at which a 375 px iPhone SE can still stack GUARD above
    // STRIKE up the right edge instead of being pushed out over the middle of the screen. The controls sit far
    // below it on a taller phone, so nothing but the smallest devices ever feels this.
    hudBand: 84, fightX: 0.24, fightW: 0.52, fightBottom: 0.52, slots: COLUMN_SLOTS,
  },
  "phone-landscape": {
    aspect: 1.26, btnScale: 0.15, stickHeightCap: 0.3, channel: 0.17,
    hudBand: 64, fightX: 0.28, fightW: 0.44, fightBottom: 0.64, slots: FAN_SLOTS,
  },
  "tablet-portrait": {
    aspect: 1.26, btnScale: 0.095, stickHeightCap: 0.22, channel: 0.26,
    hudBand: 96, fightX: 0.26, fightW: 0.48, fightBottom: 0.62, slots: FAN_SLOTS,
  },
  "tablet-landscape": {
    aspect: 1.26, btnScale: 0.11, stickHeightCap: 0.28, channel: 0.2,
    hudBand: 84, fightX: 0.28, fightW: 0.44, fightBottom: 0.66, slots: FAN_SLOTS,
  },
};

/** A phone held either way, or a tablet: the short edge decides, because the thumb does not grow with the screen. */
export function profileFor(width: number, height: number): LayoutProfile {
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  if (tablet) return landscape ? "tablet-landscape" : "tablet-portrait";
  return landscape ? "phone-landscape" : "phone-portrait";
}

/**
 * How far a thumb sweeps from its pivot, in CSS pixels. It tracks the short edge of the device, not the long one
 * and not the diagonal: a 13-inch tablet does not come with a longer thumb, so the reach is capped.
 */
export function thumbReach(width: number, height: number): number {
  return clamp(Math.round(0.68 * Math.min(width, height)), 150, 300);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The box a control actually paints, which is not the box it was solved into: a plate is skewed by SLANT_DEG, so
 * its corners hang past both sides, and it carries a hard shadow under it that a pressed plate drops onto. The
 * solver collides on these, because a layout where two boxes clear each other and their ink does not is exactly
 * the overlap a player sees.
 */
export function visualRect(p: { rect: Rect; kind: "stick" | "button" }): Rect {
  if (p.kind !== "button") return p.rect;
  const skew = Math.ceil((Math.tan((SLANT_DEG * Math.PI) / 180) * p.rect.h) / 2);
  return { x: p.rect.x - skew, y: p.rect.y, w: p.rect.w + 2 * skew, h: p.rect.h + PLATE_DROP_PX };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Shortest distance from a point to a rect's nearest edge, or 0 when the point is inside it. */
export function distanceToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Far corner of a rect as seen from a point: the worst case the thumb has to reach. */
export function farCornerDistance(px: number, py: number, r: Rect): number {
  const dx = Math.max(Math.abs(r.x - px), Math.abs(r.x + r.w - px));
  const dy = Math.max(Math.abs(r.y - py), Math.abs(r.y + r.h - py));
  return Math.hypot(dx, dy);
}

function centredRect(cx: number, cy: number, w: number, h: number): Rect {
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

/**
 * Solves the layout for one viewport. The stick starts at the player's preferred size and steps down until every
 * control finds a seat, so the same code covers a 360 px phone and a 1366 px tablet without a breakpoint per device.
 */
export function solveTouchLayout(vp: Viewport, opts: { stickRadiusPx: number; kit: boolean }): TouchLayout {
  const profile = profileFor(vp.width, vp.height);
  const p = PROFILES[profile];

  const edgeL = Math.max(16, vp.safeLeft);
  const edgeR = Math.max(16, vp.safeRight);
  const edgeB = Math.max(18, vp.safeBottom + 10);
  const hudTop = Math.max(12, vp.safeTop);

  const hudBand: Rect = { x: 0, y: 0, w: vp.width, h: hudTop + p.hudBand };
  // Below the HUD and above the thumbs: the band the arms actually fight in.
  const fightWindow: Rect = {
    x: Math.round(vp.width * p.fightX),
    y: hudBand.h,
    w: Math.round(vp.width * p.fightW),
    h: Math.max(0, Math.round(vp.height * p.fightBottom) - hudBand.h),
  };
  const box: Rect = {
    x: edgeL, y: hudBand.h,
    w: Math.max(0, vp.width - edgeL - edgeR),
    h: Math.max(0, vp.height - hudBand.h - edgeB),
  };

  const reach = thumbReach(vp.width, vp.height);
  const base = clamp(Math.round(p.btnScale * Math.min(vp.width, vp.height)), MIN_TARGET_PX, 78);
  const channel = Math.round(vp.width * p.channel);
  const widthCap = Math.floor((vp.width - edgeL - edgeR - channel) / 2);
  // A stick is only as big as the thumb that has to get past it: the outer ring of buttons sits a stick radius, a
  // button and two gaps out from the pivot, and all of that has to stay inside the sweep. On a tablet this is the
  // cap that bites - the screen is huge and the thumb is not.
  const outerW = Math.max(MIN_TARGET_PX, Math.round(base * p.aspect));
  const reachCap = opts.kit
    ? 2 * (reach - 2 * CONTROL_GAP - Math.hypot(outerW, base) / 2 - base)
    : Number.POSITIVE_INFINITY;
  const startStick = Math.floor(clamp(
    Math.min(opts.stickRadiusPx * 2, widthCap, Math.round(vp.height * p.stickHeightCap), reachCap),
    MIN_STICK_PX, 260,
  ));

  // Largest stick first, stepping down until one solves cleanly. If none does, the fallback is the last attempt
  // rather than the first: the smallest sticks leave the most room, so that is the layout that had to give up the
  // least to seat everything.
  let best: TouchLayout | null = null;
  for (let stick = startStick; stick >= MIN_STICK_PX; stick -= 4) {
    const attempt = seat(stick);
    if (attempt.fits) return attempt;
    best = attempt;
  }
  return best ?? seat(MIN_STICK_PX);

  function seat(stickPx: number): TouchLayout {
    const half = stickPx / 2;
    const left: Thumb = { x: edgeL + half, y: vp.height - edgeB - half, reach };
    const right: Thumb = { x: vp.width - edgeR - half, y: vp.height - edgeB - half, reach };

    const stanceRect = centredRect(left.x, left.y, stickPx, stickPx);
    const swingRect = centredRect(right.x, right.y, stickPx, stickPx);
    const placed: Placement[] = [
      { id: "stance", kind: "stick", side: "left", rect: stanceRect, reachPx: farCornerDistance(left.x, left.y, stanceRect) },
      { id: "swing", kind: "stick", side: "right", rect: swingRect, reachPx: farCornerDistance(right.x, right.y, swingRect) },
    ];

    let fits = rectInside(stanceRect, box) && rectInside(swingRect, box)
      && !rectsOverlap(stanceRect, swingRect, CONTROL_GAP)
      && !rectsOverlap(stanceRect, fightWindow) && !rectsOverlap(swingRect, fightWindow);

    /**
     * Walks one slot's bearing outward, then fans around it. The angle is the outer loop and the radius the inner
     * one, so a control travels the whole length of its designed bearing before it agrees to slide around the arc:
     * that is what keeps a column a column, with GUARD climbing past STRIKE up the same edge rather than taking
     * the nearer seat ten degrees inboard. 2 px steps - a finer seat than that is invisible under a thumb.
     *
     * Every test runs against the ink the control lays down, not the box it was handed, so a skewed plate's
     * corners and the shadow under it are part of what has to clear. `relax` drops one preference per level:
     * 1 lets a control sit over the fight window, 2 lets it sit past the thumb's sweep, 3 lets it sit nearer the
     * other thumb. Nothing ever relaxes the safe area, the other controls, or the two wells.
     */
    function search(slot: Slot, w: number, h: number, pivot: Thumb, ringStart: number, relax: number): Rect | null {
      const maxR = relax >= 2 ? Math.hypot(box.w, box.h) : reach;
      for (const fan of ANGLE_FAN) {
        for (let r = Math.ceil(ringStart); r <= maxR; r += 2) {
          const rad = ((slot.angle + (slot.side === "left" ? -fan : fan)) * Math.PI) / 180;
          const rect = centredRect(pivot.x + r * Math.cos(rad), pivot.y - r * Math.sin(rad), w, h);
          const ink = visualRect({ rect, kind: "button" });
          if (!rectInside(ink, box)) continue;
          if (distanceToRect(left.x, left.y, ink) < half + CONTROL_GAP) continue;
          if (distanceToRect(right.x, right.y, ink) < half + CONTROL_GAP) continue;
          if (placed.some((q) => rectsOverlap(ink, visualRect(q), q.kind === "button" ? CONTROL_GAP : 0))) continue;
          if (relax < 1 && rectsOverlap(ink, fightWindow)) continue;
          // The thumb has to actually get there. Measured to the far corner, because a control you can only touch
          // one edge of is a control you will miss mid-exchange.
          if (relax < 2 && farCornerDistance(pivot.x, pivot.y, rect) > reach) continue;
          if (relax < 3) {
            // A control has to stay nearer the thumb that owns it, or the wrong hand goes for it.
            const own = slot.side === "left" ? left : right;
            const other = slot.side === "left" ? right : left;
            if (distanceToRect(own.x, own.y, ink) >= distanceToRect(other.x, other.y, ink)) continue;
          }
          return rect;
        }
      }
      return null;
    }

    for (const slot of p.slots) {
      if (slot.kit && !opts.kit) continue;
      const w = Math.max(MIN_TARGET_PX, Math.round(base * slot.scale * p.aspect));
      const h = Math.max(MIN_TARGET_PX, Math.round(base * slot.scale));
      const pivot = slot.side === "left" ? left : right;
      const ringStart = half + CONTROL_GAP + Math.hypot(w, h) / 2 + (slot.ring === 2 ? base + CONTROL_GAP : 0);
      // Radius is the outer loop and the angle fan the inner one, so a control seats as close to the thumb as it
      // can and only slides around the arc when the near seat is taken.
      // Three of the constraints are preferences and three are not. A control that will not fit inside the safe
      // area, clear of the other controls and clear of both wells cannot be drawn at all - but a control that only
      // fails to keep off the fight window, or to stay inside the thumb's sweep, is still better on screen than
      // missing. So the search relaxes one preference per pass, and the layout reports itself as degraded rather
      // than handing a phone a fight with no GUARD button.
      let seated: Rect | null = null;
      let relax = 0;
      for (; relax <= 3 && !seated; relax++) seated = search(slot, w, h, pivot, ringStart, relax);
      if (!seated) { fits = false; continue; }
      if (relax > 1) fits = false;
      placed.push({ id: slot.id, kind: "button", side: slot.side, rect: seated, reachPx: farCornerDistance(pivot.x, pivot.y, seated) });
    }

    return { profile, stickPx, left, right, controls: placed, fightWindow, hudBand, fits };
  }
}

/** The solved rect for one control, or null when the kit is locked and the control is not on screen. */
export function controlRect(layout: TouchLayout, id: ControlId): Rect | null {
  return layout.controls.find((c) => c.id === id)?.rect ?? null;
}
