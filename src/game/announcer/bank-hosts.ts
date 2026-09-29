// src/game/announcer/bank-hosts.ts (WP7)
// The beats EMOTION_BIBLE 7 added to the hosts: VALE's coaching lines (matches 1 to 3, tied to state, never a
// number), the momentum stabs (a streak of three and the moment it breaks), the crowd-meter lines, the chaos class
// (ROOK's one caption for the clip that goes on the show), and the four narrative threads a round can carry
// (comeback, revenge, first blood, the clock) with lines that reference this round's events through tokens.

import type { EventBank, LineEvent } from "./line-types.ts";

export const HOSTS_BANK: Readonly<Partial<Record<LineEvent, EventBank>>> = {
  /* coaching: VALE only, state-tied, one per 8 s, only while the opponent's menace is low */
  coach_passive: {
    rook: [],
    vale: [
      "Swing the mouse across it.",
      "It is inside your reach. Flick.",
      "Move the mouse fast. The arm follows.",
      "Nothing lands until you swing.",
      "Aim past it, then flick back.",
      "Cross its gripper with yours.",
      "Short flick. Let the wrist do it.",
      "Any contact counts. Swing.",
      "It will wait there. Hit it.",
      "The whip comes from the mouse, not the arm.",
      "You are in range. Use it.",
      "Flick through the gripper, not at it.",
    ],
  },
  coach_turtle: {
    rook: [],
    vale: [
      "It will not come to you. Flick at it.",
      "Guard is for the wind-up, not the round.",
      "Drop the guard between its swings.",
      "Nothing scores from behind a guard.",
      "It waits when you wait. Break first.",
      "Let go of guard. Then swing.",
      "Guard eats the heavy. Then answer it.",
      "Holding guard gives it the round.",
      "Release, swing, guard again. That order.",
      "Watch its shoulder. Guard on the lift only.",
      "You are safe. You are also not scoring.",
      "Guard late, swing early.",
    ],
  },
  coach_whiff: {
    rook: [],
    vale: [
      "Shorter swings. It is closer than it looks.",
      "You are swinging past it. Pull in.",
      "Reach in first, then flick.",
      "That arc is too wide. Tighten it.",
      "Aim at the wrist, not the gripper.",
      "Let it settle, then hit it.",
      "Three misses. Half the swing next time.",
      "Stop chasing. Let it come back in.",
      "Depth is off. Bring the reach in.",
      "Swing where it will be, not where it was.",
      "Smaller mouse move. Same speed.",
      "Reset the aim. It has not moved.",
    ],
  },
  coach_guard: {
    rook: [],
    vale: [
      "Hold guard when it winds up.",
      "That was a tell. Guard on the next one.",
      "Watch for the lift. That is the heavy.",
      "Its LED goes bright before it swings.",
      "Right mouse. Hold it through the swing.",
      "It telegraphs everything. Read the shoulder.",
      "The whine rises before a heavy. Listen.",
      "Guard costs nothing. Take the hit on it.",
      "Block once and it flinches.",
      "The wind-up is long. Guard fits inside it.",
      "Hold guard now. Then punish.",
      "Its heavy comes from the top. Guard high.",
    ],
  },

  /* momentum: three unanswered hits, and the moment the run breaks */
  momentum_up: {
    rook: [
      "{actor} is rolling.",
      "Three in a row. Keep going.",
      "That is a run. Do not stop.",
      "{target} cannot find the door.",
      "{actor} owns the middle right now.",
      "Everything {actor} throws is landing.",
      "Momentum. Feel it.",
      "{target} has not answered once.",
    ],
    vale: [
      "{count} unanswered.",
      "{count} unanswered, {secs} seconds in.",
      "{actor} has landed {count} straight.",
      "{count} clean contacts, nothing back.",
      "Streak at {count}. {target} has not scored since.",
      "{count} in a row for {actor}.",
      "Run of {count}. {dmg} damage inside it.",
      "{actor}: {count} without reply.",
    ],
  },
  momentum_down: {
    rook: [
      "And the run is over.",
      "{target} finally answers.",
      "That stops the bleeding.",
      "{actor} got one back.",
      "The streak just snapped.",
      "{target} is back in it.",
      "Answered. Now it is a fight again.",
      "One hit changes the room.",
    ],
    vale: [
      "Streak broken at {count}.",
      "{count} unanswered, then that.",
      "{target} ends the run at {count}.",
      "Run over. {count} was the peak.",
      "First reply after {count} straight.",
      "{count} in a row, stopped {secs} seconds in.",
      "The run ended at {count}.",
      "Streak of {count} closed by one contact.",
      "{dmg} damage in that run before it broke.",
    ],
  },

  /* crowd meter: what the room is doing, said once in a while when nothing else is */
  crowd: {
    rook: [
      "Listen to that room.",
      "The bench crowd is on its feet.",
      "They want the heavy. Give it to them.",
      "This crowd came for exactly this.",
      "Every seat is leaning in.",
      "That murmur means they smell a finish.",
      "Nobody in here is sitting down.",
      "The room went quiet. That is respect.",
    ],
    vale: [
      "Crowd noise is climbing.",
      "Everybody is waiting on a heavy.",
      "Applause every contact now.",
      "Quiet room. Both arms are being careful.",
      "The stomps started. The room wants a lock.",
      "Noise peaks on your swings, not its.",
      "They read the clock too.",
      "The room dipped. Somebody swing.",
    ],
  },

  /* chaos: the funny failure, the clip that goes on the show */
  chaos: {
    rook: [
      "That is going on the show.",
      "Somebody clip that.",
      "The cube left the building.",
      "Off the deck. Gone. Beautiful.",
      "That was not in the plan.",
      "The bench did not consent to that.",
      "Replay that one for the room.",
      "Hardware doing hardware things.",
      "That cube is somebody's problem now.",
      "Arms everywhere. None of them scoring.",
      "Physics won that exchange.",
      "The show writes itself tonight.",
    ],
    vale: [
      "One cube off the deck.",
      "{count} cubes off the deck now.",
      "That contact was not a strike. Logged anyway.",
      "The deck lost a cube at {secs} seconds.",
      "Cube count on the deck dropped at {secs} seconds.",
    ],
  },

  /* narrative threads: one per round, 4 to 6 lines that reference this round's events */
  thread_comeback: {
    rook: [
      "{actor} was done a minute ago. Look now.",
      "Written off. Still swinging.",
      "{actor} is climbing out of it.",
      "Do not count that arm out.",
    ],
    vale: [
      "{actor} was under a quarter. Now {dmg} dealt since.",
      "From critical to {dmg} damage dealt. Real recovery.",
      "{actor} has landed {count} since the low point.",
    ],
  },
  thread_revenge: {
    rook: [
      "{actor} remembers last round.",
      "That is a grudge, not a strategy.",
      "{actor} wants that round back.",
      "Same arm, different mood.",
    ],
    vale: [
      "{actor} lost the last round. Opening faster now.",
      "First attack at {secs} seconds. Quicker than round {round}.",
      "{actor} is pressing. {dmg} dealt already this round.",
    ],
  },
  thread_first_blood: {
    rook: [
      "{actor} drew first. Now hold it.",
      "First blood set the pace.",
      "{actor} opened the round. {target} has to chase.",
      "Started it. Has to finish it.",
    ],
    vale: [
      "First contact at {secs} seconds. {actor} led since.",
      "{actor} opened with {speed} metres a second.",
      "Since first blood: {dmg} damage from {actor}.",
    ],
  },
  thread_clock: {
    rook: [
      "Clock is the third fighter now.",
      "Somebody has to make it happen.",
      "Time is on nobody's side.",
      "Last chances. Spend them.",
    ],
    vale: [
      "{secs} seconds left. Margin is {dmg}.",
      "{secs} on the clock. One heavy decides it.",
      "Under {secs} seconds. No Core, so damage decides.",
    ],
  },
};
