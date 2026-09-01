export const policyName = "Center sweep example";

export function reset({ task }) {
  console.info(`Starting ${task} with the example policy`);
}

export function act(observation) {
  const t = observation.time;
  const closeGripper = Math.sin(t * 0.8) > 0.25;
  return [
    Math.sin(t * 0.65) * 0.48,
    -0.62 + Math.sin(t * 0.8) * 0.22,
    1.02 + Math.cos(t * 0.75) * 0.24,
    -0.48 + Math.sin(t) * 0.2,
    Math.sin(t * 1.1) * 0.35,
    closeGripper ? 0.08 : 1.05,
  ];
}
