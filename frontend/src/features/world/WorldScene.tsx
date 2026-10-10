import { KeyboardControls, OrbitControls, useGLTF, useKeyboardControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ConvexHullCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import type { Asset } from "../../types/domain";
import { chooseCollider, moveDirection, type ColliderSpec } from "./physics";

const ROOM = 10;
const SPEED = 2.5;
const TURN = 2.2;
const JUMP = 4.2;

const KEYMAP = [
  { name: "forward", keys: ["KeyW", "ArrowUp"] },
  { name: "back", keys: ["KeyS", "ArrowDown"] },
  { name: "left", keys: ["KeyA", "ArrowLeft"] },
  { name: "right", keys: ["KeyD", "ArrowRight"] },
  { name: "turnLeft", keys: ["KeyQ"] },
  { name: "turnRight", keys: ["KeyE"] },
  { name: "jump", keys: ["Space"] },
  { name: "reset", keys: ["KeyR"] },
];

type Controls = "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight" | "jump" | "reset";

/** E2E 테스트가 물리 상태를 읽을 수 있게 노출 */
declare global {
  interface Window {
    __d2wWorld?: { position: () => [number, number, number]; yaw: () => number; collider: ColliderSpec["kind"] };
  }
}

function Room() {
  const wall = (pos: [number, number, number], size: [number, number, number]) => (
    <RigidBody type="fixed" position={pos} colliders={false}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#e9e2d3" />
      </mesh>
    </RigidBody>
  );
  const h = ROOM / 2;
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, -0.1, 0]} name="floor">
        <CuboidCollider args={[h, 0.1, h]} />
        <mesh receiveShadow>
          <boxGeometry args={[ROOM, 0.2, ROOM]} />
          <meshStandardMaterial color="#f1ebdd" />
        </mesh>
      </RigidBody>
      <gridHelper args={[ROOM, ROOM, "#c9bfa9", "#ddd5c3"]} position={[0, 0.001, 0]} />
      {wall([0, 0.5, -h], [ROOM, 1, 0.2])}
      {wall([0, 0.5, h], [ROOM, 1, 0.2])}
      {wall([-h, 0.5, 0], [0.2, 1, ROOM])}
      {wall([h, 0.5, 0], [0.2, 1, ROOM])}
    </>
  );
}

function Props() {
  const boxes: [number, number, number, string][] = [
    [2, 0.3, -1.5, "#d98b4b"],
    [-2.2, 0.3, -2, "#6f9fd8"],
    [1.5, 0.3, 2.2, "#86b86a"],
  ];
  return (
    <>
      {boxes.map(([x, y, z, color]) => (
        <RigidBody key={`${x}${z}`} position={[x, y, z]} colliders="cuboid" mass={0.4}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </RigidBody>
      ))}
      <RigidBody position={[-1.5, 0.4, 1.5]} colliders="ball" mass={0.3} restitution={0.6}>
        <mesh castShadow>
          <sphereGeometry args={[0.3, 24, 16]} />
          <meshStandardMaterial color="#e2c044" />
        </mesh>
      </RigidBody>
    </>
  );
}

function Player({ asset, spec, orbit }: { asset: Asset; spec: ColliderSpec; orbit: React.RefObject<OrbitControlsImpl> }) {
  const body = useRef<RapierRigidBody>(null);
  const contacts = useRef(0);
  const jumpHeld = useRef(false);
  const { scene } = useGLTF(asset.mesh_url);
  const model = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    return s;
  }, [scene]);
  const [, get] = useKeyboardControls<Controls>();
  const camera = useThree((s) => s.camera);
  const spawn = asset.spawn_position;

  useEffect(() => {
    window.__d2wWorld = {
      position: () => {
        const t = body.current?.translation();
        return t ? [t.x, t.y, t.z] : [NaN, NaN, NaN];
      },
      yaw: () => {
        const r = body.current?.rotation();
        return r ? new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y : NaN;
      },
      collider: spec.kind,
    };
    return () => {
      delete window.__d2wWorld;
    };
  }, [spec.kind]);

  useFrame(() => {
    const b = body.current;
    if (!b) return;
    const keys = get();
    if (keys.reset) {
      b.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      return;
    }
    const yaw = Math.atan2(camera.position.x - b.translation().x, camera.position.z - b.translation().z);
    const [dx, dz] = moveDirection(keys, yaw);
    const v = b.linvel();
    b.setLinvel({ x: dx * SPEED, y: v.y, z: dz * SPEED }, true);
    b.setAngvel({ x: 0, y: (Number(keys.turnLeft) - Number(keys.turnRight)) * TURN, z: 0 }, true);
    if (keys.jump && !jumpHeld.current && contacts.current > 0) {
      b.applyImpulse({ x: 0, y: JUMP * b.mass(), z: 0 }, true);
    }
    jumpHeld.current = keys.jump;

    // 카메라가 오브젝트를 따라간다
    const t = b.translation();
    const target = orbit.current?.target;
    if (target) {
      const dxT = t.x - target.x;
      const dzT = t.z - target.z;
      target.set(t.x, 0.4, t.z);
      camera.position.x += dxT;
      camera.position.z += dzT;
    }
  });

  return (
    <RigidBody
      ref={body}
      position={spawn}
      colliders={false}
      mass={asset.mass}
      enabledRotations={[false, true, false]}
      linearDamping={0.5}
      angularDamping={4}
      onCollisionEnter={() => (contacts.current += 1)}
      onCollisionExit={() => (contacts.current = Math.max(0, contacts.current - 1))}
      name="player"
    >
      {spec.kind === "hull" ? (
        <ConvexHullCollider args={[spec.points]} friction={0.6} />
      ) : (
        <CuboidCollider args={spec.halfExtents} position={spec.center} friction={0.6} />
      )}
      <primitive object={model} scale={asset.scale} />
    </RigidBody>
  );
}

export function WorldScene({ asset, debug }: { asset: Asset; debug: boolean }) {
  const spec = useMemo(() => chooseCollider(asset), [asset]);
  const orbit = useRef<OrbitControlsImpl>(null);
  return (
    <KeyboardControls map={KEYMAP}>
      <Canvas shadows camera={{ position: [0, 2.6, 4.2], fov: 50 }} data-testid="world-canvas">
        <color attach="background" args={["#f4f1ea"]} />
        <hemisphereLight args={["#ffffff", "#b8a98f", 1]} />
        <directionalLight
          position={[4, 8, 3]}
          intensity={1.8}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
        />
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]} debug={debug}>
            <Room />
            <Props />
            <Player asset={asset} spec={spec} orbit={orbit} />
          </Physics>
        </Suspense>
        <OrbitControls ref={orbit} makeDefault target={[0, 0.4, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={1.5} maxDistance={9} />
      </Canvas>
    </KeyboardControls>
  );
}
