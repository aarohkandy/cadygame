"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaScene, type CameraPreset, type CubeOwner } from "@/components/arena-scene";
import { CUBE_COUNT, MujocoEngine, START_POSE, type PhysicsSnapshot } from "@/lib/mujoco-engine";

const TASKS = [
  {
    id: "heist",
    name: "Cube Heist",
    description: "Steal cubes for your side",
    tag: "60 SEC",
    tone: "coral",
    environment: "Cube Heist v1",
    goal: "After 60 seconds, the robot with the most cubes on its side wins",
  },
  {
    id: "stack",
    name: "Stack Blocks",
    description: "Build the tower first",
    tag: "LEVEL 02",
    tone: "amber",
    environment: "Dual Stack v1",
    goal: "First robot to stack, release, and remain stable",
  },
  {
    id: "push",
    name: "Push to Target",
    description: "Push into the goal first",
    tag: "LEVEL 03",
    tone: "mint",
    environment: "Dual Push v1",
    goal: "First robot to move its cube fully inside the ring",
  },
] as const;

const POLICIES = [
  { name: "Manual control", detail: "Keyboard teleoperation" },
  { name: "Reach & carry demo", detail: "Scripted capture policy" },
  { name: "Random explorer", detail: "Joint-space exploration" },
] as const;

const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: "arena", label: "Arena" },
  { id: "atlas", label: "Atlas POV" },
  { id: "blaze", label: "Blaze POV" },
  { id: "overhead", label: "Top" },
];

const HEIST_MATCH_LENGTH = 60;
const INITIAL_CUBE_POSITIONS: [number, number, number][] = Array.from({ length: CUBE_COUNT }, (_, index) => [
  (index % 3 - 1) * 0.04878,
  (1 - Math.floor(index / 3)) * 0.05366,
  0.0205,
]);
const FALLBACK_SNAPSHOT: PhysicsSnapshot = {
  joints: [...START_POSE],
  opponentJoints: [...START_POSE],
  cubes: INITIAL_CUBE_POSITIONS.map((position) => ({ position, quaternion: [0, 0, 0, 1] })),
  contacts: 0,
  armContacts: 0,
  cubeContacts: 0,
  collision: {
    kind: "none",
    attacker: null,
    force: 0,
    impulse: 0,
    position: [0, 0, 0],
    atlasLink: "",
    blazeLink: "",
    eventId: 0,
  },
  simTime: 0,
};

type EngineStatus = "loading" | "ready" | "fallback";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cubeOwner(position: [number, number, number]): CubeOwner {
  if (Math.hypot(position[0] + 0.18, position[1]) <= 0.105) return "atlas";
  if (Math.hypot(position[0] - 0.18, position[1]) <= 0.105) return "blaze";
  return "neutral";
}

function countCubes(owners: CubeOwner[], owner: CubeOwner) {
  return owners.filter((cubeOwner) => cubeOwner === owner).length;
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

  if (task === "heist") {
    const carry = (Math.sin(elapsed * 0.78 - 1.1) + 1) / 2;
    const sweep = Math.sin(elapsed * 0.72) * 0.38;
    return [sweep, -0.66 + carry * 0.34, 1.12 - carry * 0.29, -0.6 + carry * 0.26, Math.sin(elapsed * 0.92) * 0.2, 1.08 - carry * 0.86];
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

function opponentPolicyTargets(task: string, elapsed: number) {
  const baseline = policyTargets(1, task, elapsed + 0.28) ?? START_POSE;
  return baseline.map((value, index) => value + (index === 0 ? Math.sin(elapsed * 0.8) * 0.06 : 0));
}

export function ArenaApp() {
  const [selectedTaskId, setSelectedTaskId] = useState<(typeof TASKS)[number]["id"]>("heist");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("arena");
  const [policyIndex, setPolicyIndex] = useState(1);
  const [episodeLength, setEpisodeLength] = useState(30);
  const [randomization, setRandomization] = useState(true);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engineVersion, setEngineVersion] = useState("WASM");
  const [snapshot, setSnapshot] = useState<PhysicsSnapshot>(FALLBACK_SNAPSHOT);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reward, setReward] = useState(0);
  const [opponentReward, setOpponentReward] = useState(0);
  const [episodes, setEpisodes] = useState(1248);
  const [successes, setSuccesses] = useState(899);
  const [combatStats, setCombatStats] = useState({ atlas: 0, blaze: 0, blocks: 0 });
  const engineRef = useRef<MujocoEngine | null>(null);
  const targetsRef = useRef<number[]>([...START_POSE]);
  const elapsedRef = useRef(0);
  const lastCollisionEventRef = useRef(0);
  const selectedTask = useMemo(() => TASKS.find((task) => task.id === selectedTaskId) ?? TASKS[0], [selectedTaskId]);
  const isHeist = selectedTaskId === "heist";
  const matchLength = isHeist ? HEIST_MATCH_LENGTH : episodeLength;
  const cubeOwners = useMemo(() => snapshot.cubes.map((cube) => cubeOwner(cube.position)), [snapshot.cubes]);

  const updateTargets = useCallback((next: number[]) => {
    targetsRef.current = next;
  }, []);

  const resetEpisode = useCallback((taskId = selectedTaskId) => {
    setRunning(false);
    elapsedRef.current = 0;
    setElapsed(0);
    setReward(0);
    setOpponentReward(0);
    setCombatStats({ atlas: 0, blaze: 0, blocks: 0 });
    lastCollisionEventRef.current = 0;
    updateTargets([...START_POSE]);
    const next = engineRef.current?.reset({
      cubesEnabled: taskId === "heist",
      randomizeCubes: randomization && taskId === "heist",
    }) ?? FALLBACK_SNAPSHOT;
    setSnapshot(next);
  }, [randomization, selectedTaskId, updateTargets]);

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
      const opponentTargets = opponentPolicyTargets(selectedTaskId, nextElapsed);
      if (scripted) updateTargets(scripted);
      const activeTargets = scripted ?? targetsRef.current;
      const nextSnapshot = engineRef.current?.step(activeTargets, opponentTargets, 4) ?? {
        ...FALLBACK_SNAPSHOT,
        joints: activeTargets,
        opponentJoints: opponentTargets,
        simTime: nextElapsed,
      };
      setSnapshot(nextSnapshot);

      if (nextSnapshot.collision.eventId > 0 && nextSnapshot.collision.eventId !== lastCollisionEventRef.current) {
        lastCollisionEventRef.current = nextSnapshot.collision.eventId;
        setCombatStats((stats) => {
          if (nextSnapshot.collision.kind === "strike" && nextSnapshot.collision.attacker) {
            return { ...stats, [nextSnapshot.collision.attacker]: stats[nextSnapshot.collision.attacker] + 1 };
          }
          return { ...stats, blocks: stats.blocks + 1 };
        });
      }

      const taskFactor = selectedTaskId === "heist" ? 1 : selectedTaskId === "push" ? 0.93 : 0.86;
      const opponentFactor = selectedTaskId === "heist" ? 0.98 : selectedTaskId === "push" ? 0.95 : 0.94;
      const nextOwners = nextSnapshot.cubes.map((cube) => cubeOwner(cube.position));
      const newReward = selectedTaskId === "heist"
        ? countCubes(nextOwners, "atlas") / CUBE_COUNT
        : clamp((nextElapsed / matchLength) * taskFactor, 0, taskFactor);
      const newOpponentReward = selectedTaskId === "heist"
        ? countCubes(nextOwners, "blaze") / CUBE_COUNT
        : clamp((nextElapsed / matchLength) * opponentFactor, 0, opponentFactor);
      setReward(newReward);
      setOpponentReward(newOpponentReward);
      if (Math.floor(nextElapsed * 10) % 2 === 0) setElapsed(nextElapsed);

      if (nextElapsed >= matchLength) {
        setRunning(false);
        elapsedRef.current = matchLength;
        setElapsed(matchLength);
        setEpisodes((value) => value + 1);
        if (selectedTaskId === "heist") {
          if (countCubes(nextOwners, "atlas") > countCubes(nextOwners, "blaze")) setSuccesses((value) => value + 1);
        } else if (newReward > newOpponentReward) {
          setSuccesses((value) => value + 1);
        }
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [matchLength, policyIndex, running, selectedTaskId, updateTargets]);

  const toggleRun = useCallback(() => {
    if (elapsedRef.current >= matchLength) resetEpisode();
    setRunning((value) => !value);
  }, [matchLength, resetEpisode]);

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
    resetEpisode(taskId);
  };

  const statusLabel = engineStatus === "ready" ? `MUJOCO ${engineVersion}` : engineStatus === "loading" ? "LOADING PHYSICS" : "PREVIEW MODE";
  const successRate = Math.round((successes / episodes) * 100);
  const progress = Math.min(100, (elapsed / matchLength) * 100);
  const atlasScore = isHeist ? countCubes(cubeOwners, "atlas") : Math.round(reward * 100);
  const blazeScore = isHeist ? countCubes(cubeOwners, "blaze") : Math.round(opponentReward * 100);
  const scoreDifference = Math.abs(atlasScore - blazeScore);
  const resultLabel = atlasScore === blazeScore ? "DRAW" : `${atlasScore > blazeScore ? "ATLAS" : "BLAZE"} WINS`;
  const matchCall = elapsed >= matchLength ? resultLabel : elapsed === 0 ? "READY" : atlasScore === blazeScore ? (isHeist ? "TIED" : "NECK & NECK") : isHeist ? `${atlasScore > blazeScore ? "ATLAS" : "BLAZE"} +${scoreDifference}` : atlasScore > blazeScore ? "ATLAS LEADS" : "BLAZE LEADS";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /></span><span>ROBOARENA</span><span className="version">BETA</span></div>
        <nav className="nav-tabs" aria-label="Main navigation"><a className="active" href="#arena">Arena</a><a href="#competitors">Competitors</a><a href="#leaderboard">Leaderboard</a></nav>
        <div className="header-actions"><a className="docs-link" href="https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotstudio_so101" target="_blank" rel="noreferrer">MENAGERIE ↗</a><button className="profile-button"><span>AK</span><i /></button></div>
      </header>

      <section className="arena-layout" id="arena">
        <aside className="task-panel">
          <div className="panel-heading"><div><span className="eyebrow">HEAD-TO-HEAD EVENTS</span><h1>Competition Arena</h1></div><span className="task-count">03</span></div>
          <div className="task-list">
            {TASKS.map((task, index) => (
              <button className={`task-card ${task.id === selectedTaskId ? "selected" : ""}`} onClick={() => chooseTask(task.id)} key={task.id} aria-pressed={task.id === selectedTaskId}>
                <span className={`task-visual ${task.tone}`}><i /><b>{String(index + 1).padStart(2, "0")}</b></span>
                <span className="task-copy"><strong>{task.name}</strong><small>{task.description}</small></span>
                <span className="task-tag">{task.id === selectedTaskId ? "LIVE" : task.tag}</span>
              </button>
            ))}
          </div>
          <div className="task-brief"><span className="eyebrow">WIN CONDITION</span><p>{selectedTask.goal}</p></div>
          <div className="season-card"><div className="season-top"><span>SEASON 01</span><span>12 DAYS LEFT</span></div><strong>Founding Circuit</strong><div className="progress"><i /></div><p><b>{episodes.toLocaleString()}</b> matches · Atlas wins {successRate}%</p></div>
        </aside>

        <section className="stage">
          <div className="scene-canvas"><ArenaScene cameraPreset={cameraPreset} joints={snapshot.joints} opponentJoints={snapshot.opponentJoints} playerProgress={reward} opponentProgress={opponentReward} cubes={snapshot.cubes} cubeOwners={cubeOwners} collision={snapshot.collision} running={running} taskId={selectedTaskId} /></div>
          <div className="stage-toolbar">
            <div className={`live-pill ${engineStatus}`}><i /> {statusLabel}</div>
            <div className="camera-pills" aria-label="Change perspective">
              {CAMERA_PRESETS.map((camera) => <button className={cameraPreset === camera.id ? "active" : ""} onClick={() => setCameraPreset(camera.id)} key={camera.id} aria-pressed={cameraPreset === camera.id}>{camera.label.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="duel-board" aria-label="Live match score">
            <div className="duelist atlas"><span><i /> ATLAS</span><strong>{atlasScore}</strong><small>{isHeist ? "CUBES SECURED" : "GREEN CORNER"}</small></div>
            <div className="versus"><b>{matchCall}</b><span>{isHeist ? `${Math.max(0, Math.ceil(matchLength - elapsed))}s LEFT` : `${elapsed.toFixed(1)}s`}</span></div>
            <div className="duelist blaze"><span>BLAZE <i /></span><strong>{blazeScore}</strong><small>{isHeist ? "CUBES SECURED" : "ORANGE CORNER"}</small></div>
          </div>
          {snapshot.collision.kind !== "none" && (
            <div className={`contact-callout ${snapshot.collision.kind}`} role="status">
              <b>{snapshot.collision.kind === "strike" ? `${snapshot.collision.attacker?.toUpperCase()} STRIKE` : "ARMS BLOCKED"}</b>
              <span>{snapshot.collision.force.toFixed(1)} N · {snapshot.collision.atlasLink} ↔ {snapshot.collision.blazeLink}</span>
            </div>
          )}
          <div className="competitor-labels" aria-hidden="true"><span className="atlas-label"><i />ATLAS</span><span className="blaze-label">BLAZE<i /></span></div>
          <div className="scene-caption">
            <div><span className="eyebrow">COMPETITORS</span><strong>2× SO-101 · Face-to-face</strong></div>
            <div><span className="eyebrow">PHYSICS</span><strong>MuJoCo · 200 Hz · {combatStats.blocks} blocks</strong></div>
            <div><span className="eyebrow">ENVIRONMENT</span><strong>{selectedTask.environment}</strong></div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="control-heading"><span className="eyebrow">MATCH CONTROL</span><h2>Head-to-head</h2></div>
          <div className="matchup-card" id="competitors"><span className="matchup-team atlas"><i />ATLAS<small>YOUR POLICY</small></span><b>VS</b><span className="matchup-team blaze">BLAZE<i /><small>ADAPTIVE RIVAL</small></span></div>
          <div className="setup-group"><label>ATLAS POLICY <b>{policyIndex === 0 ? "TELEOP" : "BASELINE"}</b></label><button className="select-row" onClick={() => setPolicyIndex((policyIndex + 1) % POLICIES.length)}><span className="policy-dot">π</span><span><strong>{POLICIES[policyIndex].name}</strong><small>{POLICIES[policyIndex].detail}</small></span><b>⌄</b></button></div>
          <div className="setup-group"><label>MATCH LENGTH <b>{matchLength} SEC{isHeist ? " · FIXED" : ""}</b></label><input type="range" min="10" max="60" step="5" value={matchLength} disabled={isHeist} onChange={(event) => setEpisodeLength(Number(event.target.value))} aria-label="Match length" /><div className="range-labels"><span>{isHeist ? "ONE-MINUTE MATCH" : "10s"}</span><span>60s</span></div></div>
          <button className="setup-group randomization-button" onClick={() => setRandomization((value) => !value)} aria-pressed={randomization}><label>DOMAIN RANDOMIZATION <b>{randomization ? "ON" : "OFF"}</b></label><span className="random-grid"><span><i />Lighting</span><span><i />Friction</span><span><i />Object pose</span><span><i />Camera</span></span></button>
          <div className="episode-progress"><span><b>{running ? matchCall : elapsed >= matchLength ? resultLabel : "READY TO RACE"}</b><i>{elapsed.toFixed(1)} / {matchLength}s</i></span><div><i style={{ width: `${progress}%` }} /></div></div>
          <div className="run-actions"><button className={`run-button ${running ? "pause" : ""}`} onClick={toggleRun}><span>{running ? "Ⅱ" : "▶"}</span> {running ? "PAUSE MATCH" : elapsed >= matchLength ? "RACE AGAIN" : elapsed > 0 ? "RESUME MATCH" : "START MATCH"}<small>SPACE</small></button><button className="reset-button" onClick={() => resetEpisode()} aria-label="Reset match">↺</button></div>
          <div className="metric-strip competitor-metrics"><div><span>ATLAS {isHeist ? "CUBES" : "SCORE"} · {combatStats.atlas} HITS</span><strong>{atlasScore}</strong></div><div><span>BLAZE {isHeist ? "CUBES" : "SCORE"} · {combatStats.blaze} HITS</span><strong>{blazeScore}</strong></div></div>
          <p className="hint">Use the perspective buttons to watch either robot · <kbd>X</kbd> reset</p>
        </aside>
      </section>
    </main>
  );
}
