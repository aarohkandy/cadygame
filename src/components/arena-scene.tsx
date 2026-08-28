"use client";

import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";

export type CameraPreset = "orbit" | "front" | "side";

type ArenaSceneProps = {
  cameraPreset: CameraPreset;
  cube: [number, number, number];
  joints: number[];
  running: boolean;
  taskId: string;
};

type JointNode = {
  axis: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  group: THREE.Group;
};

const MODEL_ROOT = "/models/robotstudio_so101";
const MODEL_SCALE = 2.05;
const JOINT_ORDER = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];

function numbers(value: string | null, fallback: number[]) {
  if (!value) return fallback;
  const parsed = value.trim().split(/\s+/).map(Number);
  return parsed.some(Number.isNaN) ? fallback : parsed;
}

function mjcfQuaternion(value: string | null) {
  const [w, x, y, z] = numbers(value, [1, 0, 0, 0]);
  return new THREE.Quaternion(x, y, z, w).normalize();
}

function directChildren(element: Element, tagName: string) {
  return Array.from(element.children).filter((child) => child.tagName === tagName);
}

function applyTransform(object: THREE.Object3D, element: Element) {
  const [x, y, z] = numbers(element.getAttribute("pos"), [0, 0, 0]);
  object.position.set(x, y, z);
  if (element.hasAttribute("quat")) {
    object.quaternion.copy(mjcfQuaternion(element.getAttribute("quat")));
  } else if (element.hasAttribute("euler")) {
    const [rx, ry, rz] = numbers(element.getAttribute("euler"), [0, 0, 0]);
    object.rotation.set(rx, ry, rz, "XYZ");
  }
}

function SO101MenagerieModel({ joints }: { joints: number[] }) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const jointNodes = useRef(new Map<string, JointNode>());

  useEffect(() => {
    let alive = true;
    let builtModel: THREE.Group | null = null;

    async function loadModel() {
      const xmlText = await fetch(`${MODEL_ROOT}/so101.xml`, { cache: "force-cache" }).then((response) => {
        if (!response.ok) throw new Error(`SO-101 visual model failed to load (${response.status})`);
        return response.text();
      });
      const document = new DOMParser().parseFromString(xmlText, "application/xml");
      if (document.querySelector("parsererror")) throw new Error("SO-101 MJCF could not be parsed");

      const meshFiles = new Map<string, string>();
      document.querySelectorAll("asset > mesh[file]").forEach((element) => {
        const file = element.getAttribute("file");
        if (!file) return;
        const name = element.getAttribute("name") ?? file.replace(/\.[^.]+$/, "");
        meshFiles.set(name, file);
      });

      const materialColors = new Map<string, THREE.Color>();
      document.querySelectorAll("asset > material[name]").forEach((element) => {
        const [r, g, b] = numbers(element.getAttribute("rgba"), [0.8, 0.8, 0.8, 1]);
        materialColors.set(element.getAttribute("name") ?? "", new THREE.Color(r, g, b));
      });

      const visualMeshNames = new Set<string>();
      document.querySelectorAll('geom[class="visual"][mesh]').forEach((element) => {
        const mesh = element.getAttribute("mesh");
        if (mesh) visualMeshNames.add(mesh);
      });

      const loader = new STLLoader();
      const geometryEntries = await Promise.all(
        Array.from(visualMeshNames).map(async (name) => {
          const file = meshFiles.get(name);
          if (!file) throw new Error(`Missing mesh asset: ${name}`);
          const geometry = await loader.loadAsync(`${MODEL_ROOT}/assets/${file}`);
          geometry.computeVertexNormals();
          return [name, geometry] as const;
        }),
      );
      const geometries = new Map(geometryEntries);
      const jointsByName = new Map<string, JointNode>();

      function buildBody(element: Element): THREE.Group {
        const group = new THREE.Group();
        group.name = element.getAttribute("name") ?? "body";
        applyTransform(group, element);

        const jointElement = directChildren(element, "joint")[0];
        if (jointElement) {
          const [ax, ay, az] = numbers(jointElement.getAttribute("axis"), [0, 0, 1]);
          const name = jointElement.getAttribute("name") ?? "";
          jointsByName.set(name, {
            axis: new THREE.Vector3(ax, ay, az).normalize(),
            baseQuaternion: group.quaternion.clone(),
            group,
          });
        }

        directChildren(element, "geom").forEach((geomElement) => {
          if (geomElement.getAttribute("class") !== "visual") return;
          const meshName = geomElement.getAttribute("mesh");
          const geometry = meshName ? geometries.get(meshName) : undefined;
          if (!geometry) return;
          const materialName = geomElement.getAttribute("material") ?? "";
          const material = new THREE.MeshStandardMaterial({
            color: materialColors.get(materialName) ?? new THREE.Color("#d7d3c7"),
            roughness: materialName.includes("sts3215") ? 0.34 : 0.52,
            metalness: materialName.includes("sts3215") ? 0.2 : 0.03,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = meshName ?? "visual";
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          applyTransform(mesh, geomElement);
          group.add(mesh);
        });

        directChildren(element, "body").forEach((bodyElement) => group.add(buildBody(bodyElement)));
        return group;
      }

      const baseElement = document.querySelector("worldbody > body");
      if (!baseElement) throw new Error("SO-101 base body is missing");
      builtModel = buildBody(baseElement);
      if (!alive) {
        builtModel.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
            else object.material.dispose();
          }
        });
        return;
      }
      jointNodes.current = jointsByName;
      setModel(builtModel);
    }

    loadModel().catch(() => {
      if (alive) setModel(null);
    });

    return () => {
      alive = false;
      if (builtModel) {
        builtModel.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
            else object.material.dispose();
          }
        });
      }
      jointNodes.current.clear();
    };
  }, []);

  useFrame((_, delta) => {
    const smoothing = 1 - Math.exp(-delta * 14);
    JOINT_ORDER.forEach((name, index) => {
      const node = jointNodes.current.get(name);
      if (!node) return;
      const currentAngle = node.group.userData.jointAngle ?? 0;
      const angle = THREE.MathUtils.lerp(currentAngle, joints[index] ?? 0, smoothing);
      node.group.userData.jointAngle = angle;
      const rotation = new THREE.Quaternion().setFromAxisAngle(node.axis, angle);
      node.group.quaternion.copy(node.baseQuaternion).multiply(rotation);
    });
  });

  if (!model) return null;
  return <primitive object={model} />;
}

function TaskObjects({ cube, running, taskId }: { cube: [number, number, number]; running: boolean; taskId: string }) {
  const block = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (!block.current) return;
    block.current.rotation.y += delta * (running ? 0.35 : 0.08);
    if (running && taskId === "lift") block.current.position.y = cube[2] + Math.max(0, Math.sin(clock.elapsedTime * 1.4)) * 0.12;
  });

  const objectPosition: [number, number, number] = [cube[0], cube[2], -cube[1]];
  return (
    <group>
      <mesh ref={block} position={objectPosition} castShadow receiveShadow>
        <boxGeometry args={[0.08, 0.08, 0.08]} />
        <meshStandardMaterial color="#ef6b42" roughness={0.54} />
      </mesh>
      {taskId === "stack" && (
        <>
          <mesh position={[0.32, 0.04, 0.13]} castShadow><boxGeometry args={[0.08, 0.08, 0.08]} /><meshStandardMaterial color="#e2bd54" /></mesh>
          <mesh position={[0.38, 0.04, -0.03]} castShadow><boxGeometry args={[0.08, 0.08, 0.08]} /><meshStandardMaterial color="#83b99a" /></mesh>
        </>
      )}
      <mesh position={taskId === "push" ? [0.4, 0.002, -0.12] : [0.3, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.105, 48]} />
        <meshBasicMaterial color="#ef6b42" transparent opacity={0.68} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={taskId === "lift" ? [0.3, 0.15, 0] : [0.4, 0.05, -0.12]}>
        <sphereGeometry args={[taskId === "lift" ? 0.05 : 0.07, 24, 16]} />
        <meshBasicMaterial color={taskId === "push" ? "#68a37e" : "#ef6b42"} transparent opacity={0.09} depthWrite={false} />
      </mesh>
    </group>
  );
}

const CAMERA_POSITIONS: Record<CameraPreset, THREE.Vector3> = {
  orbit: new THREE.Vector3(1.45, 1.12, 1.55),
  front: new THREE.Vector3(0.08, 0.86, 1.8),
  side: new THREE.Vector3(1.75, 0.82, 0.05),
};

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const target = useMemo(() => CAMERA_POSITIONS[preset].clone(), [preset]);
  useFrame((_, delta) => camera.position.lerp(target, 1 - Math.exp(-delta * 4.2)));
  useEffect(() => camera.lookAt(0, 0.35, 0), [camera, preset]);
  return null;
}

function Scene({ cameraPreset, cube, joints, running, taskId }: ArenaSceneProps) {
  return (
    <>
      <color attach="background" args={["#e6e1d5"]} />
      <fog attach="fog" args={["#e6e1d5", 2.2, 4.5]} />
      <ambientLight intensity={1.4} />
      <directionalLight castShadow position={[1.8, 3.2, 2.4]} intensity={3.1} color="#fff8e7" shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2, 1.2, -1]} intensity={1.0} color="#b7d6c3" />
      <group scale={MODEL_SCALE} rotation={[-Math.PI / 2, 0, 0]}>
        <SO101MenagerieModel joints={joints} />
      </group>
      <group scale={MODEL_SCALE}>
        <TaskObjects cube={cube} running={running} taskId={taskId} />
      </group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#ded8cb" roughness={0.92} />
      </mesh>
      <Grid position={[0, 0.001, 0]} args={[3, 3]} cellSize={0.1} cellThickness={0.5} cellColor="#7f8c83" sectionSize={0.5} sectionThickness={0.8} sectionColor="#66766d" fadeDistance={2.5} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.004, 0]} opacity={0.36} scale={3} blur={2.5} far={1.4} />
      <CameraRig preset={cameraPreset} />
      <OrbitControls makeDefault target={[0, 0.34, 0]} enablePan={false} minDistance={0.9} maxDistance={2.8} minPolarAngle={0.35} maxPolarAngle={1.48} />
    </>
  );
}

export function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas shadows dpr={[1, 1.6]} camera={{ position: [1.45, 1.12, 1.55], fov: 36, near: 0.01, far: 20 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <Scene {...props} />
    </Canvas>
  );
}
