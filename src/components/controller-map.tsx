"use client";

import { useEffect, useRef } from "react";

type ControllerMapProps = {
  controllerName: string | null;
  onClose: () => void;
};

const FACE_ACTIONS = [
  { button: "Y", tone: "y", action: "Lift / Lower", detail: "Travel ↔ cube height" },
  { button: "A", tone: "a", action: "Grab / Drop", detail: "Toggle the gripper" },
  { button: "X", tone: "x", action: "Precision", detail: "Toggle 35% arm speed" },
  { button: "B", tone: "b", action: "Home arm", detail: "Return to safe pose" },
] as const;

export function ControllerMap({ controllerName, onClose }: ControllerMapProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="controller-map-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="controller-map-dialog" role="dialog" aria-modal="true" aria-labelledby="controller-map-title">
        <header>
          <div><span className="eyebrow">ATLAS INPUT</span><h3 id="controller-map-title">Xbox-style hand control</h3></div>
          <div className={`controller-map-status ${controllerName ? "" : "offline"}`}><i />{controllerName ?? "CONTROLLER PREVIEW"}</div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close controller map">×</button>
        </header>
        <div className="controller-map-content">
          <div className="controller-diagram" aria-label="Controller stick layout">
            <span className="controller-callout move"><b>LS</b> MOVE GRIPPER</span>
            <span className="controller-callout camera"><b>RS</b> ORBIT CAMERA</span>
            <span className="controller-callout presets"><b>D-PAD</b> CAMERA PRESETS</span>
            <div className="controller-silhouette" aria-hidden="true">
              <i className="controller-stick left" />
              <i className="controller-dpad">+</i>
              <i className="controller-stick right" />
              <span className="controller-face y">Y</span>
              <span className="controller-face x">X</span>
              <span className="controller-face b">B</span>
              <span className="controller-face a">A</span>
              <span className="controller-center view">▣</span>
              <span className="controller-center menu">☰</span>
            </div>
          </div>
          <div className="controller-actions">
            <div className="controller-actions-heading"><span>PRIMARY ACTIONS</span><b>GAME-FIRST</b></div>
            {FACE_ACTIONS.map((item) => (
              <div className="controller-action" key={item.button}>
                <span className={`controller-glyph ${item.tone}`}>{item.button}</span>
                <span><strong>{item.action}</strong><small>{item.detail}</small></span>
              </div>
            ))}
          </div>
        </div>
        <footer>
          <span><kbd>☰</kbd> START / PAUSE / RESUME</span>
          <span><kbd>RS</kbd> CLICK TO RECENTER CAMERA</span>
          <span><kbd>▣</kbd> CLOSE CONTROL MAP</span>
        </footer>
      </section>
    </div>
  );
}
