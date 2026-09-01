/**
 * Solves a small damped-least-squares position IK problem. MuJoCo owns the
 * forward-kinematics callback; this module keeps the numerical solver testable
 * without coupling it to the browser WASM lifecycle.
 *
 * @param {{
 *   seed: number[],
 *   target: number[],
 *   limits: Array<{ min: number, max: number }>,
 *   positionFor: (joints: number[]) => number[],
 *   iterations?: number,
 *   damping?: number,
 *   tolerance?: number,
 *   maxStep?: number,
 * }} options
 */
export function solvePositionIK({
  seed,
  target,
  limits,
  positionFor,
  iterations = 12,
  damping = 0.018,
  tolerance = 0.0015,
  maxStep = 0.14,
}) {
  if (seed.length !== limits.length) throw new Error("IK seed and limits must have equal lengths");
  if (target.length !== 3 || target.some((value) => !Number.isFinite(value))) {
    throw new Error("IK target must be a finite XYZ position");
  }
  let joints = seed.map((value, index) => clamp(value, limits[index].min, limits[index].max));
  let error = Number.POSITIVE_INFINITY;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const position = positionFor(joints);
    const residual = target.map((value, index) => value - position[index]);
    error = Math.hypot(...residual);
    if (error <= tolerance) break;

    const epsilon = 0.0001;
    const jacobian = Array.from({ length: 3 }, () => Array(joints.length).fill(0));
    for (let jointIndex = 0; jointIndex < joints.length; jointIndex += 1) {
      const direction = joints[jointIndex] + epsilon <= limits[jointIndex].max ? 1 : -1;
      const delta = epsilon * direction;
      const perturbed = [...joints];
      perturbed[jointIndex] += delta;
      const perturbedPosition = positionFor(perturbed);
      for (let axis = 0; axis < 3; axis += 1) {
        jacobian[axis][jointIndex] = (perturbedPosition[axis] - position[axis]) / delta;
      }
    }

    const normal = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => {
        let value = row === column ? damping * damping : 0;
        for (let jointIndex = 0; jointIndex < joints.length; jointIndex += 1) {
          value += jacobian[row][jointIndex] * jacobian[column][jointIndex];
        }
        return value;
      }),
    );
    const taskStep = solveLinear3(normal, residual);
    const jointStep = joints.map((_, jointIndex) =>
      jacobian[0][jointIndex] * taskStep[0]
      + jacobian[1][jointIndex] * taskStep[1]
      + jacobian[2][jointIndex] * taskStep[2],
    );
    const largestStep = Math.max(...jointStep.map(Math.abs));
    const stepScale = largestStep > maxStep ? maxStep / largestStep : 1;
    joints = joints.map((value, index) =>
      clamp(value + jointStep[index] * stepScale, limits[index].min, limits[index].max),
    );
  }

  const finalPosition = positionFor(joints);
  error = Math.hypot(...target.map((value, index) => value - finalPosition[index]));
  return { joints, position: finalPosition, error };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function solveLinear3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return [0, 0, 0];
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index < 4; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const multiplier = rows[row][column];
      for (let index = column; index < 4; index += 1) {
        rows[row][index] -= multiplier * rows[column][index];
      }
    }
  }
  return rows.map((row) => row[3]);
}
