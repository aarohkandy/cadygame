// src/game/render/boot-resize.ts (WP6)
// R3F only creates the renderer once <Canvas> has measured a non-zero container, and it gets that first
// measurement from react-use-measure, which reads the box *only* from a ResizeObserver callback. Resize
// observations are delivered during the document's rendering steps, and a document that is hidden when it
// loads — a background tab, a collapsed preview pane, a window behind another — never runs them. The
// observer then stays silent until the page is first shown, so the canvas keeps its default 300x150, the
// renderer is never built, and the player sees the page background instead of the arena.
//
// Passing this observer as <Canvas resize={{ polyfill: BootstrapResizeObserver }}> keeps the normal
// ResizeObserver behaviour and adds one measurement at observe() time, taken from a microtask so the
// element is already laid out. getBoundingClientRect forces layout whether or not the document is visible,
// so the canvas boots at the right size regardless of when the page is first painted.
"use client";

export class BootstrapResizeObserver implements ResizeObserver {
  readonly #inner: ResizeObserver;
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    this.#inner = new ResizeObserver(callback);
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    this.#inner.observe(target, options);
    queueMicrotask(() => {
      // react-use-measure ignores the entries and re-reads the observed element itself, so an empty batch
      // is the correct way to ask it for a measurement it would otherwise wait on the compositor for.
      this.#callback([], this);
    });
  }

  unobserve(target: Element): void {
    this.#inner.unobserve(target);
  }

  disconnect(): void {
    this.#inner.disconnect();
  }
}

/** The `resize` options for <Canvas>; undefined on the server and anywhere ResizeObserver is missing. */
export const BOOT_RESIZE: { polyfill: typeof ResizeObserver } | undefined =
  typeof ResizeObserver === "undefined" ? undefined : { polyfill: BootstrapResizeObserver };
