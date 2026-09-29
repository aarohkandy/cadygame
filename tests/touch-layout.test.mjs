// Area J: the solved touch layout. The phone capture in docs/design/screens/INDEX.md (note 1) failed because the
// controls were placed by hand and 390 px of width could not hold them; these tests assert the invariants that
// failure violated - nothing overlaps, nothing is clipped, nothing sits on the fight - over a matrix of real
// devices, both orientations, kit locked and unlocked, and both ends of the stick-size setting.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTROL_GAP, MIN_STICK_PX,
  controlRect, distanceToRect, farCornerDistance, profileFor, rectInside, rectsOverlap, solveTouchLayout, thumbReach,
  visualRect,
} from "../src/game/ui/touch/layout.ts";
import { MIN_TARGET_PX } from "../src/game/input/touch-input.ts";

const NO_SAFE = { safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 };

/** Real viewports: iPhone 12/13/14, iPhone SE, iPhone 15 Pro Max, Pixel, iPad mini, iPad Pro 11. */
const DEVICES = [
  { name: "iPhone 13 portrait", width: 390, height: 844, safeTop: 47, safeRight: 0, safeBottom: 34, safeLeft: 0 },
  { name: "iPhone 13 landscape", width: 844, height: 390, safeTop: 0, safeRight: 47, safeBottom: 21, safeLeft: 47 },
  { name: "iPhone SE portrait", width: 375, height: 667, ...NO_SAFE },
  { name: "iPhone SE landscape", width: 667, height: 375, ...NO_SAFE },
  { name: "iPhone 15 Pro Max portrait", width: 430, height: 932, safeTop: 59, safeRight: 0, safeBottom: 34, safeLeft: 0 },
  { name: "Pixel 7 portrait", width: 412, height: 915, safeTop: 24, safeRight: 0, safeBottom: 24, safeLeft: 0 },
  { name: "small Android portrait", width: 360, height: 640, ...NO_SAFE },
  { name: "iPad mini portrait", width: 744, height: 1133, safeTop: 24, safeRight: 0, safeBottom: 20, safeLeft: 0 },
  { name: "iPad Pro 11 landscape", width: 1194, height: 834, safeTop: 24, safeRight: 0, safeBottom: 20, safeLeft: 0 },
  { name: "iPad Pro 11 portrait", width: 834, height: 1194, safeTop: 24, safeRight: 0, safeBottom: 20, safeLeft: 0 },
];

const STICK_PREFS = [56, 96, 160];   // the ends and the default of controls.touch.stickRadiusPx

function every(fn) {
  for (const vp of DEVICES) {
    for (const kit of [false, true]) {
      for (const stickRadiusPx of STICK_PREFS) {
        const layout = solveTouchLayout(vp, { stickRadiusPx, kit });
        fn(layout, vp, { kit, stickRadiusPx, where: `${vp.name} kit=${kit} r=${stickRadiusPx}` });
      }
    }
  }
}

describe("touch layout", () => {
  test("every device seats every control", () => {
    every((layout, vp, ctx) => {
      assert.equal(layout.fits, true, `${ctx.where}: no seating found`);
      const ids = layout.controls.map((c) => c.id).sort();
      const want = ctx.kit
        ? ["ability", "grip", "guard", "overdrive", "stance", "strike", "swing"]
        : ["grip", "guard", "stance", "strike", "swing"];
      assert.deepEqual(ids, want, ctx.where);
      assert.ok(layout.stickPx >= MIN_STICK_PX, `${ctx.where}: stick ${layout.stickPx}`);
    });
  });

  test("nothing overlaps anything else", () => {
    every((layout, vp, ctx) => {
      const c = layout.controls;
      for (let i = 0; i < c.length; i++) {
        for (let j = i + 1; j < c.length; j++) {
          assert.equal(
            rectsOverlap(c[i].rect, c[j].rect), false,
            `${ctx.where}: ${c[i].id} ${JSON.stringify(c[i].rect)} overlaps ${c[j].id} ${JSON.stringify(c[j].rect)}`,
          );
        }
      }
    });
  });

  // The boxes clearing each other is not the same as the paint clearing: a plate is skewed 12 degrees and drops a
  // hard shadow, so it covers more of the screen than it was allotted. The player sees the paint.
  test("the ink each control lays down clears too, and stays on screen", () => {
    every((layout, vp, ctx) => {
      const safe = {
        x: Math.max(16, vp.safeLeft),
        y: layout.hudBand.h,
        w: vp.width - Math.max(16, vp.safeLeft) - Math.max(16, vp.safeRight),
        h: vp.height - layout.hudBand.h - Math.max(18, vp.safeBottom + 10),
      };
      const ink = layout.controls.map((c) => ({ id: c.id, r: visualRect(c) }));
      for (let i = 0; i < ink.length; i++) {
        assert.equal(rectInside(ink[i].r, safe), true, `${ctx.where}: ${ink[i].id} paints outside the safe area`);
        assert.equal(rectsOverlap(ink[i].r, layout.fightWindow), false, `${ctx.where}: ${ink[i].id} paints over the fight`);
        for (let j = i + 1; j < ink.length; j++) {
          assert.equal(rectsOverlap(ink[i].r, ink[j].r), false, `${ctx.where}: ${ink[i].id} paints over ${ink[j].id}`);
        }
      }
    });
  });

  test("a control is always nearer the thumb that owns it than the other thumb", () => {
    every((layout, vp, ctx) => {
      for (const c of layout.controls) {
        if (c.kind !== "button") continue;
        const own = c.side === "left" ? layout.left : layout.right;
        const other = c.side === "left" ? layout.right : layout.left;
        const ink = visualRect(c);
        assert.ok(
          distanceToRect(own.x, own.y, ink) < distanceToRect(other.x, other.y, ink),
          `${ctx.where}: ${c.id} is nearer the wrong thumb`,
        );
      }
    });
  });

  test("buttons keep a finger's clearance from each other and from both sticks", () => {
    every((layout, vp, ctx) => {
      const buttons = layout.controls.filter((c) => c.kind === "button");
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          assert.equal(
            rectsOverlap(buttons[i].rect, buttons[j].rect, CONTROL_GAP - 1), false,
            `${ctx.where}: ${buttons[i].id} is closer than ${CONTROL_GAP}px to ${buttons[j].id}`,
          );
        }
        const half = layout.stickPx / 2;
        for (const thumb of [layout.left, layout.right]) {
          const d = distanceToRect(thumb.x, thumb.y, buttons[i].rect);
          assert.ok(d >= half + CONTROL_GAP - 1, `${ctx.where}: ${buttons[i].id} sits ${d.toFixed(1)}px from a stick centre`);
        }
      }
    });
  });

  test("nothing is clipped: every control is inside the safe area and below the HUD band", () => {
    every((layout, vp, ctx) => {
      const safe = {
        x: Math.max(16, vp.safeLeft),
        y: layout.hudBand.h,
        w: vp.width - Math.max(16, vp.safeLeft) - Math.max(16, vp.safeRight),
        h: vp.height - layout.hudBand.h - Math.max(18, vp.safeBottom + 10),
      };
      assert.ok(layout.hudBand.h > Math.max(12, vp.safeTop), `${ctx.where}: the HUD band ignores the status bar`);
      for (const c of layout.controls) {
        assert.equal(rectInside(c.rect, safe), true, `${ctx.where}: ${c.id} ${JSON.stringify(c.rect)} escapes ${JSON.stringify(safe)}`);
        assert.equal(rectsOverlap(c.rect, layout.hudBand), false, `${ctx.where}: ${c.id} runs under the HUD`);
      }
    });
  });

  test("the fight stays visible: no control enters the centre window", () => {
    every((layout, vp, ctx) => {
      assert.ok(layout.fightWindow.w > 0 && layout.fightWindow.h > 0, ctx.where);
      for (const c of layout.controls) {
        assert.equal(rectsOverlap(c.rect, layout.fightWindow), false, `${ctx.where}: ${c.id} covers the fight`);
      }
    });
  });

  test("every target is at least 44 px and every control is inside its own thumb's sweep", () => {
    every((layout, vp, ctx) => {
      for (const c of layout.controls) {
        assert.ok(c.rect.w >= MIN_TARGET_PX && c.rect.h >= MIN_TARGET_PX, `${ctx.where}: ${c.id} is ${c.rect.w}x${c.rect.h}`);
        const thumb = c.side === "left" ? layout.left : layout.right;
        assert.equal(c.reachPx, farCornerDistance(thumb.x, thumb.y, c.rect), `${ctx.where}: ${c.id} reach is stale`);
        if (c.kind === "button") {
          assert.ok(c.reachPx <= thumb.reach, `${ctx.where}: ${c.id} is ${c.reachPx.toFixed(0)}px out, past a ${thumb.reach}px thumb`);
        }
      }
    });
  });

  test("the thumbs own the bottom corners and GUARD and REACH stay on them", () => {
    every((layout, vp, ctx) => {
      const stance = controlRect(layout, "stance");
      const swing = controlRect(layout, "swing");
      // REACH is the stance stick's own vertical axis, so the left thumb never leaves home to reach.
      assert.ok(stance.x < vp.width / 2 && swing.x > vp.width / 2, ctx.where);
      assert.ok(stance.y + stance.h > vp.height * 0.55, `${ctx.where}: the stance stick left the bottom corner`);
      assert.ok(swing.y + swing.h > vp.height * 0.55, `${ctx.where}: the swing stick left the bottom corner`);
      // GUARD belongs to the swing thumb: it has to be closer to the right pivot than to the left one.
      const guard = controlRect(layout, "guard");
      const dRight = distanceToRect(layout.right.x, layout.right.y, guard);
      const dLeft = distanceToRect(layout.left.x, layout.left.y, guard);
      assert.ok(dRight < dLeft, `${ctx.where}: GUARD is nearer the stance thumb`);
    });
  });

  // The fix for the phone capture: on a portrait phone there is no width to fan into, so each thumb's buttons
  // stack straight up its own edge over its own pad, and only the kit's ABILITY drops into the channel between
  // the pads. A 360 px screen is allowed to fall back to the arc - it degrades, it does not overlap.
  test("a portrait phone stacks each thumb's buttons up its own edge", () => {
    for (const vp of DEVICES.filter((d) => d.height > d.width && d.width < 600 && d.width >= 375)) {
      const layout = solveTouchLayout(vp, { stickRadiusPx: 96, kit: true });
      for (const id of ["strike", "guard", "grip", "overdrive"]) {
        const c = layout.controls.find((q) => q.id === id);
        const thumb = c.side === "left" ? layout.left : layout.right;
        const drift = Math.abs(c.rect.x + c.rect.w / 2 - thumb.x);
        assert.ok(drift <= 2, `${vp.name}: ${id} sits ${drift.toFixed(0)}px off its thumb's column`);
      }
      // ABILITY is the exception, and it belongs on the bottom edge rather than out over the fight.
      const ability = controlRect(layout, "ability");
      assert.ok(
        ability.y + ability.h > layout.right.y - layout.stickPx / 2,
        `${vp.name}: ABILITY floated off the bottom edge`,
      );
    }
  });

  test("STRIKE is the biggest target on the screen", () => {
    every((layout, vp, ctx) => {
      const strike = controlRect(layout, "strike");
      for (const c of layout.controls) {
        if (c.kind !== "button" || c.id === "strike") continue;
        assert.ok(strike.w * strike.h > c.rect.w * c.rect.h, `${ctx.where}: ${c.id} is bigger than STRIKE`);
      }
    });
  });

  test("safe-area insets push the whole layout inboard rather than under the notch", () => {
    const bare = solveTouchLayout({ width: 844, height: 390, ...NO_SAFE }, { stickRadiusPx: 96, kit: true });
    const notched = solveTouchLayout(
      { width: 844, height: 390, safeTop: 0, safeRight: 47, safeBottom: 21, safeLeft: 47 },
      { stickRadiusPx: 96, kit: true },
    );
    assert.ok(notched.left.x > bare.left.x, "the stance thumb moved clear of the left inset");
    assert.ok(notched.right.x < bare.right.x, "the swing thumb moved clear of the right inset");
    assert.ok(notched.left.y < bare.left.y, "the thumbs lifted clear of the home indicator");
  });

  test("the stick honours the size setting where it fits and shrinks where it would not", () => {
    const vp = { width: 390, height: 844, safeTop: 47, safeRight: 0, safeBottom: 34, safeLeft: 0 };
    const small = solveTouchLayout(vp, { stickRadiusPx: 56, kit: true });
    const large = solveTouchLayout(vp, { stickRadiusPx: 160, kit: true });
    assert.equal(small.stickPx, 112, "a 56 px radius fits as asked");
    assert.ok(large.stickPx > small.stickPx, "asking for more gives more");
    // 160 px of radius is 320 px of stick: two of them cannot share a 390 px phone, so the solve caps it.
    assert.ok(large.stickPx < 320, `capped to ${large.stickPx}`);
    assert.ok(large.stickPx * 2 + Math.round(390 * 0.3) <= 390, "the two sticks keep a channel between them");
  });

  test("profiles follow the short edge, and the thumb does not grow with the screen", () => {
    assert.equal(profileFor(390, 844), "phone-portrait");
    assert.equal(profileFor(844, 390), "phone-landscape");
    assert.equal(profileFor(834, 1194), "tablet-portrait");
    assert.equal(profileFor(1194, 834), "tablet-landscape");
    assert.equal(thumbReach(390, 844), thumbReach(390, 2000), "a longer phone is not a longer thumb");
    assert.equal(thumbReach(1194, 834), 300, "the tablet reach is capped");
    assert.ok(thumbReach(320, 480) >= 150, "and floored");
  });

  // A control the solver could not seat politely is still a control the player needs. Below the design's floor it
  // relaxes the fight window, then the thumb's sweep, then thumb ownership - and says so through `fits` - but it
  // never drops a control and never lets two of them touch.
  test("a viewport too small for the design keeps every control and stays overlap-free", () => {
    for (const vp of [{ width: 280, height: 420 }, { width: 320, height: 480 }, { width: 420, height: 280 }]) {
      const layout = solveTouchLayout({ ...vp, ...NO_SAFE }, { stickRadiusPx: 96, kit: true });
      const where = `${vp.width}x${vp.height}`;
      assert.deepEqual(
        layout.controls.map((c) => c.id).sort(),
        ["ability", "grip", "guard", "overdrive", "stance", "strike", "swing"],
        `${where}: a control was dropped instead of being squeezed in`,
      );
      assert.equal(layout.fits, false, `${where}: a screen this small should report itself degraded`);
      const ink = layout.controls.map((c) => ({ id: c.id, r: visualRect(c) }));
      for (let i = 0; i < ink.length; i++) {
        for (let j = i + 1; j < ink.length; j++) {
          assert.equal(rectsOverlap(ink[i].r, ink[j].r), false, `${where}: ${ink[i].id} overlaps ${ink[j].id}`);
        }
      }
    }
  });
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A solved layout nothing renders is a layout the player never sees: the first version of this area shipped
// complete and unreachable because broadcast-ui.tsx still mounted the old hand-placed controls. These assertions
// are about the wiring, not the geometry, so they read the mount point's source rather than its output.
describe("the touch layer is actually mounted", () => {
  const ui = readFileSync(path.join(ROOT, "src/game/ui/broadcast-ui.tsx"), "utf8");
  const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

  test("broadcast-ui renders TouchLayer and the app loads mobile.css exactly once", () => {
    assert.match(ui, /import \{ TouchLayer \} from "\.\/touch\/touch-layer\.tsx";/, "TouchLayer is imported");
    assert.match(ui, /<TouchLayer game=\{game\} \/>/, "TouchLayer is rendered");
    assert.match(layout, /import "\.\/mobile\.css";/, "mobile.css is loaded beside globals.css in the root layout");
    // Two areas each added the import; a global stylesheet belongs to the layout, and only there.
    assert.ok(!/import ".*mobile\.css";/.test(ui), "and not a second time from the mount point");
  });

  test("the superseded WP3 controls are gone from the mount point", () => {
    assert.ok(!ui.includes("TouchControls"), "the old hand-placed controls are no longer imported or rendered");
    assert.ok(!ui.includes("touch-controls.tsx"), "and nothing still points at their module");
  });

  test("the layer is mounted unconditionally, because it gates itself", () => {
    // TouchLayer decides for itself on the touch setting, a coarse pointer, the fight screens and any open
    // overlay, and its safe-area probe has to stay mounted on every screen for the solver to read the insets.
    // A caller that re-applies those conditions would take the probe away on the menus.
    const line = ui.split("\n").find((l) => l.includes("<TouchLayer"));
    assert.equal(line.trim(), "<TouchLayer game={game} />", `the mount carries a guard: ${line.trim()}`);
  });
});
