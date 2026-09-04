import {
  JOINT_CONTROLS,
  MANUAL_GRIPPER_TARGETS,
  MANUAL_HEIGHTS,
} from "./arm-participation.mjs";
import { PRECISION_SPEED_SCALE } from "./gamepad-controls.mjs";

/** @typedef {"hand" | "joint"} ManualDriveMode */

export const HAND_HEIGHT_SPEED = 0.28;
export const HAND_WRIST_ROLL_SPEED = 1.55;

/** Shared + hand-mode action codes held in the key set. */
export const HAND_KEY_CODES = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowDown: "back",
  KeyS: "back",
  KeyR: "raise",
  KeyF: "lower",
  KeyQ: "rollCcw",
  KeyE: "rollCw",
  KeyG: "gripClose",
  KeyH: "gripOpen",
};

/**
 * Joint-mode action codes. Values are `joint:{index}:{dir}` so one set can
 * drive all six DOFs without colliding with hand XY names.
 */
export const JOINT_KEY_CODES = {
  KeyA: "joint:0:neg",
  KeyD: "joint:0:pos",
  KeyS: "joint:1:neg",
  KeyW: "joint:1:pos",
  ArrowDown: "joint:2:neg",
  ArrowUp: "joint:2:pos",
  KeyQ: "joint:3:neg",
  KeyE: "joint:3:pos",
  KeyZ: "joint:4:neg",
  KeyC: "joint:4:pos",
  KeyG: "joint:5:neg",
  KeyH: "joint:5:pos",
};

export const HAND_LEGEND = [
  { keys: "W A S D", action: "Move gripper" },
  { keys: "R / F", action: "Raise / lower" },
  { keys: "Q / E", action: "Wrist roll" },
  { keys: "G / H", action: "Close / open grip" },
  { keys: "Shift", action: "Precision hold" },
  { keys: "Tab", action: "Switch to Joint" },
  { keys: "B", action: "Home arm" },
];

export const JOINT_LEGEND = [
  { keys: "A / D", action: "Base yaw" },
  { keys: "W / S", action: "Shoulder" },
  { keys: "↑ / ↓", action: "Elbow" },
  { keys: "Q / E", action: "Wrist pitch" },
  { keys: "Z / C", action: "Wrist roll" },
  { keys: "G / H", action: "Gripper" },
  { keys: "Shift", action: "Precision hold" },
  { keys: "Tab", action: "Switch to Hand" },
  { keys: "B", action: "Home arm" },
];

/**
 * @param {ManualDriveMode} mode
 * @returns {Record<string, string>}
 */
export function keyCodesForMode(mode) {
  return mode === "joint" ? JOINT_KEY_CODES : HAND_KEY_CODES;
}

/**
 * @param {ManualDriveMode} mode
 */
export function legendForMode(mode) {
  return mode === "joint" ? JOINT_LEGEND : HAND_LEGEND;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} precisionScale
 */
export function resolvePrecisionScale(precisionScale) {
  if (!Number.isFinite(precisionScale) || precisionScale <= 0) return 1;
  return precisionScale;
}

/**
 * Step all six joint targets from held joint-mode keys.
 * @param {number[]} joints
 * @param {Set<string> | Iterable<string>} heldKeys
 * @param {number} deltaSeconds
 * @param {number} [precisionScale]
 */
export function stepJointTargets(joints, heldKeys, deltaSeconds, precisionScale = 1) {
  const held = heldKeys instanceof Set ? heldKeys : new Set(heldKeys);
  const scale = resolvePrecisionScale(precisionScale);
  return JOINT_CONTROLS.map((joint, index) => {
    const current = joints[index] ?? 0;
    const positive = held.has(`joint:${index}:pos`);
    const negative = held.has(`joint:${index}:neg`);
    const direction = Number(positive) - Number(negative);
    if (direction === 0) return clamp(current, joint.min, joint.max);
    return clamp(current + direction * joint.speed * scale * deltaSeconds, joint.min, joint.max);
  });
}

/**
 * Continuous hand-mode height within the travel/cube envelope.
 * @param {number} targetZ
 * @param {boolean} holdRaise
 * @param {boolean} holdLower
 * @param {number} deltaSeconds
 * @param {number} [precisionScale]
 */
export function stepHandHeight(targetZ, holdRaise, holdLower, deltaSeconds, precisionScale = 1) {
  const scale = resolvePrecisionScale(precisionScale);
  const direction = Number(holdRaise) - Number(holdLower);
  if (direction === 0) return clamp(targetZ, MANUAL_HEIGHTS.lowered, MANUAL_HEIGHTS.lifted);
  return clamp(
    targetZ + direction * HAND_HEIGHT_SPEED * scale * deltaSeconds,
    MANUAL_HEIGHTS.lowered,
    MANUAL_HEIGHTS.lifted,
  );
}

/**
 * Continuous gripper open/close.
 * @param {number} value
 * @param {boolean} holdClose
 * @param {boolean} holdOpen
 * @param {number} deltaSeconds
 * @param {number} [precisionScale]
 */
export function stepGripper(value, holdClose, holdOpen, deltaSeconds, precisionScale = 1) {
  const joint = JOINT_CONTROLS[5];
  const scale = resolvePrecisionScale(precisionScale);
  const direction = Number(holdOpen) - Number(holdClose);
  if (direction === 0) {
    return clamp(value, joint.min, joint.max);
  }
  return clamp(value + direction * joint.speed * scale * deltaSeconds, joint.min, joint.max);
}

/**
 * Hand-mode wrist roll after position IK.
 * @param {number} value
 * @param {boolean} holdCcw
 * @param {boolean} holdCw
 * @param {number} deltaSeconds
 * @param {number} [precisionScale]
 */
export function stepWristRoll(value, holdCcw, holdCw, deltaSeconds, precisionScale = 1) {
  const joint = JOINT_CONTROLS[4];
  const scale = resolvePrecisionScale(precisionScale);
  const direction = Number(holdCw) - Number(holdCcw);
  if (direction === 0) return clamp(value, joint.min, joint.max);
  return clamp(value + direction * HAND_WRIST_ROLL_SPEED * scale * deltaSeconds, joint.min, joint.max);
}

/**
 * Resolve keyboard XY contribution for hand mode.
 * @param {Set<string> | Iterable<string>} heldKeys
 * @param {number} [precisionScale]
 */
export function handKeyboardAxes(heldKeys, precisionScale = 1) {
  const held = heldKeys instanceof Set ? heldKeys : new Set(heldKeys);
  const scale = resolvePrecisionScale(precisionScale);
  return {
    x: (Number(held.has("right")) - Number(held.has("left"))) * scale,
    y: (Number(held.has("back")) - Number(held.has("forward"))) * scale,
  };
}

/**
 * @param {number} gripper
 */
export function gripperLooksClosed(gripper) {
  const midpoint = (MANUAL_GRIPPER_TARGETS.closed + MANUAL_GRIPPER_TARGETS.open) / 2;
  return gripper < midpoint;
}

export { PRECISION_SPEED_SCALE };
