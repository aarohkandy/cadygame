"use client";

import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import type { DuelCollision, PhysicsCube } from "@/lib/mujoco-engine";

export type CameraPreset = "arena" | "atlas" | "blaze" | "overhead";
export type CubeOwner = "neutral" | "atlas" | "blaze";
export type CameraControlState = { x: number; y: number; resetToken: number };

type ArenaSceneProps = {
  cameraPreset: CameraPreset;
  joints: number[];
  opponentJoints: number[];
  playerProgress: number;
  opponentProgress: number;
  cubes: PhysicsCube[];
  cubeOwners: CubeOwner[];
  collision: DuelCollision;
  running: boolean;
  taskId: string;
  cameraControlRef: RefObject<CameraControlState>;
};

type JointNode = {
  axis: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  group: THREE.Group;
};

const MODEL_ROOT = "/models/robotstudio_so101";
const MODEL_SCALE = 2.05;
const ROBOT_BASE_OFFSET = 0.32;
const JOINT_ORDER = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];
const ATLAS_COLOR = new THREE.Color("#2f8062");
const BLAZE_COLOR = new THREE.Color("#ef6b42");
const MAX_IMPACT_SPARKS = 96;
const MAX_IMPACT_STREAKS = 96;
const FLOOR_Z = 0.004;

type ImpactSpark = {
  age: number;
  color: THREE.Color;
  heat: number;
  life: number;
  position: THREE.Vector3;
  size: number;
  velocity: THREE.Vector3;
};

type ImpactFlash = {
  age: number;
  color: THREE.Color;
  intensity: number;
  life: number;
  position: THREE.Vector3;
  radius: number;
};

const _heatMid = new THREE.Color("#ff8a2b");
const _heatHot = new THREE.Color("#ffe56a");

function heatColor(heat: number, tint: THREE.Color, target: THREE.Color) {
  // White-hot → yellow → orange → ember, with a light team tint at the end.
  if (heat > 0.75) {
    target.setRGB(1, 1, 0.92).lerp(_heatHot, 1 - (heat - 0.75) / 0.25);
  } else if (heat > 0.4) {
    target.copy(_heatHot).lerp(_heatMid, 1 - (heat - 0.4) / 0.35);
  } else {
    target.copy(_heatMid).lerp(tint, 1 - heat / 0.4).multiplyScalar(0.55 + heat);
  }
  return target;
}

function spawnImpactSparks(
  origin: THREE.Vector3,
  options: {
    attacker: DuelCollision["attacker"];
    force: number;
    isStrike: boolean;
    random: () => number;
    count: number;
  },
): ImpactSpark[] {
  const impact = THREE.MathUtils.clamp(options.force / 2, 0, 1);
  const tint = new THREE.Color(
    options.attacker === "atlas" ? "#66f0ba" : options.attacker === "blaze" ? "#ff7048" : "#ffb347",
  );
  const scratch = new THREE.Color();

  return Array.from({ length: options.count }, () => {
    // Prefer a horizontal spray sheet with a few high arcs — like grinding metal.
    const angle = options.random() * Math.PI * 2;
    const elev = THREE.MathUtils.lerp(options.isStrike ? 0.05 : -0.05, options.isStrike ? 0.82 : 0.55, options.random() ** 1.35);
    const radial = Math.sqrt(Math.max(0, 1 - elev * elev));
    const speed = THREE.MathUtils.lerp(
      options.isStrike ? 0.34 : 0.18,
      options.isStrike ? 0.78 : 0.42,
      options.random(),
    ) * (0.75 + impact * 0.55);
    const direction = new THREE.Vector3(
      Math.cos(angle) * radial,
      Math.sin(angle) * radial,
      elev,
    ).normalize();
    const heat = THREE.MathUtils.lerp(options.isStrike ? 0.72 : 0.55, 1, options.random());

    return {
      age: 0,
      color: heatColor(heat, tint, scratch).clone(),
      heat,
      life: THREE.MathUtils.lerp(options.isStrike ? 0.28 : 0.18, options.isStrike ? 0.7 : 0.45, options.random()),
      position: origin.clone().addScaledVector(direction, options.random() * 0.006),
      size: THREE.MathUtils.lerp(0.35, options.isStrike ? 1.8 : 1.25, options.random() ** 0.7),
      velocity: direction.multiplyScalar(speed),
    };
  });
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

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

function HeistCube({ cubeState, owner }: { cubeState: PhysicsCube; owner: CubeOwner }) {
  const cube = useRef<THREE.Mesh>(null);
  const color = owner === "atlas" ? "#66a98b" : owner === "blaze" ? "#f08461" : "#e2c45d";

  useFrame((_, delta) => {
    if (!cube.current) return;
    const smoothing = 1 - Math.exp(-delta * 24);
    cube.current.position.lerp(new THREE.Vector3(...cubeState.position), smoothing);
    cube.current.quaternion.slerp(new THREE.Quaternion(...cubeState.quaternion), smoothing);
  });

  return (
    <mesh ref={cube} position={cubeState.position} quaternion={cubeState.quaternion} castShadow receiveShadow>
      <boxGeometry args={[0.04, 0.04, 0.04]} />
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

function HeistObjects({ cubes, cubeOwners }: Pick<ArenaSceneProps, "cubes" | "cubeOwners">) {
  return (
    <group>
      <TerritoryZone color="#2f8062" x={-0.37} />
      <TerritoryZone color="#ef6b42" x={0.37} />
      <group position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh><ringGeometry args={[0.17, 0.18, 64]} /><meshBasicMaterial color="#8a8c85" transparent opacity={0.5} side={THREE.DoubleSide} /></mesh>
      </group>
      <group scale={MODEL_SCALE} rotation={[-Math.PI / 2, 0, 0]}>
        {cubes.map((cubeState, index) => (
          <HeistCube key={index} cubeState={cubeState} owner={cubeOwners[index] ?? "neutral"} />
        ))}
      </group>
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

function CompetitionObjects(props: Pick<ArenaSceneProps, "cubes" | "cubeOwners" | "opponentProgress" | "playerProgress" | "running" | "taskId">) {
  return props.taskId === "heist" ? <HeistObjects cubes={props.cubes} cubeOwners={props.cubeOwners} /> : <RaceObjects {...props} />;
}

function ImpactMarker({ collision }: { collision: DuelCollision }) {
  const pointsGeometryRef = useRef<THREE.BufferGeometry>(null);
  const streaksGeometryRef = useRef<THREE.BufferGeometry>(null);
  const pointsMaterialRef = useRef<THREE.PointsMaterial>(null);
  const flashMeshRef = useRef<THREE.Mesh>(null);
  const flashLightRef = useRef<THREE.PointLight>(null);
  const sparksRef = useRef<ImpactSpark[]>([]);
  const flashesRef = useRef<ImpactFlash[]>([]);
  const lastEventRef = useRef(0);
  const grindCarryRef = useRef(0);
  const scratchColor = useMemo(() => new THREE.Color(), []);
  const tintAtlas = useMemo(() => new THREE.Color("#66f0ba"), []);
  const tintBlaze = useMemo(() => new THREE.Color("#ff7048"), []);
  const tintNeutral = useMemo(() => new THREE.Color("#ffb347"), []);

  useEffect(() => {
    const points = pointsGeometryRef.current;
    const streaks = streaksGeometryRef.current;
    if (points) {
      points.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_IMPACT_SPARKS * 3), 3));
      points.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_IMPACT_SPARKS * 3), 3));
      points.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(MAX_IMPACT_SPARKS), 1));
      points.setDrawRange(0, 0);
    }
    if (streaks) {
      streaks.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_IMPACT_STREAKS * 2 * 3), 3));
      streaks.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_IMPACT_STREAKS * 2 * 3), 3));
      streaks.setDrawRange(0, 0);
    }

    const material = pointsMaterialRef.current;
    if (material) {
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            "uniform float size;",
            "uniform float size;\nattribute float aSize;",
          )
          .replace(
            "gl_PointSize = size * ( scale / - mvPosition.z );",
            "gl_PointSize = size * aSize * ( scale / - mvPosition.z );",
          )
          .replace(
            "gl_PointSize = size;",
            "gl_PointSize = size * aSize;",
          );
      };
      material.customProgramCacheKey = () => "arena-impact-sparks";
      material.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    if (collision.kind === "none" || collision.eventId === 0) {
      lastEventRef.current = 0;
      grindCarryRef.current = 0;
      return;
    }
    if (collision.eventId === lastEventRef.current) return;
    lastEventRef.current = collision.eventId;

    const isStrike = collision.kind === "strike";
    const impact = THREE.MathUtils.clamp(collision.force / 2, 0, 1);
    const sparkCount = Math.min(
      MAX_IMPACT_SPARKS,
      Math.round((isStrike ? 38 : 18) + impact * (isStrike ? 28 : 14)),
    );
    const random = seededRandom(collision.eventId * 31 + (isStrike ? 17 : 7));
    const origin = new THREE.Vector3(...collision.position);
    const burst = spawnImpactSparks(origin, {
      attacker: collision.attacker,
      force: collision.force,
      isStrike,
      random,
      count: sparkCount,
    });
    const keepCount = Math.max(0, MAX_IMPACT_SPARKS - burst.length);
    sparksRef.current = [...(keepCount > 0 ? sparksRef.current.slice(-keepCount) : []), ...burst];

    const tint = collision.attacker === "atlas"
      ? tintAtlas
      : collision.attacker === "blaze"
        ? tintBlaze
        : tintNeutral;
    flashesRef.current.push({
      age: 0,
      color: new THREE.Color("#fff6d8").lerp(tint, 0.25),
      intensity: isStrike ? 2.8 + impact * 1.6 : 1.4 + impact,
      life: isStrike ? 0.11 : 0.08,
      position: origin.clone(),
      radius: isStrike ? 0.018 + impact * 0.01 : 0.012 + impact * 0.006,
    });
    if (flashesRef.current.length > 4) flashesRef.current.splice(0, flashesRef.current.length - 4);
  }, [collision, tintAtlas, tintBlaze, tintNeutral]);

  useFrame((_, delta) => {
    const pointsGeometry = pointsGeometryRef.current;
    const streaksGeometry = streaksGeometryRef.current;
    if (!pointsGeometry || !streaksGeometry) return;
    const positions = pointsGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const colors = pointsGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const sizes = pointsGeometry.getAttribute("aSize") as THREE.BufferAttribute | undefined;
    const streakPositions = streaksGeometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const streakColors = streaksGeometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!positions || !colors || !sizes || !streakPositions || !streakColors) return;

    const frameDelta = Math.min(delta, 1 / 30);

    // While arms stay pressed, drip a few grinding embers — no solid “contact orb”.
    if (collision.kind !== "none" && collision.eventId > 0) {
      const grindRate = (collision.kind === "strike" ? 28 : 14) + Math.min(collision.force, 3) * 10;
      grindCarryRef.current += frameDelta * grindRate;
      const origin = new THREE.Vector3(...collision.position);
      while (grindCarryRef.current >= 1 && sparksRef.current.length < MAX_IMPACT_SPARKS) {
        grindCarryRef.current -= 1;
        const ember = spawnImpactSparks(origin, {
          attacker: collision.attacker,
          force: Math.max(0.35, collision.force * 0.45),
          isStrike: false,
          random: Math.random,
          count: 1,
        })[0];
        ember.life *= 0.55;
        ember.size *= 0.55;
        ember.velocity.multiplyScalar(0.45);
        sparksRef.current.push(ember);
      }
    } else {
      grindCarryRef.current = 0;
    }

    const activeSparks: ImpactSpark[] = [];
    sparksRef.current.forEach((spark) => {
      spark.age += frameDelta;
      if (spark.age >= spark.life) return;

      spark.velocity.z -= 1.65 * frameDelta;
      spark.velocity.x *= Math.exp(-0.55 * frameDelta);
      spark.velocity.y *= Math.exp(-0.55 * frameDelta);
      spark.velocity.z *= Math.exp(-0.2 * frameDelta);
      spark.position.addScaledVector(spark.velocity, frameDelta);

      if (spark.position.z < FLOOR_Z) {
        spark.position.z = FLOOR_Z;
        if (Math.abs(spark.velocity.z) > 0.08) {
          spark.velocity.z *= -0.22;
          spark.velocity.x *= 0.55;
          spark.velocity.y *= 0.55;
          spark.heat *= 0.65;
          spark.life = Math.min(spark.life, spark.age + 0.12);
        } else {
          spark.velocity.set(0, 0, 0);
          spark.life = Math.min(spark.life, spark.age + 0.08);
        }
      }

      const lifeRatio = 1 - spark.age / spark.life;
      spark.heat = Math.max(0, spark.heat - frameDelta * (0.55 + (1 - lifeRatio) * 1.2));
      const tint = collision.attacker === "atlas"
        ? tintAtlas
        : collision.attacker === "blaze"
          ? tintBlaze
          : tintNeutral;
      heatColor(spark.heat * lifeRatio, tint, spark.color);
      activeSparks.push(spark);
    });
    sparksRef.current = activeSparks;

    activeSparks.forEach((spark, index) => {
      const lifeRatio = Math.max(0, 1 - spark.age / spark.life);
      const fade = Math.pow(lifeRatio, 1.15);
      positions.setXYZ(index, spark.position.x, spark.position.y, spark.position.z);
      colors.setXYZ(index, spark.color.r * fade, spark.color.g * fade, spark.color.b * fade);
      sizes.setX(index, spark.size * (0.55 + fade * 0.7));

      const streakIndex = index * 2;
      const trail = Math.min(0.028, spark.velocity.length() * 0.045);
      streakPositions.setXYZ(streakIndex, spark.position.x, spark.position.y, spark.position.z);
      streakPositions.setXYZ(
        streakIndex + 1,
        spark.position.x - spark.velocity.x * trail,
        spark.position.y - spark.velocity.y * trail,
        spark.position.z - spark.velocity.z * trail,
      );
      streakColors.setXYZ(streakIndex, spark.color.r * fade, spark.color.g * fade, spark.color.b * fade);
      streakColors.setXYZ(
        streakIndex + 1,
        spark.color.r * fade * 0.15,
        spark.color.g * fade * 0.15,
        spark.color.b * fade * 0.1,
      );
    });

    pointsGeometry.setDrawRange(0, activeSparks.length);
    streaksGeometry.setDrawRange(0, activeSparks.length * 2);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;
    streakPositions.needsUpdate = true;
    streakColors.needsUpdate = true;

    const flashes = flashesRef.current;
    for (let index = flashes.length - 1; index >= 0; index -= 1) {
      flashes[index].age += frameDelta;
      if (flashes[index].age >= flashes[index].life) flashes.splice(index, 1);
    }
    const flash = flashes[flashes.length - 1];
    if (flashMeshRef.current && flashLightRef.current) {
      if (flash) {
        const t = flash.age / flash.life;
        const envelope = Math.sin(Math.min(1, t) * Math.PI);
        flashMeshRef.current.visible = true;
        flashMeshRef.current.position.copy(flash.position);
        flashMeshRef.current.scale.setScalar(flash.radius * (0.7 + envelope * 1.8));
        const material = flashMeshRef.current.material as THREE.MeshBasicMaterial;
        material.color.copy(flash.color);
        material.opacity = envelope * 0.85;
        flashLightRef.current.visible = true;
        flashLightRef.current.position.copy(flash.position);
        flashLightRef.current.color.copy(flash.color);
        flashLightRef.current.intensity = flash.intensity * envelope;
      } else if (collision.kind !== "none") {
        // Soft living contact light only — no solid bridge sphere.
        flashMeshRef.current.visible = false;
        flashLightRef.current.visible = true;
        flashLightRef.current.position.set(...collision.position);
        const flicker = 0.55 + Math.sin(performance.now() * 0.04) * 0.2 + Math.random() * 0.12;
        scratchColor.copy(
          collision.attacker === "atlas"
            ? tintAtlas
            : collision.attacker === "blaze"
              ? tintBlaze
              : tintNeutral,
        );
        flashLightRef.current.color.copy(scratchColor);
        flashLightRef.current.intensity = (collision.kind === "strike" ? 0.55 : 0.28) * flicker;
      } else {
        flashMeshRef.current.visible = false;
        flashLightRef.current.visible = false;
        flashLightRef.current.intensity = 0;
      }
    }
  });

  return (
    <>
      <points frustumCulled={false}>
        <bufferGeometry ref={pointsGeometryRef} />
        <pointsMaterial
          ref={pointsMaterialRef}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          opacity={1}
          size={0.016}
          sizeAttenuation
          toneMapped={false}
          transparent
          vertexColors
        />
      </points>
      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={streaksGeometryRef} />
        <lineBasicMaterial
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          transparent
          toneMapped={false}
          vertexColors
        />
      </lineSegments>
      <mesh ref={flashMeshRef} visible={false} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#fff6d8"
          depthWrite={false}
          opacity={0}
          transparent
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={flashLightRef} visible={false} distance={0.32} decay={2} intensity={0} />
    </>
  );
}

const CAMERA_POSITIONS: Record<CameraPreset, THREE.Vector3> = {
  arena: new THREE.Vector3(0, 1.18, 2.15),
  atlas: new THREE.Vector3(-1.42, 0.72, 0.62),
  blaze: new THREE.Vector3(1.42, 0.72, -0.62),
  overhead: new THREE.Vector3(0.01, 2.65, 0.01),
};

function CameraRig({ preset, controlRef }: { preset: CameraPreset; controlRef: RefObject<CameraControlState> }) {
  const { camera } = useThree();
  const activePresetRef = useRef<CameraPreset>(preset);
  const targetPositionRef = useRef(CAMERA_POSITIONS[preset].clone());
  const transitioningRef = useRef(true);
  const resetTokenRef = useRef(0);
  const lookAtRef = useRef(new THREE.Vector3(0, 0.32, 0));
  const sphericalRef = useRef(new THREE.Spherical());
  const offsetRef = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const control = controlRef.current;
    if (!control) return;
    const lookAt = lookAtRef.current;
    const spherical = sphericalRef.current;
    const offset = offsetRef.current;
    const resetRequested = control.resetToken !== resetTokenRef.current;
    if (preset !== activePresetRef.current || resetRequested) {
      activePresetRef.current = preset;
      resetTokenRef.current = control.resetToken;
      targetPositionRef.current.copy(CAMERA_POSITIONS[preset]);
      transitioningRef.current = true;
    }

    if (transitioningRef.current) {
      camera.position.lerp(targetPositionRef.current, 1 - Math.exp(-delta * 6.2));
      camera.lookAt(lookAt);
      if (camera.position.distanceToSquared(targetPositionRef.current) < 0.00001) {
        camera.position.copy(targetPositionRef.current);
        transitioningRef.current = false;
      }
      return;
    }

    if (preset !== "arena" || Math.hypot(control.x, control.y) < 0.001) return;
    offset.copy(camera.position).sub(lookAt);
    spherical.setFromVector3(offset);
    spherical.theta -= control.x * delta * 1.75;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + control.y * delta * 1.35,
      0.18,
      1.48,
    );
    camera.position.copy(offset.setFromSpherical(spherical).add(lookAt));
    camera.lookAt(lookAt);
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
        <group scale={MODEL_SCALE} rotation={[-Math.PI / 2, 0, 0]}>
          <group position={[-ROBOT_BASE_OFFSET, 0, 0]}>
            <CompetitorRobot accent={ATLAS_COLOR} joints={props.joints} source={model} />
          </group>
          <group position={[ROBOT_BASE_OFFSET, 0, 0]} rotation={[0, 0, Math.PI]}>
            <CompetitorRobot accent={BLAZE_COLOR} joints={props.opponentJoints} source={model} />
          </group>
          <ImpactMarker collision={props.collision} />
        </group>
      )}

      <CompetitionObjects {...props} />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#ded8cb" roughness={0.92} />
      </mesh>
      <ArenaMarkings />
      <Grid position={[0, 0.001, 0]} args={[3.5, 3.5]} cellSize={0.1} cellThickness={0.5} cellColor="#7f8c83" sectionSize={0.5} sectionThickness={0.8} sectionColor="#66766d" fadeDistance={2.8} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.004, 0]} opacity={0.36} scale={3.5} blur={2.5} far={1.5} />
      <CameraRig preset={props.cameraPreset} controlRef={props.cameraControlRef} />
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
