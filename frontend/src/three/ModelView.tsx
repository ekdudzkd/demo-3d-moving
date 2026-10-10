import { Bounds, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";

export interface ViewOptions {
  wireframe: boolean;
  colors: boolean;
  grid: boolean;
}

/** GLB 머티리얼에 표시 옵션 적용. 원래 텍스처는 userData에 보관해 되돌린다. */
export function applyViewOptions(root: THREE.Object3D, opts: Pick<ViewOptions, "wireframe" | "colors">) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials as THREE.MeshStandardMaterial[]) {
      if (m.userData.origMap === undefined) {
        m.userData.origMap = m.map ?? null;
        m.userData.origVertexColors = m.vertexColors;
      }
      m.wireframe = opts.wireframe;
      m.map = opts.colors ? m.userData.origMap : null;
      m.vertexColors = opts.colors ? m.userData.origVertexColors : false;
      if (!opts.colors) m.color.set("#c9c4b8");
      else m.color.set("#ffffff");
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  });
}

function Model({ url, options }: { url: string; options: ViewOptions }) {
  const { scene } = useGLTF(url);
  const copy = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => {
    // clone은 머티리얼을 공유하므로 뷰마다 복제
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    });
  }, [copy]);
  useEffect(() => applyViewOptions(copy, options), [copy, options]);
  return <primitive object={copy} />;
}

export function ModelView({ url, options, label }: { url: string; options: ViewOptions; label: string }) {
  return (
    <Canvas camera={{ position: [1.6, 1.2, 1.8], fov: 40 }} dpr={[1, 2]} aria-label={label} data-testid={`viewer-${label}`}>
      <color attach="background" args={["#faf8f3"]} />
      <hemisphereLight args={["#ffffff", "#b8a98f", 1.2]} />
      <directionalLight position={[3, 5, 2]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      <Suspense fallback={null}>
        <Bounds fit clip margin={1.3}>
          <Model url={url} options={options} />
        </Bounds>
      </Suspense>
      {options.grid && <Grid args={[4, 4]} cellSize={0.1} sectionSize={0.5} sectionColor="#a36b25" cellColor="#d9d3c4" fadeDistance={6} infiniteGrid />}
      <axesHelper args={[0.25]} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
