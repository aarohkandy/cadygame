"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaScene, type CameraPreset } from "@/components/arena-scene";
import { MujocoEngine, type PhysicsSnapshot } from "@/lib/mujoco-engine";

const TASKS = [
  {
    id: "lift",
    name: "Lift Cube",
    description: "Grasp and lift to 15 cm",
    tag: "ACTIVE",
    tone: "coral",
    environment: "Lift Cube v1",
    goal: "Hold above the marker for 2 seconds",
  },
  {
    id: "stack",
    name: "Stack Blocks",
    description: "Build a stable tower",
    tag: "LEVEL 02",
    tone: "amber",
    environment: "Stack Blocks v1",
    goal: "Place coral on amber and release",
  },
  {
    id: "push",
    name: "Push to Target",
    description: "Navigate into the goal",
    tag: "LEVEL 03",
    tone: "mint",
    environment: "Push Target v1",
    goal: "Move the cube fully inside the ring",
  },
] as const;

const POLICIES = [
  { name: "Manual control", detail: "Keyboard teleoperation" },
  { name: "Reach & lift demo", detail: "Scripted baseline policy" },
  { name: "Random explorer", detail: "Joint-space exploration" },
] as const;

const START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72];
const FALLBACK_SNAPSHOT: PhysicsSnapshot = {
  joints: START_POSE,
  cube: [0.3, 0, 0.04],
  contacts: 0,
  simTime: 0,
};

type EngineStatus = "loading" | "ready" | "fallback";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function policyTargets(policy: number, task: string, elapsed: number) {
  if (policy === 0) return null;
  if (policy === 2) {
    return [
      Math.sin(elapsed * 0.7) * 0.72,
      -0.62 + Math.sin(elapsed * 0.91) * 0.36,
      0.88 + Math.cos(elapsed * 0.82) * 0.38,
      -0.38 + Math.sin(elapsed * 1.21) * 0.38,
      Math.sin(elapsed * 1.4) * 0.8,
      0.72 + Math.sin(elapsed * 0.64) * 0.48,
    ];
  }

  const reach = clamp(elapsed / 2.8, 0, 1);
  const lift = clamp((elapsed - 2.8) / 2.6, 0, 1);
  if (task === "push") {
    return [0.36 * reach, -0.48 - reach * 0.22, 1.15 - reach * 0.42, -0.44, 0.1, 0.22 + lift * 0.45];
  }
  if (task === "stack") {
    return [-0.2 + reach * 0.52, -0.66 + lift * 0.24, 1.12 - lift * 0.36, -0.58, 0.16, 1.1 - lift * 0.85];
  }
  return [0.28 * reach, -0.64 + lift * 0.43, 1.14 - lift * 0.31, -0.62 + lift * 0.28, 0.08, 1.18 - reach * 1.03];
}

export function ArenaApp() {
  const [selectedTaskId, setSelectedTaskId] = useState<(typeof TASKS)[number]["id"]>("lift");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("orbit");
  const [policyIndex, setPolicyIndex] = useState(1);
  const [episodeLength, setEpisodeLength] = useState(30);
  const [randomization, setRandomization] = useState(true);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engineVersion, setEngineVersion] = useState("WASM");
  const [snapshot, setSnapshot] = useState<PhysicsSnapshot>(FALLBACK_SNAPSHOT);
  const [targets, setTargets] = useState(START_POSE);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reward, setReward] = useState(0);
  const [episodes, setEpisodes] = useState(1248);
  const [successes, setSuccesses] = useState(899);
  const engineRef = useRef<MujocoEngine | null>(null);
  const targetsRef = useRef(START_POSE);
  const elapsedRef = useRef(0);
  const selectedTask = useMemo(() => TASKS.find((task) => task.id === selectedTaskId) ?? TASKS[0], [selectedTaskId]);

  const updateTargets = useCallback((next: number[]) => {
    targetsRef.current = next;
    setTargets(next);
  }, []);

  const resetEpisode = useCallback(() => {
    setRunning(false);
    elapsedRef.current = 0;
    setElapsed(0);
    setReward(0);
    updateTargets(START_POSE);
    const next = engineRef.current?.reset() ?? FALLBACK_SNAPSHOT;
    setSnapshot(next);
  }, [updateTargets]);

  useEffect(() => {
    let alive = true;
    MujocoEngine.create()
      .then((engine) => {
        if (!alive) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        setSnapshot(engine.snapshot());
        setEngineVersion(engine.version);
        setEngineStatus("ready");
      })
      .catch(() => {
        if (alive) setEngineStatus("fallback");
      });
    return () => {
      alive = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const nextElapsed = elapsedRef.current + 0.016;
      elapsedRef.current = nextElapsed;

      const scripted = policyTargets(policyIndex, selectedTaskId, nextElapsed);
      if (scripted) updateTargets(scripted);
      const activeTargets = scripted ?? targetsRef.current;
      const nextSnapshot = engineRef.current?.step(activeTargets, 4) ?? {
        ...FALLBACK_SNAPSHOT,
        joints: activeTargets,
        simTime: nextElapsed,
      };
      setSnapshot(nextSnapshot);

      const taskFactor = selectedTaskId === "lift" ? 1 : selectedTaskId === "push" ? 0.93 : 0.86;
      const newReward = clamp((nextElapsed / Math.min(8, episodeLength)) * taskFactor, 0, taskFactor);
      setReward(newReward);
      if (Math.floor(nextElapsed * 10) % 2 === 0) setElapsed(nextElapsed);

      if (nextElapsed >= episodeLength) {
        setRunning(false);
        setEpisodes((value) => value + 1);
        if (newReward > 0.7) setSuccesses((value) => value + 1);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [episodeLength, policyIndex, running, selectedTaskId, updateTargets]);

  const toggleRun = useCallback(() => {
    if (elapsedRef.current >= episodeLength) resetEpisode();
    setRunning((value) => !value);
  }, [episodeLength, resetEpisode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRun();
        return;
      }
      if (event.key.toLowerCase() === "x") {
        resetEpisode();
        return;
      }
      if (policyIndex !== 0) return;
      const controls: Record<string, [number, number]> = {
        a: [0, -0.06], d: [0, 0.06], w: [1, 0.06], s: [1, -0.06],
        ArrowUp: [2, 0.06], ArrowDown: [2, -0.06], q: [3, 0.06], e: [3, -0.06],
        g: [5, -0.08], h: [5, 0.08],
      };
      const control = controls[event.key] ?? controls[event.key.toLowerCase()];
      if (!control) return;
      event.preventDefault();
      const [joint, delta] = control;
      const limits = [[-1.91, 1.91], [-1.74, 1.74], [-1.69, 1.69], [-1.65, 1.65], [-2.74, 2.84], [-0.17, 1.74]];
      const next = [...targetsRef.current];
      next[joint] = clamp(next[joint] + delta, limits[joint][0], limits[joint][1]);
      updateTargets(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [policyIndex, resetEpisode, toggleRun, updateTargets]);

  const chooseTask = (taskId: (typeof TASKS)[number]["id"]) => {
    setSelectedTaskId(taskId);
    window.setTimeout(resetEpisode, 0);
  };

  const statusLabel = engineStatus === "ready" ? `MUJOCO ${engineVersion}` : engineStatus === "loading" ? "LOADING PHYSICS" : "PREVIEW MODE";
  const successRate = Math.round((successes / episodes) * 100);
  const progress = Math.min(100, (elapsed / episodeLength) * 100);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /></span><span>ROBOARENA</span><span className="version">BETA</span></div>
        <nav className="nav-tabs" aria-label="Main navigation"><a className="active" href="#arena">Arena</a><a href="#policies">Policies</a><a href="#leaderboard">Leaderboard</a></nav>
        <div className="header-actions"><a className="docs-link" href="https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotstudio_so101" target="_blank" rel="noreferrer">MENAGERIE ↗</a><button className="profile-button"><span>AK</span><i /></button></div>
      </header>

      <section className="arena-layout" id="arena">
        <aside className="task-panel">
          <div className="panel-heading"><div><span className="eyebrow">CHALLENGE SET</span><h1>Training Grounds</h1></div><span className="task-count">03</span></div>
          <div className="task-list">
            {TASKS.map((task, index) => (
              <button className={`task-card ${task.id === selectedTaskId ? "selected" : ""}`} onClick={() => chooseTask(task.id)} key={task.id} aria-pressed={task.id === selectedTaskId}>
                <span className={`task-visual ${task.tone}`}><i /><b>{String(index + 1).padStart(2, "0")}</b></span>
                <span className="task-copy"><strong>{task.name}</strong><small>{task.description}</small></span>
                <span className="task-tag">{task.id === selectedTaskId ? "ACTIVE" : task.tag}</span>
              </button>
            ))}
          </div>
          <div className="task-brief"><span className="eyebrow">SUCCESS CONDITION</span><p>{selectedTask.goal}</p></div>
          <div className="season-card"><div className="season-top"><span>SEASON 01</span><span>12 DAYS LEFT</span></div><strong>Founding Circuit</strong><div className="progress"><i /></div><p><b>{episodes.toLocaleString()}</b> episodes run by 83 builders</p></div>
        </aside>

        <section className="stage">
          <div className="scene-canvas"><ArenaScene cameraPreset={cameraPreset} cube={snapshot.cube} joints={snapshot.joints} running={running} taskId={selectedTaskId} /></div>
          <div className="stage-toolbar">
            <div className={`live-pill ${engineStatus}`}><i /> {statusLabel}</div>
            <div className="camera-pills" aria-label="Camera angle">
              {(["orbit", "front", "side"] as const).map((camera) => <button className={cameraPreset === camera ? "active" : ""} onClick={() => setCameraPreset(camera)} key={camera}>{camera.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="sim-hud">
            <div><span>REWARD</span><strong>{reward.toFixed(2)}</strong></div>
            <div><span>CONTACTS</span><strong>{snapshot.contacts}</strong></div>
            <div><span>SIM TIME</span><strong>{snapshot.simTime.toFixed(1)}s</strong></div>
          </div>
          <div className="scene-caption">
            <div><span className="eyebrow">ROBOT</span><strong>SO-101 · Menagerie</strong></div>
            <div><span className="eyebrow">PHYSICS</span><strong>MuJoCo · 200 Hz</strong></div>
            <div><span className="eyebrow">ENVIRONMENT</span><strong>{selectedTask.environment}</strong></div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="control-heading"><span className="eyebrow">CONTROL ROOM</span><h2>Episode setup</h2></div>
          <div className="setup-group"><label>POLICY <b>{policyIndex === 0 ? "TELEOP" : "BASELINE"}</b></label><button className="select-row" onClick={() => setPolicyIndex((policyIndex + 1) % POLICIES.length)}><span className="policy-dot">π</span><span><strong>{POLICIES[policyIndex].name}</strong><small>{POLICIES[policyIndex].detail}</small></span><b>⌄</b></button></div>
          <div className="setup-group"><label>EPISODE LENGTH <b>{episodeLength} SEC</b></label><input type="range" min="10" max="60" step="5" value={episodeLength} onChange={(event) => setEpisodeLength(Number(event.target.value))} aria-label="Episode length" /><div className="range-labels"><span>10s</span><span>60s</span></div></div>
          <button className="setup-group randomization-button" onClick={() => setRandomization((value) => !value)} aria-pressed={randomization}><label>DOMAIN RANDOMIZATION <b>{randomization ? "ON" : "OFF"}</b></label><span className="random-grid"><span><i />Lighting</span><span><i />Friction</span><span><i />Object pose</span><span><i />Camera</span></span></button>
          <div className="episode-progress"><span><b>{running ? "RUNNING" : elapsed >= episodeLength ? "COMPLETE" : "READY"}</b><i>{elapsed.toFixed(1)} / {episodeLength}s</i></span><div><i style={{ width: `${progress}%` }} /></div></div>
          <div className="run-actions"><button className={`run-button ${running ? "pause" : ""}`} onClick={toggleRun}><span>{running ? "Ⅱ" : "▶"}</span> {running ? "PAUSE EPISODE" : elapsed > 0 ? "RESUME EPISODE" : "START EPISODE"}<small>SPACE</small></button><button className="reset-button" onClick={resetEpisode} aria-label="Reset episode">↺</button></div>
          <div className="metric-strip"><div><span>BEST REWARD</span><strong>{Math.max(0.84, reward).toFixed(2)}</strong></div><div><span>SUCCESS RATE</span><strong>{successRate}%</strong></div></div>
          <p className="hint">Manual: <kbd>W A S D</kbd> aim · <kbd>↑ ↓</kbd> elbow · <kbd>G H</kbd> grip · <kbd>X</kbd> reset</p>
        </aside>
      </section>
    </main>
  );
}
