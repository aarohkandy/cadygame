// src/game/render/cyclorama.tsx (WP2, rebuilt by GROUNDING part 2 items 3 and 5)
// The back of the room. It used to be a smooth navy gradient with three hairlines across it — the cheapest
// thing in the frame, and the "dead flat grey wall" the director called out. It is now a building: one unlit
// draw after the opaques (renderOrder 10, so it only fills what the set leaves), painted procedurally.
//
// Reading up from the crowd rake (holo-crowd.tsx puts a 1.5 m stand at 14 m, which occludes everything under
// about el 0.12, so nothing is drawn down there that has to be seen):
//   - the concourse: a service walkway, its handrail, and stair towers in silhouette;
//   - the vomitories: eight lit portals, aligned with the eight service bays between the crowd blocks, warm
//     3200 K spill washing the wall around each one and a few people standing in them;
//   - the ribbon: one continuous cool architectural cove above the portals, the room's only long light line;
//   - the upper back-of-house: block wall on a pier rhythm, stacked flight cases, scaff towers, a camera
//     crane arm, cable drops, and a scatter of work lights;
//   - the lighting grid: a distant truss lattice with fixture bodies hanging off it and a handful of lit
//     lenses, the only pixels back here allowed near the bloom threshold;
//   - the roof: black drape and catwalk lines.
// Air runs through all of it: a haze that is densest just above the crowd and thins with height, which is
// what separates the three planes (viewmodel arm, opponent, room) in a still.
//
// Nothing here may out-read the fight (part 2 acceptance 3: the wall is ≥ 8× darker than the opponent). The
// bulk of the wall sits near 0.006 linear; only the lamp cores — a few hundred pixels in total — go high.
//
// Everything that moves is a uniform in CYC_UNIFORMS, written each frame by lighting.tsx (which owns the
// show level and the hype); this component only builds the mesh. ponytail: module-level uniforms assume
// one arena canvas at a time.
"use client";

import { useEffect, useMemo, type JSX } from "react";
import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from "three";
import { DECK_THICKNESS_M } from "./deck-texture.ts";
import { CROWD_BLOCKS } from "./holo-crowd-material.ts";

/**
 * Radius of the room (sim metres). The crowd rake ends at 15.4 m and the studio floor at 17 m, so the wall
 * stands just outside both. It is also the furthest thing the camera ever sees: at RENDER_SCALE 2.05 this is
 * 35.9 render units, and every rig in camera-math sits within 1.3 m of the deck, so the far rim of the dome
 * lands around 38.5 — inside CAMERA_FAR (40) with room to spare.
 */
export const CYCLORAMA_RADIUS_M = 17.5;
const FLOOR_Z = -DECK_THICKNESS_M;
/**
 * How far down the room's architecture is pulled so it lands inside the cockpit frame (see the note in the
 * fragment shader). A feature drawn at elevation `e` in the layout below appears at `e * ROOM_LIFT`, which is
 * `e * ROOM_LIFT * CYCLORAMA_RADIUS_M` metres up the wall: the portal heads at 2.6 m, the ribbon cove at
 * 2.9 m, the back-of-house floor at 3.2 m, the lighting grid from 5.4 m. That is a real room, and it is the
 * room this camera can see.
 */
// 0.55 put the lighting grid at 5.4 m = 17.2 deg, and the cockpit lens only sees 11.1 deg above the horizon
// (camera-math.ts: 17.9 deg of down-pitch on a 58 deg FOV). The whole room was above the frame. At 0.44 the
// grid lands at ~13.8 deg with the portal heads still clearing the crowd rake; 0.38 would put the grid in
// frame but grazes the rake, so this takes the safe half of the win.
const ROOM_LIFT = 0.44;

/** Shared, per-frame bowl uniforms (lighting.tsx writes them). */
export const CYC_UNIFORMS = {
  uTime: { value: 0 },
  /** House level: HOUSE_DOWN_LEVEL in intros, 1 in play, > 1 through the ENGAGE slam. */
  uLevel: { value: 1 },
  uHype: { value: 0 },
};

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position - vec3(0.0, 0.0, ${FLOOR_Z.toFixed(4)});
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uHype;
varying vec3 vPos;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n21(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
/**
 * Anti-aliased band of half-width w around d = 0. The wall is 17 m away: a pixel covers centimetres of it,
 * and a raw fwidth on the wrapped azimuth spikes to a whole turn at the seam, so the filter is clamped. Every
 * line back here is filtered over about 3 px, so nothing resolves to a hard edge and nothing crawls.
 */
float aa(float d, float w, float fw) { return 1.0 - smoothstep(w, w + clamp(fw, 1e-5, 0.05) * 3.0, abs(d)); }
/** Soft rectangular mask in (bay, elevation) space. */
float slab(vec2 p, vec2 h, vec2 fw) {
  vec2 d = abs(p) - h;
  float e = max(d.x, d.y);
  return 1.0 - smoothstep(0.0, max(clamp(fw.x, 1e-5, 0.05), clamp(fw.y, 1e-5, 0.05)) * 2.5, e);
}

void main() {
  vec3 dir = normalize(vPos);
  float el = clamp(dir.z, 0.0, 1.0);
  float az = atan(dir.y, dir.x);
  float u = az / 6.2831853 + 0.5;                    // 0..1 around the room
  float lvl = uLevel;
  // Architecture elevation. The cockpit eye is 0.36 m over the deck and pitched 18.7 deg down with a 58 deg
  // lens, so the top of the frame is only 10.3 deg up: the wall is visible between the crowd's skyline
  // (el 0.115) and el 0.180, and NOTHING above that is ever seen in a fight. The room was laid out for a
  // camera that does not exist — its portals started at 0.176 and its ribbon sat at 0.300, both off the top
  // of the frame, which is why the back of the room read as an empty grey band. ela is the old layout
  // space; everything is built in it and lands ROOM_LIFT times lower, which puts the portals just above the
  // crowd's heads and the ribbon a few degrees over them, where a televised arena's fascia actually is.
  float ela = el / ${ROOM_LIFT.toFixed(3)};
  float few = fwidth(ela);
  // Bay coordinate: q counts the crowd blocks (holo-crowd lays 8 of them out on k * 45 deg), so bx = 0 is the
  // centre of a service bay between two blocks and |bx| = 0.5 is the centre of a block. Everything the room
  // does horizontally hangs off this, which is why the lit portals land in the gaps and not behind people.
  float q = u * ${CROWD_BLOCKS.toFixed(1)};
  float bx = fract(q + 0.5) - 0.5;
  float fbx = clamp(fwidth(q), 1e-5, 0.05);
  float fu = clamp(fwidth(u), 1e-5, 0.05);

  /* ── the wall itself ── */
  // Dark painted blockwork, cooler and darker with height, with big slow blotching so no patch of it is flat.
  float blot = n21(vec2(u * 26.0, ela * 9.0)) * 0.6 + n21(vec2(u * 71.0, ela * 24.0)) * 0.4;
  float grime = n21(vec2(u * 140.0, ela * 40.0));
  // x2.6 on both stops. Measured on a real GPU (not SwiftShader, which reported 25x too bright) the wall ran
  // 0.0003-0.0139 display luma: the portals, cove, courses and pier rhythm below were all being drawn into
  // black. Both stops scale together so the height gradient and everything drawn on top of it keep their shape.
  // x3.8 read as a lit room rather than a night broadcast and put the frame mean at the top of its gate; x2.6
  // lifts the wall clear of true black while the room stays dark. Measure the mean before changing it again.
  vec3 col = mix(vec3(0.0213, 0.0224, 0.0291), vec3(0.0068, 0.0073, 0.0120), smoothstep(0.10, 0.74, ela));
  col *= 0.55 + 0.95 * blot + 0.18 * grime;
  // Blockwork courses and the pier rhythm: 16 shallow piers, each throwing a soft shadow down its dark side.
  float course = aa(fract(ela * 46.0) - 0.5, 0.06, few * 46.0);
  col *= 1.0 - 0.22 * course * smoothstep(0.62, 0.20, ela);
  float pier = fract(q * 2.0 + 0.25) - 0.5;
  col *= 1.0 - 0.34 * smoothstep(0.30, 0.02, abs(pier + 0.16)) * smoothstep(0.78, 0.16, ela);
  col += vec3(0.0026, 0.0027, 0.0033) * smoothstep(0.30, 0.02, abs(pier - 0.16)) * smoothstep(0.78, 0.16, ela);

  /* ── concourse: walkway, handrail, stair towers ── */
  float walk = smoothstep(0.106, 0.118, ela) * (1.0 - smoothstep(0.150, 0.166, ela));
  col = mix(col, vec3(0.0042, 0.0044, 0.0052) * (0.7 + 0.8 * blot), walk * 0.85);
  col += vec3(0.020, 0.023, 0.032) * aa(ela - 0.1585, 0.0012, few) * lvl;     // the handrail, catching the cove
  // Stair towers drop out of the concourse in every other bay: solid black verticals with a lit nose.
  float stair = slab(vec2(fract(q * 0.5 + 0.5) - 0.5, ela - 0.150), vec2(0.028, 0.048), vec2(fbx * 0.5, few));
  col = mix(col, vec3(0.0009, 0.0010, 0.0016), stair * 0.9);
  col += vec3(0.013, 0.014, 0.019) * aa(abs(fract(q * 0.5 + 0.5) - 0.5) - 0.028, 0.0016, fbx * 0.5)
       * step(0.104, ela) * (1.0 - step(0.198, ela)) * lvl;

  /* ── vomitories: eight lit portals in the service bays ── */
  // The opening, its warm spill on the surrounding wall, and the shallow reveal of the jamb.
  float pw = 0.105, p0 = 0.176, p1 = 0.268;
  float port = slab(vec2(bx, ela - (p0 + p1) * 0.5), vec2(pw, (p1 - p0) * 0.5), vec2(fbx, few));
  float spill = exp(-pow(bx / 0.30, 2.0)) * exp(-pow((ela - 0.21) / 0.105, 2.0));
  vec3 warm = vec3(1.00, 0.66, 0.35);
  col += warm * spill * 0.030 * lvl;
  // Inside the opening: a gradient falling off deeper in, and standing figures cut into it.
  float depth = smoothstep(p0 - 0.004, p0 + 0.052, ela);
  vec3 inside = warm * mix(0.115, 0.024, depth);
  float fig = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float seed = h21(vec2(floor(q + 0.5) * 3.1 + fi, 7.0));
    float fxp = (seed - 0.5) * 0.15;
    float fh = 0.052 + 0.014 * h21(vec2(seed * 31.0, 2.0));
    fig = max(fig, slab(vec2(bx - fxp, ela - (p0 + fh * 0.5)), vec2(0.011, fh * 0.5), vec2(fbx, few))
              * step(0.45, seed));
  }
  inside = mix(inside, warm * 0.012, fig);
  col = mix(col, inside, port);
  col += warm * aa(ela - p1, 0.0018, few) * slab(vec2(bx, 0.0), vec2(pw, 1.0), vec2(fbx, few)) * 0.09 * lvl;

  /* ── the ribbon: one cool cove wrapping the room above the portals ── */
  float cove = aa(ela - 0.300, 0.0075, few);
  float coveGlow = exp(-pow((ela - 0.300) / 0.035, 2.0));
  float breathe = 0.86 + 0.14 * sin(uTime * 0.55) + 0.22 * uHype;
  col += vec3(0.30, 0.44, 0.72) * (cove * 0.115 + coveGlow * 0.022) * breathe * lvl;
  col *= 1.0 - 0.30 * aa(ela - 0.313, 0.004, few);                             // the cove's own shadow gap

  /* ── back of house: cases, towers, crane, cable drops, work lights ── */
  float deck = 0.330;
  // A skyline of stacked flight cases and scaff along the base of the upper wall: pure silhouette.
  float sky = deck + 0.020 * n21(vec2(u * 34.0, 1.0)) + 0.034 * step(0.72, h21(vec2(floor(u * 34.0), 5.0)));
  float mass = 1.0 - smoothstep(sky - 0.002, sky + 0.002, ela);
  col = mix(col, vec3(0.0011, 0.0012, 0.0020), mass * step(deck - 0.001, ela) * 0.95);
  // Two scaff towers and one camera-crane arm, in silhouette against the haze.
  float tower = slab(vec2(fract(q * 0.25 + 0.37) - 0.5, ela - 0.42), vec2(0.020, 0.095), vec2(fbx * 0.25, few));
  col = mix(col, vec3(0.0008, 0.0009, 0.0015), tower * 0.92);
  col += vec3(0.010, 0.011, 0.015) * aa(fract(ela * 120.0) - 0.5, 0.12, few * 120.0) * tower;
  float crane = aa((ela - 0.400) - (u - 0.32) * 0.30, 0.0035, few + fu * 0.30) * smoothstep(0.20, 0.30, u) * (1.0 - smoothstep(0.44, 0.52, u));
  col = mix(col, vec3(0.0007, 0.0008, 0.0013), crane);
  // Cable drops and safety bonds hanging out of the grid.
  float drop = aa(fract(q * 6.0 + 0.21) - 0.5, 0.010, fbx * 6.0) * smoothstep(0.34, 0.40, ela) * (1.0 - smoothstep(0.62, 0.70, ela));
  col *= 1.0 - 0.45 * drop;
  // Work lights: sparse warm practicals clamped to the wall, each with a soft pool around it.
  vec2 wg = vec2(u * 26.0, ela * 8.0);
  vec2 wi = floor(wg);
  float won = step(0.90, h21(wi + 11.0));
  vec2 wd = (fract(wg) - vec2(0.5, 0.5)) * vec2(1.0, 3.2);
  float lampCore = exp(-dot(wd, wd) * 190.0) * won * step(0.34, ela) * (1.0 - step(0.60, ela));
  float lampPool = exp(-dot(wd, wd) * 5.0) * won * step(0.34, ela) * (1.0 - step(0.60, ela));
  col += vec3(1.00, 0.72, 0.40) * (lampCore * 0.75 + lampPool * 0.016) * lvl;

  /* ── the lighting grid ── */
  float gridFade = smoothstep(0.56, 0.64, ela) * (1.0 - smoothstep(0.80, 0.90, ela));
  float bar = aa(fract(ela * 26.0) - 0.5, 0.030, few * 26.0);
  float leg = aa(fract(q * 3.0) - 0.5, 0.013, fbx * 3.0);
  col = mix(col, vec3(0.0009, 0.0010, 0.0017), max(bar, leg) * gridFade * 0.85);
  col += vec3(0.016, 0.017, 0.022) * bar * gridFade * 0.5 * lvl;              // the top arris of each tube
  // Lamp bodies slung under the grid, one in four of them struck.
  vec2 lg = vec2(u * 44.0, ela * 12.0);
  vec2 li = floor(lg);
  float lon = step(0.76, h21(li + 3.0));
  vec2 ld = (fract(lg) - 0.5) * vec2(1.0, 2.4);
  float body = 1.0 - smoothstep(0.16, 0.30, length(ld));
  col = mix(col, vec3(0.0010, 0.0011, 0.0016), body * gridFade * 0.8);
  float lens = exp(-dot(ld, ld) * 220.0) * lon * gridFade;
  col += vec3(1.0, 0.95, 0.86) * lens * 0.95 * lvl;
  col += vec3(0.7, 0.72, 0.85) * exp(-dot(ld, ld) * 7.0) * lon * gridFade * 0.012 * lvl;

  /* ── roof ── */
  float roof = smoothstep(0.80, 0.93, ela);
  col = mix(col, vec3(0.0013, 0.0014, 0.0024) * (0.5 + 0.9 * blot), roof);
  col += vec3(0.006, 0.0065, 0.009) * aa(fract(u * 9.0) - 0.5, 0.008, fu * 9.0) * roof * lvl;

  /* ── air ── */
  // Haze is densest just above the crowd and thins with height: the gradient that makes the room deep and
  // keeps the three planes apart in a still. It drifts, so the wall is never frozen.
  float drift = n21(vec2(u * 18.0 + uTime * 0.012, el * 6.0 - uTime * 0.03)) * 0.65
              + n21(vec2(u * 49.0 - uTime * 0.025, el * 13.0)) * 0.35;
  // This band was the single brightest thing in the back of the room and it covered all of it: centred on
  // el 0.205 with a 0.20 shoulder, it laid ~0.038 linear of flat blue over the whole visible wall — 0.21
  // display, brighter than the crowd standing in front of it, which is why the crowd vanished and the band
  // read as one dead grey field. It is now a tenth of that, and it is centred BEHIND the crowd's heads
  // (el 0.075, a 0.075 shoulder) so it works as a backlight: the rake reads as a rim of dark figures
  // against a faint glow instead of dissolving into it. Part 2 acceptance 3 wants the wall ≥ 8× darker than
  // the opponent, and the wall's own brightest pixels outside the practicals now sit at ~0.004 linear.
  float airBand = exp(-pow((el - 0.075) / 0.075, 2.0));
  col += vec3(0.0038, 0.0047, 0.0090) * airBand * (0.55 + 0.6 * drift) * lvl;
  // Shafts from the grid falling through it, lined up with the lamp columns. Beams, not wash: they are
  // narrow (sin^26), they start above the ribbon, and they are the only air in the room allowed to be bright.
  float shaft = pow(max(0.0, sin(q * 3.0 * 6.2831853 + 1.3)), 26.0)
              * smoothstep(0.165, 0.286, el) * (1.0 - smoothstep(0.319, 0.473, el));
  col += vec3(0.026, 0.029, 0.045) * shaft * (0.6 + 0.4 * drift) * lvl;

  // The room is the last thing the eye should find.
  gl_FragColor = vec4(col * 0.80, 1.0);
}
`;

export function Cyclorama(): JSX.Element {
  const built = useMemo(() => {
    // Upper hemisphere with its pole on +z; the floor closes it underneath.
    const geo = new SphereGeometry(CYCLORAMA_RADIUS_M, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, FLOOR_Z);
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: CYC_UNIFORMS,
    });
    const wall = new Mesh(geo, material);
    // After the opaques (10.2 step 7): depth-tested against the set, so the dome only fills what is left.
    wall.renderOrder = 10;
    wall.frustumCulled = false;
    wall.name = "cyc-wall";
    return wall;
  }, []);
  useEffect(() => () => {
    built.geometry.dispose();
    (built.material as ShaderMaterial).dispose();
  }, [built]);
  return (
    <group name="cyclorama">
      <primitive object={built} />
    </group>
  );
}
