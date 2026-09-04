# RoboArena

RoboArena is a browser-based training ground for robot policies. This first slice focuses on the open SO-101 follower arm, a small manipulation task circuit, and a real MuJoCo WebAssembly simulation loop rendered with Three.js.

## What is included

- Three head-to-head tasks: Cube Heist, Stack Blocks, and Push to Target
- Two independently actuated copies of the Google DeepMind MuJoCo Menagerie SO-101 model
- Google DeepMind's first-party MuJoCo WebAssembly runtime
- The unmodified Menagerie MJCF, inertial properties, collision geometry, actuators, and joint limits
- Physical arm-vs-arm blocking, force-based strike events, and nine rigid contested cubes in one MuJoCo world
- Task-space joystick control with Lift/Lower, Grab/Drop, and Home actions
- Local JavaScript worker policies, validated JSON trajectories, and built-in baseline policies
- Physics-derived cube ownership, contact telemetry, combat stats, episode timing, and season metrics
- Responsive arena UI for desktop and mobile

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
```

## Physics tests

```bash
npm test
```

The integration suite compiles the real MJCF in MuJoCo WASM and verifies the dual actuator topology, collision-free reset pose, arm-vs-arm blocking forces, asymmetric strikes, and arm-to-cube contact.

## Participate manually

Choose **Operate by hand** and start the match. Drag the joystick to move the gripper directly across the tabletop; MuJoCo inverse kinematics coordinates the six SO-101 joints automatically.

- Joystick: drag, `WASD`, or arrow keys
- Lift/Lower: one height toggle or `L`
- Grab/Drop: one gripper toggle or `G`
- Home: safe-pose button or `R`
- Precision: 35% movement-speed toggle or `P`

Xbox and other standard browser gamepads use the game-first layout:

- Left stick: move the gripper across the table
- `A`: grab/drop; `Y`: lift/lower; `X`: precision; `B`: home
- Right stick: orbit the arena camera; right-stick click: recenter
- D-pad: Top, Arena, Atlas, and Blaze camera presets
- Menu: start/pause/resume; View: open/close the controller map

The same controls work with a mouse or touchscreen. The joystick target is workspace-limited, controller drift is removed with a radial deadzone, height changes are rate-limited, and **Home** restores the standard starting configuration without resetting the match. Gamepad motion stops immediately if the controller disconnects or the browser loses focus.

## Upload a policy

Choose **Run a policy** and upload a self-contained `.js`, `.mjs`, or `.json` file. JavaScript modules run locally in a dedicated Web Worker and must export an `act` function:

```js
export const policyName = "My policy";

export function reset({ task }) {
  // Optional per-match setup.
}

export function act(observation) {
  // Return six joint targets in radians.
  return [0, -0.62, 1.08, -0.48, 0, 0.72];
}
```

`observation` contains `time`, `task`, both arms' joint positions, all cube poses, contact counts, and the latest collision event. Only one `act()` call can be outstanding, actions must arrive within 500 ms, and every target is checked against the SO-101 joint limits before reaching MuJoCo. See the downloadable [example policy](public/policies/example-policy.js).

JSON policies provide a sampled trajectory and are linearly interpolated between actions:

```json
{
  "name": "My trajectory",
  "fps": 20,
  "loop": true,
  "actions": [
    [0, -0.62, 1.08, -0.48, 0, 0.72],
    [0.2, -0.55, 0.95, -0.35, 0.1, 0.2]
  ]
}
```

The app is statically exported and also prepares a lightweight hosting worker in `dist/`.

## Architecture

- `src/components/arena-app.tsx` owns tasks, participation modes, episodes, and controls.
- `src/lib/arm-participation.mjs` constrains joystick commands, validates uploaded-policy actions, and isolates JavaScript policies in workers.
- `src/lib/task-space-ik.mjs` converts gripper targets into safe joint commands through damped inverse kinematics.
- `src/components/arena-scene.tsx` parses the Menagerie MJCF and renders its STL hierarchy with React Three Fiber.
- `src/lib/mujoco-engine.ts` is the physics boundary. It drives both arms, classifies block/strike contacts, and returns all nine rigid-body cube poses.
- `public/models/robotstudio_so101/so101.xml` and its adjacent assets are the vendored Menagerie model.
- `public/models/robotstudio_so101/arena.xml` attaches the unmodified model twice with namespaced joints and defines the shared collision world.

## Model sources

- [Hugging Face LeRobot SO-101 guide](https://huggingface.co/docs/lerobot/so101)
- [Google DeepMind MuJoCo Menagerie SO-101](https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotstudio_so101)
- [Google DeepMind MuJoCo JavaScript bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)

The vendored Menagerie model is distributed under Apache-2.0. Its original `LICENSE`, `README.md`, and `CHANGELOG.md` are retained beside the assets.
