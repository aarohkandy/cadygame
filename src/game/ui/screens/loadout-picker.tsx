// src/game/ui/screens/loadout-picker.tsx (WP7)
// The LOADOUT expander (7.3.3, 4.8): WHIP, PIVOT, ANVIL as slanted cards with torque, integrity, three bars built from
// the real tuning table (arrival speed, torque, integrity), and the signature ability, hidden until the kit unlocks.
"use client";

import type { JSX } from "react";
import type { LoadoutId } from "../../contracts.ts";
import { LOADOUTS, MEASURED_VREF } from "../../combat/tuning.ts";
import { SHOW_KIT_MATCHES } from "../../match/match-config.ts";
import { ABILITY_LABEL, LOADOUT_LABEL } from "../hud/format.ts";
import { useUiCue } from "../kit/slant-button.tsx";

export const LOADOUT_ORDER: readonly LoadoutId[] = ["whip", "pivot", "anvil"];

const FANTASY: Readonly<Record<LoadoutId, string>> = {
  whip: "FASTEST ARRIVAL · FRAGILE",
  pivot: "ALL-ROUNDER · BEST DEFLECTS",
  anvil: "WINS SHOVES · SLOW START",
};

const ABILITY_LINE: Readonly<Record<LoadoutId, string>> = {
  whip: "180 MS BURST OF TORQUE · 2 CHARGES",
  pivot: "NEXT GUARDED HIT BECOMES A DEFLECT",
  anvil: "3 S BRACED GUARD · NO CHIP DAMAGE",
};

function maxOf(pick: (id: LoadoutId) => number): number {
  return Math.max(...LOADOUT_ORDER.map(pick));
}

export function LoadoutPicker(props: { value: LoadoutId; onChange: (id: LoadoutId) => void; matchesPlayed: number }): JSX.Element {
  const play = useUiCue();
  const kitUnlocked = props.matchesPlayed >= SHOW_KIT_MATCHES;
  const vMax = maxOf((id) => MEASURED_VREF[id]);
  const tMax = maxOf((id) => LOADOUTS[id].tauMax);
  const iMax = maxOf((id) => LOADOUTS[id].integrity);

  return (
    <div className="loadout" role="radiogroup" aria-label="LOADOUT">
      {LOADOUT_ORDER.map((id, i) => {
        const def = LOADOUTS[id];
        const bars: readonly [string, number][] = [
          ["SPEED", MEASURED_VREF[id] / vMax],
          ["TORQUE", def.tauMax / tMax],
          ["INTEGRITY", def.integrity / iMax],
        ];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={props.value === id}
            className="loadout__card tl-anim-slide-up"
            style={{ animationDelay: `${i * 40}ms` }}
            onMouseEnter={() => play("hover")}
            onClick={() => { if (props.value !== id) { play("select"); props.onChange(id); } }}
          >
            <span className="loadout__name t-display-l t-slant">{LOADOUT_LABEL[id]}</span>
            <span className="loadout__fantasy t-label">{FANTASY[id]}</span>
            <span className="loadout__facts t-mono">{def.tauMax.toFixed(2)} N·m · {def.integrity} INTEGRITY</span>
            <span className="loadout__bars">
              {bars.map(([label, v]) => (
                <span key={label} className="loadout__bar">
                  <span className="t-label">{label}</span>
                  <span className="loadout__track"><i style={{ transform: `scaleX(${v.toFixed(3)})` }} /></span>
                </span>
              ))}
            </span>
            <span className="loadout__ability">
              {kitUnlocked
                ? <><span className="t-plate">{ABILITY_LABEL[def.ability]}</span><span className="t-label">{ABILITY_LINE[id]}</span></>
                : <span className="t-label t-dim">KIT UNLOCKS AFTER {SHOW_KIT_MATCHES} MATCHES</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
