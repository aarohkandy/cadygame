export const STANDARD_GAMEPAD = {
  buttons: {
    a: 0,
    b: 1,
    x: 2,
    y: 3,
    leftBumper: 4,
    rightBumper: 5,
    leftTrigger: 6,
    rightTrigger: 7,
    view: 8,
    menu: 9,
    leftStick: 10,
    rightStick: 11,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
  },
  axes: {
    leftX: 0,
    leftY: 1,
    rightX: 2,
    rightY: 3,
  },
};

export const GAMEPAD_DEADZONE = 0.14;
export const PRECISION_SPEED_SCALE = 0.35;

/**
 * Applies one radial deadzone to a stick so diagonal motion remains circular.
 * The remaining range is rescaled to preserve full-speed input at the edge.
 * @param {number} x
 * @param {number} y
 * @param {number} [deadzone]
 */
export function applyRadialDeadzone(x, y, deadzone = GAMEPAD_DEADZONE) {
  const rawMagnitude = Math.hypot(x, y);
  if (rawMagnitude <= deadzone) return { x: 0, y: 0 };
  const magnitude = Math.min(1, rawMagnitude);
  const scaledMagnitude = (magnitude - deadzone) / (1 - deadzone);
  const scale = scaledMagnitude / rawMagnitude;
  return { x: x * scale, y: y * scale };
}

/**
 * @param {{ axes: ArrayLike<number>, buttons: ArrayLike<{ pressed?: boolean, value?: number }> }} gamepad
 * @param {boolean[]} [previousButtons]
 */
export function readStandardGamepad(gamepad, previousButtons = []) {
  const axis = (index) => {
    const value = Number(gamepad.axes[index] ?? 0);
    return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
  };
  const buttons = Array.from(gamepad.buttons, (button) => Boolean(button?.pressed || (button?.value ?? 0) > 0.5));
  return {
    move: applyRadialDeadzone(
      axis(STANDARD_GAMEPAD.axes.leftX),
      axis(STANDARD_GAMEPAD.axes.leftY),
    ),
    look: applyRadialDeadzone(
      axis(STANDARD_GAMEPAD.axes.rightX),
      axis(STANDARD_GAMEPAD.axes.rightY),
    ),
    buttons,
    justPressed: buttons.map((pressed, index) => pressed && !previousButtons[index]),
  };
}
