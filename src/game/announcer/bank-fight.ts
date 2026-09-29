// src/game/announcer/bank-fight.ts (WP3)
// ROOK and DR. VALE on the exchange itself: contact, defence, heat, and the slow patches where nothing lands.
// Copy rules live in lines.ts and are enforced by tests/host-lines.test.mjs. ROOK carries no number; most of
// VALE's lines carry one. `deep` lines are rare payoffs that only unlock deep into a session.

import type { EventBank, LineEvent } from "./line-types.ts";

export const FIGHT_BANK: Readonly<Partial<Record<LineEvent, EventBank>>> = {
  first_strike: {
    rook: [
      "First contact goes to {actor}.",
      "{actor} draws first. Table is open.",
      "There it is. Somebody had to start.",
      "{actor} breaks the seal on this round.",
      "Handshake is over. {actor} went first.",
      "{target} blinked. {actor} did not.",
      "That is first blood to {actor}.",
      "{actor} stops asking and starts hitting.",
    ],
    vale: [
      "First scoring contact at {secs} seconds.",
      "{actor} opens the account, {secs} seconds in.",
      "{secs} seconds of circling, then that.",
      "First contact logged. {secs} seconds elapsed.",
      "{actor} scores first after {secs} seconds.",
      "Contact one to {actor}, {secs} seconds.",
      "First strike bonus goes to {actor}.",
      "{target} conceded the opening exchange.",
    ],
    deepVale: ["Openers correlate weakly with round wins."],
  },

  crit: {
    rook: [
      "Right in the optics.",
      "Off the camera mount. That stings.",
      "That found the lens.",
      "Straight into the eyes of {target}.",
      "Sensor head. Worst place to take one.",
      "{target} is seeing double now.",
      "{actor} went hunting for the camera.",
      "Optics. The one part you cannot armour.",
      "That is a lens {target} will miss.",
    ],
    vale: [
      "Optics hit at {speed} meters per second.",
      "Camera mount, {dmg} damage. Recalibration pending.",
      "{dmg} on the lens. {target} saw it late.",
      "Sensor head struck at {speed} meters a second.",
      "Critical zone. {dmg} instead of the usual.",
      "{speed} meters a second into the weakest plate.",
      "That multiplier is why {dmg} looks wrong.",
      "Optics take damage at full rate. {dmg}.",
      "{target} loses tracking for a moment.",
    ],
    deepVale: ["Third optics hit tonight. Someone has a plan."],
  },

  big_hit: {
    rook: [
      "Full swing. That rattled the table.",
      "Oh, that one had everything on it.",
      "{actor} is swinging for the rafters.",
      "You felt that one in the stands.",
      "No wrist in that. All shoulder.",
      "{target} took that one flush.",
      "Wind up, commit, collect. Simple.",
      "That is why the bench has spares.",
      "{actor} put the whole arm through it.",
      "Clean transfer. Nothing wasted.",
    ],
    vale: [
      "{dmg} damage on a single contact.",
      "{speed} meters a second at contact.",
      "That was {dmg}. {target} will feel it.",
      "Contact speed {speed}. Nothing held back.",
      "{dmg} through the guard, not around it.",
      "Peak of {speed} meters per second there.",
      "{dmg}, and no guard.",
      "All of it transferred. {dmg} on the plate, cleanly.",
      "{speed} at the gripper. Mechanics were clean.",
      "{actor} is averaging heavier contacts now.",
    ],
    deepRook: ["Somebody tighten that shoulder bolt."],
  },

  deflect: {
    rook: [
      "Turned away. {target} is stunned.",
      "Read it like a manual.",
      "Deflected. What a read by {actor}.",
      "Swatted clean out of the air.",
      "{actor} knew that was coming.",
      "Guard up, problem gone.",
      "{target} announced that one early.",
      "Perfect timing. Nothing else to say.",
      "Nothing got through.",
      "Turned aside cleanly.",
      "{actor} was already there waiting.",
    ],
    vale: [
      "Deflected {ms} milliseconds before contact.",
      "Guard came up {ms} milliseconds early.",
      "{ms} milliseconds of margin. That was a read.",
      "{actor} parried with {ms} milliseconds to spare.",
      "Inside the window by {ms} milliseconds.",
      "{ms} milliseconds. The window is not generous.",
      "A deflect, not a block. {ms} milliseconds.",
      "{target} telegraphed it. {actor} used {ms} milliseconds.",
      "Timed to within {ms} milliseconds.",
      "Consistently {ms} milliseconds early now. Not luck twice.",
      "Reaction or prediction, {ms} milliseconds says prediction.",
    ],
    deepVale: ["Deflect rate is climbing. {actor} is adapting."],
  },

  late_guard: {
    rook: [
      "Guard came up after the arm already landed.",
      "{actor} was half a beat slow.",
      "Too late.",
      "Hand up, but the damage was done.",
      "{actor} got some of it, not all.",
    ],
    vale: [
      "Guard late by {ms} milliseconds.",
      "{ms} milliseconds past the window. Partial refund.",
      "{actor} missed the deflect by {ms} milliseconds.",
      "Late press, {ms} milliseconds. Some damage returned.",
      "The window had already closed, by {ms} milliseconds.",
    ],
  },

  clash: {
    rook: [
      "Both committed. Nobody wins that.",
      "Grippers met in the middle.",
      "That is two arms disagreeing loudly.",
      "Straight into each other.",
      "Somebody has to give ground eventually, surely.",
    ],
    vale: [
      "Clash at {secs} seconds. Neither gave ground.",
      "Simultaneous contact, no damage.",
      "{actor} carried the heavier arm through that.",
      "Equal commitment, {secs} seconds into the round.",
      "Both arms absorbed the shock and nothing scored.",
    ],
  },

  combo: {
    rook: [
      "{actor} is teeing off now.",
      "{target} cannot get a hand up.",
      "Keep swinging. Nobody is stopping this.",
      "{target} is stuck in the washer.",
      "Chained. {target} never reset.",
      "Somebody call the bench.",
    ],
    vale: [
      "{count} unanswered strikes from {actor}.",
      "{count} in a row. {target} needs a plan.",
      "{count} strikes, {dmg} damage, no reply.",
      "{target} has not recovered in {count} contacts.",
      "{secs} seconds of this. {target} is stuck.",
      "{actor} is exploiting recovery frames. {count} now.",
    ],
    deepRook: ["I have seen bench tests kinder than this."],
  },

  whiff_streak: {
    rook: [
      "{actor} is swinging at nothing.",
      "All air. {target} has not moved.",
      "{actor} needs to find the range.",
      "Somebody move the table closer.",
      "That is a lot of wasted servo.",
      "{actor} is fighting a memory.",
    ],
    vale: [
      "{count} swings from {actor}, none landed.",
      "{count} misses in {secs} seconds. Range is wrong.",
      "{actor} is short by a consistent margin.",
      "{count} whiffs and the heat to match.",
      "{secs} seconds in, and still no contact.",
      "Miss count {count}. Aim is not the problem.",
    ],
    deepVale: ["Whiff streaks predict the next stagger fairly well."],
  },

  heat_warning: {
    rook: [
      "{actor} is running warm.",
      "Shoulder is glowing over there.",
      "Ease off or lose the arm.",
      "{actor} is cooking the servos.",
      "That amber light means something.",
    ],
    vale: [
      "{actor} is into the thermal warning band.",
      "Heat rising, {secs} seconds into the round.",
      "{actor} has seconds before the cutout.",
      "Duty cycle exceeded. {actor} must idle.",
      "Warning band at {secs} seconds. Early for that.",
    ],
  },

  overheat: {
    rook: [
      "Cutout. The arm just quit.",
      "{actor} cooked it. Nothing responds.",
      "Servos are out. Stand there and wait.",
      "{actor} pushed one swing too far.",
      "That is the thermal limit, live.",
      "Dead arm. Not a hit. Just heat.",
    ],
    vale: [
      "Thermal cutout at {secs} seconds.",
      "{actor} is locked out until the coils cool.",
      "Overheat. {actor} loses several seconds.",
      "Duty cycle spent. Cutout at {secs} seconds.",
      "{target} has a free window. Use it.",
      "{actor} tripped protection, not damage.",
    ],
    deepRook: ["The game is named after this exact moment."],
  },

  burst: {
    rook: [
      "Burst. {actor} spent the reserve.",
      "There goes the one good push.",
      "{actor} is not saving anything now.",
      "Overdrive up. No second one coming.",
      "One burst per arm. That was it.",
    ],
    vale: [
      "Burst discharged at {secs} seconds.",
      "{actor} has no reserve left this round.",
      "Torque ceiling raised briefly. {secs} seconds in.",
      "One burst per round. {actor} used it.",
      "Peak torque, for a very short window indeed.",
    ],
  },

  table_slam: {
    rook: [
      "Right into the bench.",
      "{actor} hit the table, not {target}.",
      "The bench took that one.",
      "Everything on the table jumped.",
      "Aim higher. Wood does not score.",
    ],
    vale: [
      "{newtons} newtons into the table surface.",
      "That was {newtons} newtons of nothing.",
      "Bench load spike, {newtons} newtons.",
      "{actor} put {newtons} newtons into plywood.",
      "The table logged {newtons} newtons there.",
    ],
    deepVale: ["The bench is rated well under {newtons} newtons."],
  },

  joint_limit: {
    rook: [
      "That joint is past where it should go.",
      "{actor} is fighting the hardware.",
      "Something in there is complaining.",
      "You can hear the limit switch.",
      "{actor} is asking for more than it has.",
    ],
    vale: [
      "Joint limit exceeded, {secs} seconds in.",
      "{actor} is commanding past the mechanical stop.",
      "The controller clipped that request.",
      "Limit violation logged at {secs} seconds.",
      "{actor} would move further if physics allowed.",
    ],
    deepVale: ["Limit violations here usually mean a bad policy."],
  },

  low_integrity: {
    rook: [
      "{actor} is smoking at the shoulder.",
      "{actor} is hanging on by a wire.",
      "One more clean hit ends {actor}.",
      "That frame is not going to hold.",
      "Hold that arm together, {actor}.",
      "Guard everything now. Everything.",
    ],
    vale: [
      "{actor} is under a quarter integrity.",
      "Below a quarter, {secs} seconds into the round.",
      "{actor} cannot survive another heavy contact.",
      "Structural margin is effectively gone.",
      "One strike above average ends {actor}.",
      "Integrity critical at {secs} seconds.",
    ],
  },

  stalemate: {
    rook: [
      "Somebody commit. Anybody.",
      "Lots of hovering out there.",
      "This is a staring contest with servos.",
      "The crowd paid for contact.",
      "Both arms are waiting for an invitation.",
      "Nobody wants the first mistake.",
    ],
    vale: [
      "{secs} seconds without arm contact.",
      "No contact for {secs} seconds. Very cautious.",
      "Mutual respect, or mutual fear, for {secs} seconds.",
      "Neither has closed distance in {secs} seconds.",
      "{secs} seconds. The clock does not care.",
      "Stand-off at {secs} seconds and counting.",
    ],
    deepRook: ["I could rewire a gripper in this silence."],
  },

  policy_fault: {
    rook: [
      "Something went wrong on that bench.",
      "{actor} just stopped thinking.",
      "The controller dropped a frame there.",
      "{actor} is standing there confused.",
      "That is not a tactic. That is a fault.",
    ],
    vale: [
      "{actor} missed its action window.",
      "Controller fault logged at {secs} seconds.",
      "{actor} returned nothing this decision step.",
      "A held action, not a chosen one.",
      "Fault at {secs} seconds. The log will say why.",
    ],
    deepVale: ["Faults cluster. Expect another shortly."],
  },
};
