"use client";

import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";

export type CameraPreset = "arena" | "atlas" | "blaze" | "overhead";
export type CubeOwner = "neutral" | "atlas" | "blaze";

type ArenaSceneProps = {
  cameraPreset: CameraPreset;
  joints: number[];
  opponentJoints: number[];
  playerProgress: number;
  opponentProgress: number;
  cubeOwners: CubeOwner[];
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
const ATLAS_COLOR = new THREE.Color("#2f8062");
const BLAZE_COLOR = new THREE.Color("#ef6b42");

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

function useSO101Model() {
  const [model, setModel] = useState<THREE.Group | null>(null);

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

      function buildBody(element: Element): THREE.Group {
        const group = new THREE.Group();
        group.name = element.getAttribute("name") ?? "body";
        applyTransform(group, element);

        const jointElement = directChildren(element, "joint")[0];
        if (jointElement) {
          const [ax, ay, az] = numbers(jointElement.getAttribute("axis"), [0, 0, 1]);
          group.userData.jointName = jointElement.getAttribute("name") ?? "";
          group.userData.jointAxis = [ax, ay, az];
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
          mesh.userData.isAccent = !materialName.includes("sts3215");
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
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        });
        return;
      }
      setModel(builtModel);
    }

    loadModel().catch(() => {
      if (alive) setModel(null);
    });

    return () => {
      alive = false;
      if (!builtModel) return;
      builtModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      });
    };
  }, []);

  return model;
}

function CompetitorRobot({ accent, joints, source }: { accent: THREE.Color; joints: number[]; source: THREE.Group }) {
  const instance = useMemo(() => {
    const clone = source.clone(true);
    const jointNodes = new Map<string, JointNode>();

    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
        const material = sourceMaterial.clone();
        if (object.userData.isAccent) material.color.copy(accent);
        object.material = material;
      }
      if (!(object instanceof THREE.Group) || !object.userData.jointName) return;
      const [x, y, z] = object.userData.jointAxis as number[];
      jointNodes.set(object.userData.jointName as string, {
        axis: new THREE.Vector3(x, y, z).normalize(),
        baseQuaternion: object.quaternion.clone(),
        group: object,
      });
    });

    return { clone, jointNodes };
  }, [accent, source]);

  useEffect(() => () => {
    instance.clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
  }, [instance]);

  useFrame((_, delta) => {
    const smoothing = 1 - Math.exp(-delta * 14);
    JOINT_ORDER.forEach((name, index) => {
      const node = instance.jointNodes.get(name);
      if (!node) return;
      const currentAngle = node.group.userData.jointAngle ?? 0;
      const angle = THREE.MathUtils.lerp(currentAngle, joints[index] ?? 0, smoothing);
      node.group.userData.jointAngle = angle;
      const rotation = new THREE.Quaternion().setFromAxisAngle(node.axis, angle);
      node.group.quaternion.copy(node.baseQuaternion).multiply(rotation);
    });
  });

  return <primitive object={instance.clone} />;
}

function ArenaMarkings() {
  return (
    <group position={[0, 0.003, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.635, 96]} />
        <meshBasicMaterial color="#48564f" transparent opacity={0.42} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.57, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.175, 64]} />
        <meshBasicMaterial color="#2f8062" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.57, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.175, 64]} />
        <meshBasicMaterial color="#ef6b42" transparent opacity={0.72} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.012, 1.18]} />
        <meshBasicMaterial color="#707d76" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function ProgressRing({ color, position, progress }: { color: string; position: [number, number, number]; progress: number }) {
  return (
    <group position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[0.095, 0.108, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI * (1 - progress)]}>
        <ringGeometry args={[0.097, 0.111, 48, 1, 0, Math.max(0.05, Math.PI * 2 * progress)]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

const NEUTRAL_CUBE_POSITIONS: [number, number, number][] = Array.from({ length: 9 }, (_, index) => [
  (index % 3 - 1) * 0.1,
  0.045,
  (Math.floor(index / 3) - 1) * 0.11,
]);

function ownedCubePosition(owner: Exclude<CubeOwner, "neutral">, sideIndex: number): [number, number, number] {
  const row = Math.floor(sideIndex / 3);
  const lane = sideIndex % 3 - 1;
  const direction = owner === "atlas" ? -1 : 1;
  return [direction * (0.34 + row * 0.09), 0.045, lane * 0.105];
}

function HeistCube({ index, owner, sideIndex, running }: { index: number; owner: CubeOwner; sideIndex: number; running: boolean }) {
  const cube = useRef<THREE.Mesh>(null);
  const target = useMemo(() => {
    const position = owner === "neutral" ? NEUTRAL_CUBE_POSITIONS[index] : ownedCubePosition(owner, sideIndex);
    return new THREE.Vector3(...position);
  }, [index, owner, sideIndex]);
  const color = owner === "atlas" ? "#66a98b" : owner === "blaze" ? "#f08461" : "#e2c45d";

  useFrame((_, delta) => {
    if (!cube.current) return;
    const horizontalDistance = Math.hypot(cube.current.position.x - target.x, cube.current.position.z - target.z);
    const carriedTarget = target.clone();
    carriedTarget.y += Math.min(0.16, horizontalDistance * 0.52);
    cube.current.position.lerp(carriedTarget, 1 - Math.exp(-delta * 3.3));
    cube.current.rotation.y += delta * (running ? 0.9 : 0.15);
    cube.current.rotation.x = THREE.MathUtils.lerp(cube.current.rotation.x, horizontalDistance > 0.03 ? 0.25 : 0, 1 - Math.exp(-delta * 5));
  });

  return (
    <mesh ref={cube} position={NEUTRAL_CUBE_POSITIONS[index]} castShadow receiveShadow>
      <boxGeometry args={[0.085, 0.085, 0.085]} />
      <meshStandardMaterial color={color} roughness={0.48} metalness={0.04} />
    </mesh>
  );
}

function TerritoryZone({ color, x }: { color: string; x: number }) {
  return (
    <group position={[x, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[0.235, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.225, 0.238, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.82} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function HeistObjects({ cubeOwners, running }: Pick<ArenaSceneProps, "cubeOwners" | "running">) {
  return (
    <group>
      <TerritoryZone color="#2f8062" x={-0.37} />
      <TerritoryZone color="#ef6b42" x={0.37} />
      <group position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh><ringGeometry args={[0.17, 0.18, 64]} /><meshBasicMaterial color="#8a8c85" transparent opacity={0.5} side={THREE.DoubleSide} /></mesh>
      </group>
      {cubeOwners.map((owner, index) => {
        const sideIndex = cubeOwners.slice(0, index).filter((cubeOwner) => cubeOwner === owner).length;
        return <HeistCube key={index} index={index} owner={owner} sideIndex={sideIndex} running={running} />;
      })}
    </group>
  );
}

function RaceObjects({ opponentProgress, playerProgress, running, taskId }: Pick<ArenaSceneProps, "opponentProgress" | "playerProgress" | "running" | "taskId">) {
  const atlasBlock = useRef<THREE.Mesh>(null);
  const blazeBlock = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (atlasBlock.current) atlasBlock.current.rotation.y += delta * (running ? 0.5 : 0.1);
    if (blazeBlock.current) blazeBlock.current.rotation.y -= delta * (running ? 0.46 : 0.1);
  });

  const atlasX = taskId === "push" ? -0.27 + playerProgress * 0.18 : -0.18;
  const blazeX = taskId === "push" ? 0.27 - opponentProgress * 0.18 : 0.18;
  const atlasY = taskId === "stack" ? 0.07 + playerProgress * 0.13 : 0.07;
  const blazeY = taskId === "stack" ? 0.07 + opponentProgress * 0.13 : 0.07;

  return (
    <group>
      <mesh ref={atlasBlock} position={[atlasX, atlasY, -0.13]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.14, 0.14]} />
        <meshStandardMaterial color="#2f8062" roughness={0.52} />
      </mesh>
      <mesh ref={blazeBlock} position={[blazeX, blazeY, 0.13]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.14, 0.14]} />
        <meshStandardMaterial color="#ef6b42" roughness={0.52} />
      </mesh>

      {taskId === "stack" && (
        <>
          <mesh position={[-0.18, 0.07, -0.13]} castShadow receiveShadow><boxGeometry args={[0.14, 0.14, 0.14]} /><meshStandardMaterial color="#d9c568" /></mesh>
          <mesh position={[0.18, 0.07, 0.13]} castShadow receiveShadow><boxGeometry args={[0.14, 0.14, 0.14]} /><meshStandardMaterial color="#d9c568" /></mesh>
        </>
      )}

      <ProgressRing color="#2f8062" position={[taskId === "push" ? -0.06 : -0.18, 0.006, -0.13]} progress={playerProgress} />
      <ProgressRing color="#ef6b42" position={[taskId === "push" ? 0.06 : 0.18, 0.006, 0.13]} progress={opponentProgress} />
    </group>
  );
}

function CompetitionObjects(props: Pick<ArenaSceneProps, "cubeOwners" | "opponentProgress" | "playerProgress" | "running" | "taskId">) {
  return props.taskId === "heist" ? <HeistObjects cubeOwners={props.cubeOwners} running={props.running} /> : <RaceObjects {...props} />;
}

const CAMERA_POSITIONS: Record<CameraPreset, THREE.Vector3> = {
  arena: new THREE.Vector3(0, 1.18, 2.15),
  atlas: new THREE.Vector3(-1.42, 0.72, 0.62),
  blaze: new THREE.Vector3(1.42, 0.72, -0.62),
  overhead: new THREE.Vector3(0.01, 2.65, 0.01),
};

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  const targetPosition = useMemo(() => CAMERA_POSITIONS[preset].clone(), [preset]);
  useFrame((_, delta) => {
    camera.position.lerp(targetPosition, 1 - Math.exp(-delta * 4.8));
    camera.lookAt(0, 0.32, 0);
  });
  return null;
}

function Scene(props: ArenaSceneProps) {
  const model = useSO101Model();

  return (
    <>
      <color attach="background" args={["#e6e1d5"]} />
      <fog attach="fog" args={["#e6e1d5", 2.6, 5]} />
      <ambientLight intensity={1.45} />
      <directionalLight castShadow position={[1.8, 3.2, 2.4]} intensity={3.1} color="#fff8e7" shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2, 1.2, -1]} intensity={1.15} color="#b7d6c3" />

      {model && (
        <>
          <group position={[-0.57, 0, 0]} scale={MODEL_SCALE} rotation={[-Math.PI / 2, 0, 0]}>
            <CompetitorRobot accent={ATLAS_COLOR} joints={props.joints} source={model} />
          </group>
          <group position={[0.57, 0, 0]} rotation={[0, Math.PI, 0]}>
            <group scale={MODEL_SCALE} rotation={[-Math.PI / 2, 0, 0]}>
              <CompetitorRobot accent={BLAZE_COLOR} joints={props.opponentJoints} source={model} />
            </group>
          </group>
        </>
      )}

      <CompetitionObjects {...props} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#ded8cb" roughness={0.92} />
      </mesh>
      <ArenaMarkings />
      <Grid position={[0, 0.001, 0]} args={[3.5, 3.5]} cellSize={0.1} cellThickness={0.5} cellColor="#7f8c83" sectionSize={0.5} sectionThickness={0.8} sectionColor="#66766d" fadeDistance={2.8} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.004, 0]} opacity={0.36} scale={3.5} blur={2.5} far={1.5} />
      <CameraRig preset={props.cameraPreset} />
      <OrbitControls makeDefault target={[0, 0.32, 0]} enabled={props.cameraPreset === "arena"} enablePan={false} minDistance={1.25} maxDistance={3} minPolarAngle={0.18} maxPolarAngle={1.48} />
    </>
  );
}

export function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas shadows="percentage" dpr={[1, 1.6]} camera={{ position: [0, 1.18, 2.15], fov: 39, near: 0.01, far: 20 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <Scene {...props} />
    </Canvas>
  );
}
