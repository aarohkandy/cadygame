# RoboArena

RoboArena is a browser-based training ground for robot policies. This first slice focuses on the open SO-101 follower arm, a small manipulation task circuit, and a real MuJoCo WebAssembly simulation loop rendered with Three.js.

## What is included

- Three interactive tasks: Lift Cube, Stack Blocks, and Push to Target
- The exact Google DeepMind MuJoCo Menagerie SO-101 mesh model with six controlled joints
- Google DeepMind's first-party MuJoCo WebAssembly runtime
- The unmodified Menagerie MJCF, inertial properties, collision geometry, actuators, and joint limits
- Manual keyboard control, scripted baseline, and random exploration policies
- Episode timing, rewards, contacts, simulation state, and season metrics
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

The app is statically exported and also prepares a lightweight hosting worker in `dist/`.

## Architecture

- `src/components/arena-app.tsx` owns tasks, policies, episodes, and controls.
- `src/components/arena-scene.tsx` parses the Menagerie MJCF and renders its STL hierarchy with React Three Fiber.
- `src/lib/mujoco-engine.ts` is the physics boundary. Replace or extend this class when moving policy execution to a worker or remote trainer.
- `public/models/robotstudio_so101/so101.xml` and its adjacent assets are the vendored Menagerie model.
- `public/models/robotstudio_so101/arena.xml` is RoboArena's task-scene wrapper around the unmodified model.

The next natural step is to define a stable policy contract such as `reset(task)`, `act(observation)`, and `close()`, then run user policies in isolated workers against batched MuJoCo environments.

## Model sources

- [Hugging Face LeRobot SO-101 guide](https://huggingface.co/docs/lerobot/so101)
- [Google DeepMind MuJoCo Menagerie SO-101](https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotstudio_so101)
- [Google DeepMind MuJoCo JavaScript bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)

The vendored Menagerie model is distributed under Apache-2.0. Its original `LICENSE`, `README.md`, and `CHANGELOG.md` are retained beside the assets.
