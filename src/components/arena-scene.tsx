"use client";

import { ContactShadows, Grid, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type CameraPreset = "orbit" | "front" | "side";

type ArenaSceneProps = {
  cameraPreset: CameraPreset;
  cube: [number, number, number];
  joints: number[];
  running: boolean;
  taskId: string;
};

const PALETTE = {
  orange: "#f2a03d",
  orangeDark: "#c36b24",
  carbon: "#26352e",
  black: "#111815",
  metal: "#e9e4d8",
  cube: "#ef6b42",
};

function JointHousing({ rotation = [Math.PI / 2, 0, 0] as [number, number, number] }) {
  return (
    <group rotation={rotation}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.075, 28]} />
        <meshStandardMaterial color={PALETTE.carbon} roughness={0.42} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.039, 0]}>
        <cylinderGeometry args={[0.037, 0.037, 0.006, 24]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.28} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.044, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.007, 16]} />
        <meshStandardMaterial color={PALETTE.black} roughness={0.3} metalness={0.7} />
      </mesh>
    </group>
  );
}

function ArmLink({ length, width = 0.085 }: { length: number; width?: number }) {
  return (
    <RoundedBox args={[width, length, width * 0.78]} radius={0.025} smoothness={3} position={[0, length / 2, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={PALETTE.orange} roughness={0.48} metalness={0.03} />
    </RoundedBox>
  );
}

function RobotArm({ joints }: { joints: number[] }) {
  const pan = useRef<THREE.Group>(null);
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const wrist = useRef<THREE.Group>(null);
  const roll = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const factor = 1 - Math.exp(-delta * 13);
    if (pan.current) pan.current.rotation.y = THREE.MathUtils.lerp(pan.current.rotation.y, joints[0] ?? 0, factor);
    if (shoulder.current) shoulder.current.rotation.z = THREE.MathUtils.lerp(shoulder.current.rotation.z, -(joints[1] ?? 0), factor);
    if (elbow.current) elbow.current.rotation.z = THREE.MathUtils.lerp(elbow.current.rotation.z, -(joints[2] ?? 0), factor);
    if (wrist.current) wrist.current.rotation.z = THREE.MathUtils.lerp(wrist.current.rotation.z, -(joints[3] ?? 0), factor);
    if (roll.current) roll.current.rotation.y = THREE.MathUtils.lerp(roll.current.rotation.y, joints[4] ?? 0, factor);
  });

  const grip = THREE.MathUtils.mapLinear(joints[5] ?? 0.72, -0.17, 1.74, 0.018, 0.072);

  return (
    <group position={[-0.18, 0.035, 0]} rotation={[0, 0.18, 0]}>
      <RoundedBox args={[0.24, 0.07, 0.2]} radius={0.035} smoothness={4} position={[0, 0.035, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={PALETTE.carbon} roughness={0.38} />
      </RoundedBox>
      <mesh position={[0, 0.078, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.1, 0.055, 32]} />
        <meshStandardMaterial color={PALETTE.orange} roughness={0.45} />
      </mesh>
      <group ref={pan} position={[0, 0.105, 0]}>
        <JointHousing rotation={[0, 0, Math.PI / 2]} />
        <group ref={shoulder} position={[0, 0.015, 0]} rotation={[0, 0, 0.62]}>
          <ArmLink length={0.38} width={0.095} />
          <group ref={elbow} position={[0, 0.38, 0]} rotation={[0, 0, -1.08]}>
            <JointHousing />
            <ArmLink length={0.34} width={0.082} />
            <group ref={wrist} position={[0, 0.34, 0]} rotation={[0, 0, 0.48]}>
              <JointHousing />
              <ArmLink length={0.15} width={0.068} />
              <group ref={roll} position={[0, 0.15, 0]}>
                <JointHousing rotation={[0, 0, Math.PI / 2]} />
                <RoundedBox args={[0.14, 0.07, 0.08]} radius={0.02} smoothness={3} position={[0, 0.05, 0]} castShadow>
                  <meshStandardMaterial color={PALETTE.orange} roughness={0.45} />
                </RoundedBox>
                <group position={[0, 0.095, 0]}>
                  <RoundedBox args={[0.026, 0.15, 0.04]} radius={0.008} smoothness={2} position={[-grip, 0.065, 0]} rotation={[0, 0, -0.08]} castShadow>
                    <meshStandardMaterial color={PALETTE.carbon} roughness={0.4} />
                  </RoundedBox>
                  <RoundedBox args={[0.026, 0.15, 0.04]} radius={0.008} smoothness={2} position={[grip, 0.065, 0]} rotation={[0, 0, 0.08]} castShadow>
                    <meshStandardMaterial color={PALETTE.carbon} roughness={0.4} />
                  </RoundedBox>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function TaskObjects({ cube, running, taskId }: { cube: [number, number, number]; running: boolean; taskId: string }) {
  const block = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (!block.current) return;
    block.current.rotation.y += delta * (running ? 0.35 : 0.08);
    if (running && taskId === "lift") block.current.position.y = cube[2] + Math.max(0, Math.sin(clock.elapsedTime * 1.4)) * 0.16;
  });

  const objectPosition: [number, number, number] = [cube[0], cube[2], -cube[1]];

  return (
    <group>
      <mesh ref={block} position={objectPosition} castShadow receiveShadow>
        <boxGeometry args={[0.095, 0.095, 0.095]} />
        <meshStandardMaterial color={PALETTE.cube} roughness={0.54} />
      </mesh>
      {taskId === "stack" && (
        <>
          <mesh position={[0.28, 0.05, 0.13]} castShadow><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#e2bd54" /></mesh>
          <mesh position={[0.34, 0.05, -0.03]} castShadow><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#83b99a" /></mesh>
        </>
      )}
      <mesh position={taskId === "push" ? [0.37, 0.004, -0.12] : [0.22, 0.004, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.11, 0.125, 48]} />
        <meshBasicMaterial color={PALETTE.cube} transparent opacity={0.68} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={taskId === "lift" ? [0.22, 0.17, 0.04] : [0.37, 0.055, -0.12]}>
        <sphereGeometry args={[taskId === "lift" ? 0.055 : 0.075, 24, 16]} />
        <meshBasicMaterial color={taskId === "push" ? "#68a37e" : PALETTE.cube} transparent opacity={0.09} depthWrite={false} />
      </mesh>
    </group>
  );
}

const CAMERA_POSITIONS: Record<CameraPreset, THREE.Vector3> = {
  orbit: new THREE.Vector3(1.65, 1.35, 1.75),
  front: new THREE.Vector3(0.1, 1.02, 2.15),
  side: new THREE.Vector3(2.1, 0.95, 0.05),
};

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const target = useMemo(() => CAMERA_POSITIONS[preset].clone(), [preset]);
  useFrame((_, delta) => camera.position.lerp(target, 1 - Math.exp(-delta * 4.2)));
  useEffect(() => camera.lookAt(0, 0.4, 0), [camera, preset]);
  return null;
}

function Scene({ cameraPreset, cube, joints, running, taskId }: ArenaSceneProps) {
  return (
    <>
      <color attach="background" args={["#e6e1d5"]} />
      <fog attach="fog" args={["#e6e1d5", 2.5, 5]} />
      <ambientLight intensity={1.45} />
      <directionalLight castShadow position={[1.8, 3.2, 2.4]} intensity={3.2} color="#fff8e7" shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2, 1.2, -1]} intensity={1.1} color="#b7d6c3" />
      <RobotArm joints={joints} />
      <TaskObjects cube={cube} running={running} taskId={taskId} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#ded8cb" roughness={0.92} />
      </mesh>
      <Grid position={[0, 0.001, 0]} args={[3, 3]} cellSize={0.1} cellThickness={0.5} cellColor="#7f8c83" sectionSize={0.5} sectionThickness={0.8} sectionColor="#66766d" fadeDistance={2.5} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.004, 0]} opacity={0.35} scale={3} blur={2.5} far={1.5} />
      <CameraRig preset={cameraPreset} />
      <OrbitControls makeDefault target={[0, 0.42, 0]} enablePan={false} minDistance={1.15} maxDistance={3.1} minPolarAngle={0.35} maxPolarAngle={1.48} />
    </>
  );
}

export function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas shadows dpr={[1, 1.6]} camera={{ position: [1.65, 1.35, 1.75], fov: 36, near: 0.01, far: 20 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <Scene {...props} />
    </Canvas>
  );
}
