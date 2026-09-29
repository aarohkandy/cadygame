// src/game/render/prewarm.ts (WP1)
// Shader pre-warm (EMOTION_BIBLE 10.2 step 1): `WebGLRenderer.compile` only walks visible objects on the camera's
// layers, so every pooled effect, the ghost, lobby tiles, hidden stickers, the scan plane, shadow proxies, and
// local/screen/reflection layers are forced visible with every layer enabled, compiled once, then restored. The
// compile runs with an off-screen target bound: three keys every program on the output colour space of the
// *current* render target (canvas → sRGB, any render target → linear), and the world is only ever drawn into
// the post stack's HDR target. The link itself is issued through `compileAsync` (KHR_parallel_shader_compile):
// the programs exist after the synchronous walk, but the GPU links them off the main thread, so the loading
// screen keeps animating and `whenReady` resolves when the first frame can draw without a stall. The program
// count recorded after the post stack's first frames is the acceptance baseline: it must never grow during play
// outside a safe phase, and it is re-taken after every tier change.
import { HalfFloatType, WebGLRenderTarget, type Camera, type Object3D, type Scene, type WebGLRenderer } from "three";

export interface PrewarmResult {
  /** Programs that exist after the walk (linking may still be in flight). */
  programs: number;
  forcedVisible: number;
  /** Main-thread cost of the walk. */
  ms: number;
  /** Resolves once every program the walk created reports ready. */
  whenReady: Promise<void>;
}

/** 1×1 stand-in for the composer's HDR target, so compiled programs carry the linear output colour space. */
let scratchTarget: WebGLRenderTarget | null = null;

/** Page-wide prewarm status: the loading screen (WP6) waits on `ready`; `?debug=feel` shows the numbers. */
export const prewarmStatus: { done: boolean; ready: boolean; passes: number; programs: number; ms: number } = {
  done: false, ready: false, passes: 0, programs: 0, ms: 0,
};

/** Forces visibility and all layers, compiles, restores. Safe to call more than once (tier changes re-run it). */
export function prewarmScene(gl: WebGLRenderer, scene: Scene, camera: Camera, extra: readonly { scene: Scene; camera: Camera }[] = []): PrewarmResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const hidden: Object3D[] = [];
  const masks: [Object3D, number][] = [];
  const force = (root: Object3D) => {
    root.traverse((o) => {
      if (!o.visible) { hidden.push(o); o.visible = true; }
      if (o.layers.mask !== 1) { masks.push([o, o.layers.mask]); o.layers.enable(0); }
    });
  };
  force(scene);
  for (const e of extra) force(e.scene);
  const cameraMask = camera.layers.mask;
  camera.layers.enableAll();
  const previousTarget = gl.getRenderTarget();
  scratchTarget ??= new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  gl.setRenderTarget(scratchTarget);
  const pending: Promise<unknown>[] = [];
  try {
    pending.push(gl.compileAsync(scene, camera));
    // The extras (the reticle overlay) draw straight to the canvas after the composer: three keys the program on the
    // target's colour space (srgb vs the scratch target's srgb-linear), so they compile against the canvas, not the target.
    gl.setRenderTarget(null);
    for (const e of extra) pending.push(gl.compileAsync(e.scene, e.camera));
  } finally {
    gl.setRenderTarget(previousTarget);
    camera.layers.mask = cameraMask;
    for (const o of hidden) o.visible = false;
    for (const [o, mask] of masks) o.layers.mask = mask;
  }
  const ms = (typeof performance !== "undefined" ? performance.now() : 0) - t0;
  const programs = gl.info.programs?.length ?? 0;
  prewarmStatus.done = true;
  prewarmStatus.ready = false;
  prewarmStatus.passes++;
  prewarmStatus.programs = programs;
  prewarmStatus.ms = ms;
  const whenReady = Promise.all(pending).then(() => { prewarmStatus.ready = true; });
  return { programs, forcedVisible: hidden.length, ms, whenReady };
}
