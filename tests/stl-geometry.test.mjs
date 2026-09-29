// EMOTION_BIBLE 10.2 step 3 (WP1): the served bake carries the merged, simplified (link, slot) meshes at LOD0 and
// LOD1 and the STLs are the dev fallback (weld 1e-4 m, crease normals at 35°, signed edge mask, meshopt cuts in the
// page); both paths yield the same triangles, both arms share one geometry set, and a second load in the same
// page fetches nothing twice.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LINK_IDS } from "../src/game/contracts.ts";
import {
  BAKE_FILE, bakeKey, buildRenderGeometry, createLinkPoses, decodeBake, encodeBake, forwardKinematics, linkGeometry, linkIndexMap,
  linkSlotGeometries, loadRobotAssets, LOD_RATIO, LOD_TARGET_ERROR, parseSo101, parseStl, robotAssetFetchCounts, skinnedMerge,
  triangleCount,
} from "../src/game/render/robot-assets.ts";
import { buildShadowProxies, proxyTriangles } from "../src/game/render/shadow-proxies.ts";
import { buildLedPlacements, servoEffort, STRIP_LINKS } from "../src/game/render/robot-decals.ts";
import { createGripperTrail, TRAIL_LIFE_S, trailStrength } from "../src/game/render/trails.ts";
import { Quaternion, Vector3 } from "three";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "public/models/robotstudio_so101");

/** Binary STL of an axis-aligned cube (12 triangles, outward winding). */
function cubeStl(size = 0.02) {
  const h = size / 2;
  const v = (x, y, z) => [x * h, y * h, z * h];
  const faces = [
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1)], [v(-1, -1, 1), v(1, 1, 1), v(-1, 1, 1)],
    [v(-1, -1, -1), v(1, 1, -1), v(1, -1, -1)], [v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)],
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)], [v(1, -1, -1), v(1, 1, 1), v(1, -1, 1)],
    [v(-1, -1, -1), v(-1, 1, 1), v(-1, 1, -1)], [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1)],
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1)], [v(-1, 1, -1), v(1, 1, 1), v(1, 1, -1)],
    [v(-1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1)],
  ];
  const buf = new ArrayBuffer(84 + faces.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, faces.length, true);
  faces.forEach((f, i) => {
    const o = 84 + i * 50 + 12;
    f.flat().forEach((c, k) => dv.setFloat32(o + k * 4, c, true));
  });
  return buf;
}

function fsFetch(counter) {
  return async (url) => {
    counter.n++;
    const rel = url.replace(/^\/models\/robotstudio_so101\//, "").replace(/^test-[a-z0-9]+\//, "");
    const b = await readFile(path.join(modelDir, rel));
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), text: async () => b.toString() };
  };
}

describe("STL geometry", () => {
  test("binary STL parses to a triangle soup", () => {
    const soup = parseStl(cubeStl());
    assert.equal(soup.length, 12 * 9);
  });

  test("weld, crease split at 35°, and a convex edge mask on a cube", () => {
    const g = buildRenderGeometry(parseStl(cubeStl()));
    assert.equal(g.weldedVertices, 8);
    assert.equal(g.triangles, 12);
    assert.equal(g.position.length / 3, 24, "each corner splits into three hard-edged vertices");
    assert.equal(g.index.length, 36);
    for (let i = 0; i < g.normal.length; i += 3) {
      const n = Math.hypot(g.normal[i], g.normal[i + 1], g.normal[i + 2]);
      assert.ok(Math.abs(n - 1) < 1e-6);
      // Face normals on a cube are axis aligned.
      assert.ok(Math.max(Math.abs(g.normal[i]), Math.abs(g.normal[i + 1]), Math.abs(g.normal[i + 2])) > 0.999);
    }
    for (const e of g.edge) assert.ok(e > 0.9, `cube corners are convex hard edges (${e})`);
  });

  test("a gently curved surface keeps one smooth normal per welded vertex", () => {
    // A 10-segment arc strip (9° per step) never crosses the crease threshold.
    const tris = [];
    for (let i = 0; i < 10; i++) {
      const a0 = (i * 9 * Math.PI) / 180, a1 = ((i + 1) * 9 * Math.PI) / 180;
      const p = (a, z) => [Math.cos(a) * 0.05, Math.sin(a) * 0.05, z];
      tris.push([p(a0, 0), p(a1, 0), p(a1, 0.01)], [p(a0, 0), p(a1, 0.01), p(a0, 0.01)]);
    }
    const soup = Float32Array.from(tris.flat(2));
    const g = buildRenderGeometry(soup);
    assert.equal(g.position.length / 3, g.weldedVertices);
    for (const e of g.edge) assert.equal(e, 0);
  });

  test("so101.xml parses to eight links with the 6.7 material slots and collision proxies", async () => {
    const model = parseSo101(await readFile(path.join(modelDir, "so101.xml"), "utf8"));
    assert.deepEqual(model.links.map((l) => l.link).sort(), [...LINK_IDS].sort());
    const visuals = model.links.flatMap((l) => l.visuals);
    assert.equal(visuals.length, 18);
    assert.equal(new Set(visuals.map((v) => v.mesh)).size, 14);
    assert.equal(visuals.filter((v) => v.slot === "servo").length, 6);
    assert.deepEqual(model.links.map((l) => l.jointIndex), [-1, 0, 1, 2, 3, 4, -1, 5]);
    for (const l of model.links) if (l.link !== "base") assert.ok(l.colliders.length > 0, l.link);
  });

  test("forward kinematics mirrors the blaze arm through the arena centre at the same joint angles", async () => {
    const model = parseSo101(await readFile(path.join(modelDir, "so101.xml"), "utf8"));
    const q = [0.3, -0.5, 0.9, -0.4, 0.2, 0.6];
    const a = forwardKinematics(model, "atlas", q, createLinkPoses(model));
    const b = forwardKinematics(model, "blaze", q, createLinkPoses(model));
    for (let i = 0; i < model.links.length; i++) {
      assert.ok(Math.abs(a.pos[i * 3] + b.pos[i * 3]) < 1e-12);
      assert.ok(Math.abs(a.pos[i * 3 + 1] + b.pos[i * 3 + 1]) < 1e-12);
      assert.ok(Math.abs(a.pos[i * 3 + 2] - b.pos[i * 3 + 2]) < 1e-12);
    }
    // The gripper link reaches forward of the mount and above the deck at a guard-like pose.
    const gi = model.links.findIndex((l) => l.link === "gripper");
    assert.ok(a.pos[gi * 3 + 2] > 0.02);
  });

  test("assets load once per page: concurrent and repeated loads share every fetch and geometry", async () => {
    const counter = { n: 0 };
    const baseUrl = "/models/robotstudio_so101/test-cache/";
    const fetchImpl = fsFetch(counter);
    const [a, b] = await Promise.all([loadRobotAssets({ baseUrl, fetchImpl, bake: false }), loadRobotAssets({ baseUrl, fetchImpl, bake: false })]);
    const c = await loadRobotAssets({ baseUrl, fetchImpl, bake: false });
    assert.equal(a, b);
    assert.equal(a, c);
    assert.equal(a.source, "stl");
    assert.equal(counter.n, 1 + 14, "so101.xml plus 14 visual STLs, each once");
    for (const [url, n] of robotAssetFetchCounts) if (url.startsWith(baseUrl)) assert.equal(n, 1, url);
    // Both arms use the same merged link geometries.
    assert.equal(linkSlotGeometries(a), linkSlotGeometries(c));
    const tris = a.trianglesPerArm;
    const proxies = buildShadowProxies(a);
    // D10 triangle gate: both arms plus shadow proxies stay under 1.2 M.
    assert.ok(tris * 2 + proxyTriangles(proxies) * 2 < 1.2e6, `triangles ${tris * 2}`);
    assert.ok(proxyTriangles(proxies) < 5000, "proxies are low poly");
    for (const l of LINK_IDS) assert.ok(a.linkBounds[l].radius > 0, l);
    // EMOTION_BIBLE 10.2 step 3: every (link, slot) carries LOD0 (35 %) and LOD1 (15 %) sharing the merged vertices.
    assert.equal(a.simplified, true, "meshopt simplifier ran");
    const lod = a.lodTrianglesPerArm;
    assert.ok(lod.lod0 <= tris * (LOD_RATIO.lod0 + 0.01) && lod.lod0 > tris * 0.2, `LOD0 ${lod.lod0} of ${tris}`);
    assert.ok(lod.lod1 <= tris * (LOD_RATIO.lod1 + 0.01) && lod.lod1 > tris * 0.05, `LOD1 ${lod.lod1} of ${tris}`);
    for (const e of linkSlotGeometries(a)) {
      assert.ok(triangleCount(e.lods.lod1) < triangleCount(e.lods.lod0), `${e.link}/${e.slot} LOD1 is the cheaper one`);
      assert.equal(e.lods.lod1.attributes.position, e.lods.lod0.attributes.position, "LODs share one vertex buffer");
      for (const g of [e.lods.lod0, e.lods.lod1]) for (let i = 0; i < g.index.count; i++) assert.ok(g.index.array[i] < g.attributes.position.count);
    }
    // 10.1 arm share of the frame: favoured arm LOD0 + other arm LOD1 + both arms LOD1 in the reflection + shadow proxies.
    assert.ok(lod.lod0 + 3 * lod.lod1 + proxyTriangles(proxies) * 2 < 0.30e6, "arms leave the set 0.15 M of the 0.45 M budget");
    // The per-link ghost geometry is the LOD1 cut, so a stretched ghost adds ≤ 15 % of an arm.
    let ghost = 0;
    for (const l of LINK_IDS) { const g = linkGeometry(a, l); if (g) ghost += triangleCount(g); }
    assert.equal(ghost, lod.lod1, "ghost = LOD1 per link");
  });

  test("the bake round-trips the STL pipeline: same triangles, vertices within quantization, no STL fetched", async () => {
    const stl = await loadRobotAssets({ baseUrl: "/models/robotstudio_so101/test-cache/", fetchImpl: fsFetch({ n: 0 }), bake: false });
    const xml = await readFile(path.join(modelDir, "so101.xml"), "utf8");
    const bake = encodeBake(stl, xml);
    assert.ok(bake.byteLength < 2.5e6, `bake is ${(bake.byteLength / 1e6).toFixed(2)} MB (≤ 3 MB on a 20 Mbit/s profile)`);
    const { manifest, bySlot } = decodeBake(bake);
    assert.equal(manifest.key, bakeKey(xml));
    const src = linkSlotGeometries(stl);
    assert.equal(bySlot.length, src.length);
    let worst = 0;
    for (let i = 0; i < src.length; i++) {
      const s = src[i], d = bySlot[i];
      assert.equal(`${d.link}/${d.slot}`, `${s.link}/${s.slot}`);
      assert.equal(triangleCount(d.lods.lod0), triangleCount(s.lods.lod0));
      assert.equal(triangleCount(d.lods.lod1), triangleCount(s.lods.lod1));
      assert.equal(d.lods.lod1.attributes.position, d.lods.lod0.attributes.position, "decoded LODs share one vertex buffer");
      // Compare triangle by triangle through each LOD's index (the bake compacts the vertex set).
      for (const lod of ["lod0", "lod1"]) {
        const sp = s.lods[lod].attributes.position.array, si = s.lods[lod].index.array;
        const dp = d.lods[lod].attributes.position.array, di = d.lods[lod].index.array;
        for (let k = 0; k < si.length; k += 97) {
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(sp[si[k] * 3 + c] - dp[di[k] * 3 + c]));
        }
      }
    }
    assert.ok(worst < 1e-5, `vertex quantization error ${worst} m`);

    // A page that is served the bake never touches an STL, reports the same numbers and still builds every accent.
    const counter = { n: 0 };
    const withBake = fsFetch(counter);
    const fetchImpl = async (url) => (url.endsWith(BAKE_FILE) ? { ok: true, status: 200, arrayBuffer: async () => bake, text: async () => "" } : withBake(url));
    const baked = await loadRobotAssets({ baseUrl: "/models/robotstudio_so101/test-bake/", fetchImpl });
    assert.equal(baked.source, "bake");
    assert.equal(counter.n, 1, "so101.xml only");
    assert.equal(baked.simplified, true);
    assert.deepEqual(baked.lodTrianglesPerArm, stl.lodTrianglesPerArm);
    assert.equal(baked.trianglesPerArm, stl.trianglesPerArm);
    for (const l of LINK_IDS) assert.ok(Math.abs(baked.linkBounds[l].radius - stl.linkBounds[l].radius) < 1e-9, l);
    assert.equal(buildLedPlacements(baked).length, buildLedPlacements(stl).length);
    for (const l of LINK_IDS) assert.equal(triangleCount(linkGeometry(baked, l) ?? { attributes: { position: { count: 0 } } }), triangleCount(linkGeometry(stl, l) ?? { attributes: { position: { count: 0 } } }));

    // A stale or foreign bake is refused and the STL path runs.
    const stale = { n: 0 };
    const staleFetch = fsFetch(stale);
    const fallback = await loadRobotAssets({
      baseUrl: "/models/robotstudio_so101/test-stale/",
      fetchImpl: async (url) => (url.endsWith(BAKE_FILE) ? { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, text: async () => "" } : staleFetch(url)),
    });
    assert.equal(fallback.source, "stl");
    assert.equal(stale.n, 1 + 14);
    assert.ok(LOD_TARGET_ERROR <= 0.01);
  });

  test("LED accents: twelve servo LEDs plus a flank strip each side of the pitch links, driven by their own joint", async () => {
    const a = await loadRobotAssets({ baseUrl: "/models/robotstudio_so101/test-cache/", fetchImpl: fsFetch({ n: 0 }) });
    const leds = buildLedPlacements(a);
    const strips = leds.slice(12);
    assert.equal(strips.length, STRIP_LINKS.length * 2, "every strip found its shell");
    for (const s of strips) {
      assert.equal(s.joint, a.model.links.find((l) => l.link === s.link).jointIndex);
      const sx = new Vector3(), p = new Vector3();
      s.matrix.decompose(p, new Quaternion(), sx);
      assert.ok(sx.x > 0.02 && sx.y < 0.005, `strip is long and thin (${sx.x}, ${sx.y})`);
      assert.ok(p.distanceTo(new Vector3(...a.linkBounds[s.link].center)) < a.linkBounds[s.link].radius * 1.2, "strip sits on its link");
    }
  });

  test("servo effort reads force over range or joint speed, clamped to 1", () => {
    assert.equal(servoEffort(0, 3, 0), 0);
    assert.equal(servoEffort(-1.5, 3, 0), 0.5);
    assert.equal(servoEffort(0, 3, 1.5), 0.5);
    assert.equal(servoEffort(9, 3, 0), 1);
    assert.equal(servoEffort(1, 0, 0), 0, "no force range: speed only");
  });

  test("gripper trail draws only on a flick and burns out within its life", () => {
    const t = createGripperTrail();
    for (let i = 0; i < 20; i++) t.push(i * 0.001, 0, 0.1, 0.06, 1 / 60);
    assert.equal(t.mesh.visible, false, "a slow move leaves no trail");
    assert.equal(trailStrength(0.5), 0);
    assert.equal(trailStrength(5), 1);
    for (let i = 0; i < 10; i++) t.push(0.02 + i * 0.04, 0, 0.1, 2.4, 1 / 60);
    assert.equal(t.mesh.visible, true, "a flick draws");
    const fade = t.mesh.geometry.getAttribute("aInfo");
    assert.ok(fade.getY(0) > 0.9, "head is at full strength");
    for (let i = 0; i < Math.ceil(TRAIL_LIFE_S * 60) + 1; i++) t.push(0.38, 0, 0.1, 0, 1 / 60);
    assert.equal(t.mesh.visible, false, "burnt out after TRAIL_LIFE_S");
    t.force();
    t.push(0.38, 0, 0.1, 0, 1 / 60);
    assert.equal(t.mesh.visible, true, "a charge release forces it on");
    t.clear();
    assert.equal(t.mesh.visible, false);
    t.dispose();
  });
  // EMOTION_BIBLE 10.2 step 6: the shells of one material class are one draw, posed by a rigid bone per link.
  test("the skinned merge keeps every triangle, one bone per link, hidden links a prefix of the index", async () => {
    const assets = await loadRobotAssets({ baseUrl: "/models/robotstudio_so101/test-merge/", fetchImpl: fsFetch({ n: 0 }), bake: false });
    const boneOf = linkIndexMap(assets.model);
    const shellBody = linkSlotGeometries(assets).filter((e) => e.slot === "shell_body");
    assert.ok(shellBody.length > 2, "more than one link in the class, or the merge saves nothing");
    const merged = skinnedMerge(shellBody, "lod0", (l) => boneOf[l]);
    const geometry = merged.geometry;
    assert.equal(merged.indexCount, shellBody.reduce((n, e) => n + e.lods.lod0.index.count, 0), "no triangle lost");
    assert.equal(triangleCount(geometry), merged.indexCount / 3);
    const vertices = geometry.attributes.position.count;
    for (let i = 0; i < geometry.index.count; i++) assert.ok(geometry.index.array[i] < vertices, "index addresses the merged set");
    // One rigid bone per vertex: skinIndex.x is the link, skinWeight.x is 1, every other channel zero.
    const si = geometry.attributes.skinIndex.array, sw = geometry.attributes.skinWeight.array;
    assert.equal(si.length, vertices * 4);
    for (let v = 0; v < vertices; v++) {
      assert.equal(sw[v * 4], 1);
      assert.equal(sw[v * 4 + 1] + sw[v * 4 + 2] + sw[v * 4 + 3], 0);
      assert.equal(si[v * 4 + 1] + si[v * 4 + 2] + si[v * 4 + 3], 0);
    }
    // Bone order, and each link's triangles are one contiguous run starting where indexStart says.
    const order = [...shellBody].sort((a, b) => boneOf[a.link] - boneOf[b.link]);
    let cursor = 0;
    for (const e of order) {
      assert.equal(merged.indexStart.get(e.link), cursor, e.link);
      for (let k = cursor; k < cursor + e.lods.lod0.index.count; k++) {
        assert.equal(si[geometry.index.array[k] * 4], boneOf[e.link], `${e.link} triangle ${k}`);
      }
      cursor += e.lods.lod0.index.count;
    }
    // The cockpit-hidden links sort first, so hiding the viewmodel's rear is one setDrawRange.
    const view = await readFile(path.join(root, "src/game/render/robot-view.tsx"), "utf8");
    const hidden = JSON.parse(/COCKPIT_HIDDEN_LINKS[^=]*=\s*new Set<LinkId>\((\[[^\]]*\])\)/.exec(view)[1]);
    assert.deepEqual(hidden, ["base", "shoulder", "upper_arm"]);
    const kept = order.findIndex((e) => !hidden.includes(e.link));
    assert.ok(kept > 0, "at least one hidden link in this class");
    assert.ok(order.slice(0, kept).every((e) => hidden.includes(e.link)) && order.slice(kept).every((e) => !hidden.includes(e.link)),
      "every hidden link sorts before every kept one");
  });

  // The merge rewrites WP2's shell shader in place; if those anchors move, it must fail here, not on screen.
  test("every shell-shader anchor the merge rewrites still exists in robot-materials", async () => {
    const view = await readFile(path.join(root, "src/game/render/robot-view.tsx"), "utf8");
    const materials = await readFile(path.join(root, "src/game/render/robot-materials.ts"), "utf8");
    const anchors = [...view.matchAll(/swap\([^,]+, "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((a) => a !== "void main() {");
    anchors.push(JSON.parse(/JOINT_AXIS_SOURCE = ("(?:[^"\\]|\\.)*")/.exec(view)[1]));
    assert.ok(anchors.length >= 11, `expected the ten uniform/varying anchors plus the joint axis, found ${anchors.length}`);
    for (const a of anchors) assert.ok(materials.includes(a), `robot-materials no longer emits ${JSON.stringify(a)}`);
  });
});
