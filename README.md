# RoboArena

RoboArena is a browser-based training ground for robot policies. This first slice focuses on an SO-101 follower arm, a small manipulation task circuit, and a real MuJoCo WebAssembly simulation loop rendered with Three.js.

## What is included

- Three interactive tasks: Lift Cube, Stack Blocks, and Push to Target
- A procedural SO-101 visualization with six controlled joints
- Google DeepMind's first-party MuJoCo WebAssembly runtime
- A compact SO-101 MJCF model based on TheRobotStudio's open model parameters
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
- `src/components/arena-scene.tsx` renders the robot and arena with React Three Fiber.
- `src/lib/mujoco-engine.ts` is the physics boundary. Replace or extend this class when moving policy execution to a worker or remote trainer.
- `public/models/so101_arena.xml` is the compact simulation model.

The next natural step is to define a stable policy contract such as `reset(task)`, `act(observation)`, and `close()`, then run user policies in isolated workers against batched MuJoCo environments.

## Model sources

- [Hugging Face LeRobot SO-101 guide](https://huggingface.co/docs/lerobot/so101)
- [TheRobotStudio SO-ARM100 SO-101 simulation assets](https://github.com/TheRobotStudio/SO-ARM100/tree/main/Simulation/SO101)
- [Google DeepMind MuJoCo JavaScript bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)
