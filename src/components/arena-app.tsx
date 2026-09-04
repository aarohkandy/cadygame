"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArenaScene,
  type CameraControlState,
  type CameraPreset,
  type CubeOwner,
} from "@/components/arena-scene";
import { ControllerMap } from "@/components/controller-map";
import {
  MANUAL_GRIPPER_TARGETS,
  MANUAL_HOME_TARGET,
  POLICY_FILE_ACCEPT,
  UploadedPolicyRunner,
  stepTaskSpaceTarget,
} from "@/lib/arm-participation.mjs";
import {
  PRECISION_SPEED_SCALE,
  STANDARD_GAMEPAD,
  readStandardGamepad,
} from "@/lib/gamepad-controls.mjs";
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

const POLICY_OPTIONS = [
  { id: "demo", name: "Reach & carry", detail: "Built-in capture policy" },
  { id: "random", name: "Random explorer", detail: "Joint-space exploration" },
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
  atlasEndEffector: [...MANUAL_HOME_TARGET] as [number, number, number],
  simTime: 0,
};

type EngineStatus = "loading" | "ready" | "fallback";
type ControlMode = "manual" | "policy";
type PolicyChoice = (typeof POLICY_OPTIONS)[number]["id"] | "uploaded";
type UploadState = { kind: "idle" | "loading" | "ready" | "error"; message: string };
type GamepadConnection = { index: number; name: string };

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

function readableGamepadName(id: string) {
  const withoutMetadata = id.replace(/\s*\([^)]*(?:vendor|product)[^)]*\)\s*/gi, " ").trim();
  return (withoutMetadata || "Standard gamepad").slice(0, 42);
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
  const [controlMode, setControlMode] = useState<ControlMode>("manual");
  const [manualLifted, setManualLifted] = useState(true);
  const [manualGripping, setManualGripping] = useState(false);
  const [manualPrecision, setManualPrecision] = useState(false);
  const [joystickVisual, setJoystickVisual] = useState({ x: 0, y: 0 });
  const [gamepadConnection, setGamepadConnection] = useState<GamepadConnection | null>(null);
  const [controllerMapOpen, setControllerMapOpen] = useState(false);
  const [policyChoice, setPolicyChoice] = useState<PolicyChoice>("demo");
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle", message: "No policy uploaded" });
  const [uploadedPolicyName, setUploadedPolicyName] = useState("");
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
  const snapshotRef = useRef<PhysicsSnapshot>(FALLBACK_SNAPSHOT);
  const targetsRef = useRef<number[]>([...START_POSE]);
  const manualTargetRef = useRef<[number, number, number]>(
    [...MANUAL_HOME_TARGET] as [number, number, number],
  );
  const joystickRef = useRef({ x: 0, y: 0 });
  const gamepadMoveRef = useRef({ x: 0, y: 0 });
  const cameraControlRef = useRef<CameraControlState>({ x: 0, y: 0, resetToken: 0 });
  const gamepadIndexRef = useRef<number | null>(null);
  const gamepadButtonsRef = useRef<boolean[]>([]);
  const manualKeysRef = useRef(new Set<string>());
  const manualLiftedRef = useRef(true);
  const manualGrippingRef = useRef(false);
  const manualPrecisionRef = useRef(false);
  const uploadedPolicyRef = useRef<InstanceType<typeof UploadedPolicyRunner> | null>(null);
  const uploadRequestRef = useRef(0);
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
    joystickRef.current = { x: 0, y: 0 };
    gamepadMoveRef.current = { x: 0, y: 0 };
    manualKeysRef.current.clear();
    manualLiftedRef.current = true;
    manualGrippingRef.current = false;
    manualPrecisionRef.current = false;
    setJoystickVisual({ x: 0, y: 0 });
    setManualLifted(true);
    setManualGripping(false);
    setManualPrecision(false);
    setControllerMapOpen(false);
    updateTargets([...START_POSE]);
    uploadedPolicyRef.current?.reset({ task: taskId });
    const next = engineRef.current?.reset({
      cubesEnabled: taskId === "heist",
      randomizeCubes: randomization && taskId === "heist",
    }) ?? FALLBACK_SNAPSHOT;
    manualTargetRef.current = [...next.atlasEndEffector];
    snapshotRef.current = next;
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
        const initialSnapshot = engine.snapshot();
        manualTargetRef.current = [...initialSnapshot.atlasEndEffector];
        snapshotRef.current = initialSnapshot;
        setSnapshot(initialSnapshot);
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
      uploadedPolicyRef.current?.dispose();
      uploadedPolicyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const nextElapsed = elapsedRef.current + 0.016;
      elapsedRef.current = nextElapsed;

      let activeTargets = targetsRef.current;
      if (controlMode === "manual") {
        const keyboardX = Number(manualKeysRef.current.has("right")) - Number(manualKeysRef.current.has("left"));
        const keyboardY = Number(manualKeysRef.current.has("back")) - Number(manualKeysRef.current.has("forward"));
        manualTargetRef.current = stepTaskSpaceTarget(
          manualTargetRef.current,
          {
            x: joystickRef.current.x + gamepadMoveRef.current.x + keyboardX,
            y: joystickRef.current.y + gamepadMoveRef.current.y + keyboardY,
          },
          0.016,
          manualLiftedRef.current,
        ) as [number, number, number];
        activeTargets = engineRef.current?.solveAtlasIK(
          manualTargetRef.current,
          activeTargets,
          manualGrippingRef.current
            ? MANUAL_GRIPPER_TARGETS.closed
            : MANUAL_GRIPPER_TARGETS.open,
        ) ?? activeTargets;
      } else if (policyChoice === "uploaded" && uploadedPolicyRef.current) {
        const current = snapshotRef.current;
        activeTargets = uploadedPolicyRef.current.nextTargets({
          time: nextElapsed,
          task: selectedTaskId,
          joints: [...current.joints],
          opponentJoints: [...current.opponentJoints],
          cubes: current.cubes.map((cube) => ({
            position: [...cube.position],
            quaternion: [...cube.quaternion],
          })),
          contacts: current.contacts,
          armContacts: current.armContacts,
          cubeContacts: current.cubeContacts,
          collision: { ...current.collision },
        });
      } else {
        activeTargets = policyTargets(policyChoice === "random" ? 2 : 1, selectedTaskId, nextElapsed)
          ?? targetsRef.current;
      }
      updateTargets(activeTargets);
      const opponentTargets = opponentPolicyTargets(selectedTaskId, nextElapsed);
      const nextSnapshot = engineRef.current?.step(activeTargets, opponentTargets, 4) ?? {
        ...FALLBACK_SNAPSHOT,
        joints: activeTargets,
        opponentJoints: opponentTargets,
        simTime: nextElapsed,
      };
      snapshotRef.current = nextSnapshot;
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
  }, [controlMode, matchLength, policyChoice, running, selectedTaskId, updateTargets]);

  const toggleRun = useCallback(() => {
    if (elapsedRef.current >= matchLength) resetEpisode();
    setControllerMapOpen(false);
    setRunning((value) => !value);
  }, [matchLength, resetEpisode]);

  const selectControlMode = useCallback((mode: ControlMode) => {
    joystickRef.current = { x: 0, y: 0 };
    gamepadMoveRef.current = { x: 0, y: 0 };
    manualKeysRef.current.clear();
    setJoystickVisual({ x: 0, y: 0 });
    if (mode === "manual") {
      const current = snapshotRef.current;
      manualTargetRef.current = [...current.atlasEndEffector];
      const lifted = current.atlasEndEffector[2] > 0.12;
      const gripping = (current.joints[5] ?? MANUAL_GRIPPER_TARGETS.open) < 0.5;
      manualLiftedRef.current = lifted;
      manualGrippingRef.current = gripping;
      setManualLifted(lifted);
      setManualGripping(gripping);
    }
    updateTargets([...snapshotRef.current.joints]);
    setControlMode(mode);
  }, [updateTargets]);

  const toggleManualLift = useCallback(() => {
    const next = !manualLiftedRef.current;
    manualLiftedRef.current = next;
    setManualLifted(next);
  }, []);

  const toggleManualGrip = useCallback(() => {
    const next = !manualGrippingRef.current;
    manualGrippingRef.current = next;
    setManualGripping(next);
  }, []);

  const toggleManualPrecision = useCallback(() => {
    const next = !manualPrecisionRef.current;
    manualPrecisionRef.current = next;
    setManualPrecision(next);
  }, []);

  const toggleControllerMap = useCallback(() => {
    if (!controllerMapOpen) setRunning(false);
    setControllerMapOpen(!controllerMapOpen);
  }, [controllerMapOpen]);

  const closeControllerMap = useCallback(() => {
    setControllerMapOpen(false);
  }, []);

  const homeManualArm = useCallback(() => {
    joystickRef.current = { x: 0, y: 0 };
    manualKeysRef.current.clear();
    manualTargetRef.current = [...MANUAL_HOME_TARGET] as [number, number, number];
    manualLiftedRef.current = true;
    manualGrippingRef.current = false;
    setJoystickVisual({ x: 0, y: 0 });
    setManualLifted(true);
    setManualGripping(false);
    updateTargets([...START_POSE]);
  }, [updateTargets]);

  const updateJoystick = useCallback((element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    let x = (clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.38);
    let y = (clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.38);
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.1) {
      x = 0;
      y = 0;
    } else if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    joystickRef.current = { x, y };
    setJoystickVisual({ x, y });
  }, []);

  const releaseJoystick = useCallback(() => {
    joystickRef.current = { x: 0, y: 0 };
    setJoystickVisual({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!("getGamepads" in navigator)) return;

    let animationFrame = 0;
    let inputSuspended = !document.hasFocus();

    const stopGamepadMotion = () => {
      const wasMoving = Math.hypot(gamepadMoveRef.current.x, gamepadMoveRef.current.y) > 0.001;
      gamepadMoveRef.current = { x: 0, y: 0 };
      cameraControlRef.current.x = 0;
      cameraControlRef.current.y = 0;
      if (wasMoving) setJoystickVisual({ x: 0, y: 0 });
    };

    const registerGamepad = (gamepad: Gamepad) => {
      if (gamepad.mapping !== "standard") return;
      if (gamepadIndexRef.current === null) gamepadIndexRef.current = gamepad.index;
      if (gamepadIndexRef.current !== gamepad.index) return;
      const name = readableGamepadName(gamepad.id);
      setGamepadConnection((current) => (
        current?.index === gamepad.index && current.name === name
          ? current
          : { index: gamepad.index, name }
      ));
    };

    const onGamepadConnected = (event: GamepadEvent) => registerGamepad(event.gamepad);
    const onGamepadDisconnected = (event: GamepadEvent) => {
      if (event.gamepad.index !== gamepadIndexRef.current) return;
      gamepadIndexRef.current = null;
      gamepadButtonsRef.current = [];
      stopGamepadMotion();
      setGamepadConnection(null);
    };
    const onWindowBlur = () => {
      inputSuspended = true;
      stopGamepadMotion();
    };
    const onWindowFocus = () => {
      inputSuspended = false;
    };

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads();
      let gamepad = gamepadIndexRef.current === null ? null : gamepads[gamepadIndexRef.current];
      if (!gamepad || !gamepad.connected || gamepad.mapping !== "standard") {
        const previousIndex = gamepadIndexRef.current;
        gamepad = Array.from(gamepads).find((candidate) => candidate?.connected && candidate.mapping === "standard") ?? null;
        gamepadIndexRef.current = gamepad?.index ?? null;
        if (gamepadIndexRef.current !== previousIndex) gamepadButtonsRef.current = [];
      }

      if (!gamepad) {
        stopGamepadMotion();
        setGamepadConnection((current) => current === null ? current : null);
        animationFrame = window.requestAnimationFrame(pollGamepad);
        return;
      }

      registerGamepad(gamepad);
      const reading = readStandardGamepad(gamepad, gamepadButtonsRef.current);
      gamepadButtonsRef.current = reading.buttons;
      const previousMove = gamepadMoveRef.current;
      const canDrive = controlMode === "manual" && running && !controllerMapOpen && !inputSuspended;
      const speedScale = manualPrecisionRef.current ? PRECISION_SPEED_SCALE : 1;
      gamepadMoveRef.current = canDrive
        ? { x: reading.move.x * speedScale, y: reading.move.y * speedScale }
        : { x: 0, y: 0 };
      if (
        Math.hypot(gamepadMoveRef.current.x, gamepadMoveRef.current.y) > 0.001
        || Math.hypot(previousMove.x, previousMove.y) > 0.001
      ) {
        setJoystickVisual(gamepadMoveRef.current);
      }

      cameraControlRef.current.x = controllerMapOpen || inputSuspended ? 0 : reading.look.x;
      cameraControlRef.current.y = controllerMapOpen || inputSuspended ? 0 : reading.look.y;

      const pressed = (button: number) => Boolean(reading.justPressed[button]);
      if (!inputSuspended) {
        if (pressed(STANDARD_GAMEPAD.buttons.menu)) toggleRun();
        if (pressed(STANDARD_GAMEPAD.buttons.view)) toggleControllerMap();
        if (pressed(STANDARD_GAMEPAD.buttons.rightStick)) {
          setCameraPreset("arena");
          cameraControlRef.current.resetToken += 1;
        }
        if (pressed(STANDARD_GAMEPAD.buttons.dpadUp)) setCameraPreset("overhead");
        if (pressed(STANDARD_GAMEPAD.buttons.dpadDown)) setCameraPreset("arena");
        if (pressed(STANDARD_GAMEPAD.buttons.dpadLeft)) setCameraPreset("atlas");
        if (pressed(STANDARD_GAMEPAD.buttons.dpadRight)) setCameraPreset("blaze");

        if (canDrive) {
          if (pressed(STANDARD_GAMEPAD.buttons.a)) toggleManualGrip();
          if (pressed(STANDARD_GAMEPAD.buttons.y)) toggleManualLift();
          if (pressed(STANDARD_GAMEPAD.buttons.x)) toggleManualPrecision();
          if (pressed(STANDARD_GAMEPAD.buttons.b)) homeManualArm();
        }
      }
      animationFrame = window.requestAnimationFrame(pollGamepad);
    };

    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    animationFrame = window.requestAnimationFrame(pollGamepad);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("gamepadconnected", onGamepadConnected);
      window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      stopGamepadMotion();
    };
  }, [
    controlMode,
    controllerMapOpen,
    homeManualArm,
    running,
    toggleControllerMap,
    toggleManualGrip,
    toggleManualLift,
    toggleManualPrecision,
    toggleRun,
  ]);

  useEffect(() => {
    const movementKeys: Record<string, string> = {
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
      ArrowUp: "forward", KeyW: "forward",
      ArrowDown: "back", KeyS: "back",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && controllerMapOpen) {
        event.preventDefault();
        closeControllerMap();
        return;
      }
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
      ) return;
      if (event.code === "Space") {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        toggleRun();
        return;
      }
      if (event.key.toLowerCase() === "x") {
        resetEpisode();
        return;
      }
      if (controlMode !== "manual" || !running) return;
      const movement = movementKeys[event.code];
      if (movement) {
        event.preventDefault();
        manualKeysRef.current.add(movement);
        return;
      }
      if (event.repeat) return;
      if (event.code === "KeyL") toggleManualLift();
      else if (event.code === "KeyG") toggleManualGrip();
      else if (event.code === "KeyP") toggleManualPrecision();
      else if (event.code === "KeyR") homeManualArm();
      else return;
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const movement = movementKeys[event.code];
      if (movement) manualKeysRef.current.delete(movement);
    };
    const clearControls = () => {
      manualKeysRef.current.clear();
      releaseJoystick();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearControls);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearControls);
    };
  }, [closeControllerMap, controlMode, controllerMapOpen, homeManualArm, releaseJoystick, resetEpisode, running, toggleManualGrip, toggleManualLift, toggleManualPrecision, toggleRun]);

  useEffect(() => {
    if (!running || controlMode !== "manual") {
      manualKeysRef.current.clear();
      joystickRef.current = { x: 0, y: 0 };
      gamepadMoveRef.current = { x: 0, y: 0 };
    }
  }, [controlMode, running]);

  const uploadPolicy = useCallback(async (file: File) => {
    const requestId = ++uploadRequestRef.current;
    setUploadState({ kind: "loading", message: `Checking ${file.name}…` });
    try {
      const runner = await UploadedPolicyRunner.fromFile(file);
      if (requestId !== uploadRequestRef.current) {
        runner.dispose();
        return;
      }
      runner.onError((message) => {
        setUploadState({ kind: "error", message });
        setRunning(false);
      });
      uploadedPolicyRef.current?.dispose();
      uploadedPolicyRef.current = runner;
      runner.reset({ task: selectedTaskId });
      setUploadedPolicyName(runner.name);
      setUploadState({ kind: "ready", message: `${runner.kind === "module" ? "Worker policy" : "Trajectory"} ready` });
      setPolicyChoice("uploaded");
      selectControlMode("policy");
    } catch (error) {
      if (requestId !== uploadRequestRef.current) return;
      setUploadState({
        kind: "error",
        message: error instanceof Error ? error.message : "Policy upload failed",
      });
    }
  }, [selectControlMode, selectedTaskId]);

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
          <div className="scene-canvas"><ArenaScene cameraPreset={cameraPreset} cameraControlRef={cameraControlRef} joints={snapshot.joints} opponentJoints={snapshot.opponentJoints} playerProgress={reward} opponentProgress={opponentReward} cubes={snapshot.cubes} cubeOwners={cubeOwners} collision={snapshot.collision} running={running} taskId={selectedTaskId} /></div>
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
          {controllerMapOpen && <ControllerMap controllerName={gamepadConnection?.name ?? null} onClose={closeControllerMap} />}
          <div className="competitor-labels" aria-hidden="true"><span className="atlas-label"><i />ATLAS</span><span className="blaze-label">BLAZE<i /></span></div>
          <div className="scene-caption">
            <div><span className="eyebrow">COMPETITORS</span><strong>2× SO-101 · Face-to-face</strong></div>
            <div><span className="eyebrow">PHYSICS</span><strong>MuJoCo · 200 Hz · {combatStats.blocks} blocks</strong></div>
            <div><span className="eyebrow">ENVIRONMENT</span><strong>{selectedTask.environment}</strong></div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="control-heading"><span className="eyebrow">MATCH CONTROL</span><h2>Head-to-head</h2></div>
          <div className="matchup-card" id="competitors"><span className="matchup-team atlas"><i />ATLAS<small>{controlMode === "manual" ? "YOU · MANUAL" : "YOUR POLICY"}</small></span><b>VS</b><span className="matchup-team blaze">BLAZE<i /><small>ADAPTIVE RIVAL</small></span></div>
          <div className="setup-group participation-group">
            <label>ATLAS INPUT <b>{controlMode === "manual" ? "HAND CONTROL" : "POLICY"}</b></label>
            <div className="participation-tabs" role="group" aria-label="Choose how to control Atlas">
              <button className={controlMode === "manual" ? "active" : ""} onClick={() => selectControlMode("manual")} aria-pressed={controlMode === "manual"}><span>✦</span> OPERATE BY HAND</button>
              <button className={controlMode === "policy" ? "active" : ""} onClick={() => selectControlMode("policy")} aria-pressed={controlMode === "policy"}><span>π</span> RUN A POLICY</button>
            </div>
          </div>
          {controlMode === "manual" ? (
            <section className="manual-console" aria-label="Manual SO-101 controls">
              <div className="console-heading"><span><b>{gamepadConnection ? "CONTROLLER DRIVE" : "JOYSTICK DRIVE"}</b><small>{gamepadConnection ? "Left stick · four actions" : "Drag, keys, or connect a gamepad"}</small></span><i className={running ? "armed" : ""}>{running ? "LIVE" : "START MATCH"}</i></div>
              <div className={`gamepad-banner ${gamepadConnection ? "connected" : ""}`}>
                <div><i /><span><strong>{gamepadConnection?.name ?? "XBOX / STANDARD GAMEPAD"}</strong><small>{gamepadConnection ? "PLAYER 1 · READY" : "PRESS ANY CONTROLLER BUTTON"}</small></span></div>
                <button type="button" onClick={toggleControllerMap}>MAP <kbd>▣</kbd></button>
              </div>
              <div
                className={`task-joystick ${running ? "live" : "locked"}`}
                role="group"
                aria-label="Move the Atlas gripper across the table"
                aria-disabled={!running}
                onContextMenu={(event) => event.preventDefault()}
                onPointerCancel={releaseJoystick}
                onPointerDown={(event) => {
                  if (!running) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  updateJoystick(event.currentTarget, event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (running && event.currentTarget.hasPointerCapture(event.pointerId)) {
                    updateJoystick(event.currentTarget, event.clientX, event.clientY);
                  }
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  releaseJoystick();
                }}
              >
                <span className="joystick-direction top">FAR</span>
                <span className="joystick-direction right">RIVAL</span>
                <span className="joystick-direction bottom">NEAR</span>
                <span className="joystick-direction left">HOME</span>
                <div className="joystick-orbit"><i /><i /></div>
                <div
                  className="joystick-knob"
                  style={{ transform: `translate(${joystickVisual.x * 39}px, ${joystickVisual.y * 39}px)` }}
                ><span>{gamepadConnection ? "LS" : "MOVE"}</span></div>
              </div>
              <div className="manual-actions" aria-label="Manual arm actions">
                <button className={!manualLifted ? "active" : ""} disabled={!running} onClick={toggleManualLift} aria-pressed={!manualLifted}><span className="xbox-key y">Y</span><strong>{manualLifted ? "LOWER" : "LIFT"}</strong><small>{manualLifted ? "TO CUBE" : "TO TRAVEL"} · L</small></button>
                <button className={manualGripping ? "active grip" : ""} disabled={!running} onClick={toggleManualGrip} aria-pressed={manualGripping}><span className="xbox-key a">A</span><strong>{manualGripping ? "DROP" : "GRAB"}</strong><small>{manualGripping ? "OPEN" : "CLOSE"} · G</small></button>
                <button className={manualPrecision ? "active precision" : ""} disabled={!running} onClick={toggleManualPrecision} aria-pressed={manualPrecision}><span className="xbox-key x">X</span><strong>PRECISION</strong><small>{manualPrecision ? "35% SPEED" : "FULL SPEED"} · P</small></button>
                <button disabled={!running} onClick={homeManualArm}><span className="xbox-key b">B</span><strong>HOME</strong><small>SAFE POSE · R</small></button>
              </div>
              <div className="manual-state" aria-live="polite"><span><i className={manualLifted ? "lifted" : ""} />{manualLifted ? "TRAVEL" : "CUBE HEIGHT"}</span><span><i className={manualGripping ? "gripping" : ""} />{manualGripping ? "GRIP CLOSED" : "GRIP OPEN"}</span><span><i className={manualPrecision ? "precision" : ""} />{manualPrecision ? "PRECISION" : "FULL SPEED"}</span></div>
              <p className="control-note">{gamepadConnection ? "LS moves · RS orbits · D-pad changes camera." : "Drag the stick or use WASD / arrow keys."} MuJoCo coordinates the joints.</p>
            </section>
          ) : (
            <section className="policy-console" aria-label="Policy controls">
              <div className="console-heading"><span><b>POLICY SOURCE</b><small>Choose built-in or upload yours</small></span><i className={uploadState.kind === "ready" ? "armed" : ""}>{policyChoice === "uploaded" ? "CUSTOM" : "BUILT-IN"}</i></div>
              <div className="policy-options">
                {POLICY_OPTIONS.map((policy) => (
                  <button className={policyChoice === policy.id ? "selected" : ""} onClick={() => setPolicyChoice(policy.id)} key={policy.id} aria-pressed={policyChoice === policy.id}>
                    <span className="policy-dot">π</span><span><strong>{policy.name}</strong><small>{policy.detail}</small></span><i>✓</i>
                  </button>
                ))}
                {uploadedPolicyName && (
                  <button className={policyChoice === "uploaded" ? "selected" : ""} onClick={() => {
                    uploadedPolicyRef.current?.reset({ task: selectedTaskId });
                    setPolicyChoice("uploaded");
                  }} aria-pressed={policyChoice === "uploaded"}>
                    <span className="policy-dot upload">↑</span><span><strong>{uploadedPolicyName}</strong><small>{uploadState.message}</small></span><i>✓</i>
                  </button>
                )}
              </div>
              <label className={`upload-policy-button ${uploadState.kind === "loading" ? "loading" : ""}`}>
                <input type="file" accept={POLICY_FILE_ACCEPT} disabled={uploadState.kind === "loading"} onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void uploadPolicy(file);
                  event.currentTarget.value = "";
                }} />
                <span>↑</span>{uploadState.kind === "loading" ? "VALIDATING…" : "UPLOAD YOUR POLICY"}<small>.JS · .MJS · .JSON</small>
              </label>
              <div className={`upload-status ${uploadState.kind}`} role="status"><i />{uploadState.message}</div>
              <p className="control-note">JavaScript policies run locally in a dedicated worker. JSON trajectories are validated against all joint limits. <a href="/policies/example-policy.js" download>Example policy ↓</a></p>
            </section>
          )}
          <div className="setup-group"><label>MATCH LENGTH <b>{matchLength} SEC{isHeist ? " · FIXED" : ""}</b></label><input type="range" min="10" max="60" step="5" value={matchLength} disabled={isHeist} onChange={(event) => setEpisodeLength(Number(event.target.value))} aria-label="Match length" /><div className="range-labels"><span>{isHeist ? "ONE-MINUTE MATCH" : "10s"}</span><span>60s</span></div></div>
          <button className="setup-group randomization-button" onClick={() => setRandomization((value) => !value)} aria-pressed={randomization}><label>DOMAIN RANDOMIZATION <b>{randomization ? "ON" : "OFF"}</b></label><span className="random-grid"><span><i />Lighting</span><span><i />Friction</span><span><i />Object pose</span><span><i />Camera</span></span></button>
          <div className="episode-progress"><span><b>{running ? matchCall : elapsed >= matchLength ? resultLabel : "READY TO RACE"}</b><i>{elapsed.toFixed(1)} / {matchLength}s</i></span><div><i style={{ width: `${progress}%` }} /></div></div>
          <div className="run-actions"><button className={`run-button ${running ? "pause" : ""}`} onClick={toggleRun}><span>{running ? "Ⅱ" : "▶"}</span> {running ? "PAUSE MATCH" : elapsed >= matchLength ? "RACE AGAIN" : elapsed > 0 ? "RESUME MATCH" : "START MATCH"}<small>{gamepadConnection ? "☰ / SPACE" : "SPACE"}</small></button><button className="reset-button" onClick={() => resetEpisode()} aria-label="Reset match">↺</button></div>
          <div className="metric-strip competitor-metrics"><div><span>ATLAS {isHeist ? "CUBES" : "SCORE"} · {combatStats.atlas} HITS</span><strong>{atlasScore}</strong></div><div><span>BLAZE {isHeist ? "CUBES" : "SCORE"} · {combatStats.blaze} HITS</span><strong>{blazeScore}</strong></div></div>
          <p className="hint">{controlMode === "manual" ? (gamepadConnection ? "Xbox-style controller ready" : "Drag the joystick while the match is live") : "Your selected policy controls Atlas"} · <kbd>X KEY</kbd> reset</p>
        </aside>
      </section>
    </main>
  );
}
