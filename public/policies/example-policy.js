// TORQUE LIMIT example policy (torquelimit.obs/3). Drop this file on the Entrants screen to register it.
// It holds a compact guard and throws a straight jab every 1.2 s, aimed at the opponent's hand.
// Everything is in radians; observations are in your own ego frame (+x toward the opponent), so the same
// file plays either seat.

export const policyName = "example guard + jab";
export const provenance = { author: "TORQUE LIMIT", kind: "hand-written example" };

// Joint targets [shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper].
const GUARD = [0, -1.586, 1.302, 0.583, 0, 0.04];   // hand at ego (0.24, 0, 0.15), tool tipped down
const JAB = [0, 0.219, 0.238, -0.157, 0, 0.04];     // hand at ego (0.40, 0, 0.13): full reach
const JAB_EVERY_S = 1.2;
const JAB_HOLD_S = 0.25;

let roundStart = null;

// reset(ctx) runs before every round; ctx carries the seed, side, rates, and arena geometry.
export function reset() {
  roundStart = null;
}

export function act(obs) {
  if (roundStart === null) roundStart = obs.t;
  const opp = obs.opponent.ee.pos;                   // opponent gripper tip, ego metres

  // Pan toward the opponent's hand. The pan axis sits 3.9 cm in front of the base; pan is negative toward +y.
  const pan = Math.max(-1.2, Math.min(1.2, -Math.atan2(opp[1], opp[0] - 0.0388)));

  const phase = (obs.t - roundStart) % JAB_EVERY_S;
  const jabbing = phase > JAB_EVERY_S - JAB_HOLD_S;
  const pose = jabbing ? JAB : GUARD;

  // Guard intent (Arcade) while not jabbing and the opponent's hand is within 30 cm of ours.
  const self = obs.self.ee.pos;
  const near = Math.hypot(opp[0] - self[0], opp[1] - self[1], opp[2] - self[2]) < 0.3;

  return {
    targets: [pan, pose[1], pose[2], pose[3], pose[4], pose[5]],
    intents: { guard: !jabbing && near },
  };
}
