import { useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import { applyViewOptions } from "../../three/ModelView";
import { type Bounds, PANEL_NAMES, PANEL_ORDER, type Panel, panelCamera, viewSpan } from "./basis";
import styles from "./EditPage.module.css";

/** 패널 정사영 카메라. 범위는 버전과 무관하게 고정(E2) — 크기를 바꾸면 화면에서도 커진다. */
function PanelCamera({ panel, span }: { panel: Panel; span: number }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const side = panel !== "top" && panel !== "bottom";
    // 옆 패널은 바닥(y=0)이 화면 아래쪽 10%에 오게, 위·아래 패널은 원점 중심
    const target: [number, number, number] = side ? [0, span * 0.4, 0] : [0, 0, 0];
    const { position, up } = panelCamera(panel, target, span * 4);
    camera.up.set(...up);
    camera.position.set(...position);
    camera.lookAt(...target);
    const aspect = size.width / Math.max(size.height, 1);
    const half = span / 2;
    const [w, h] = aspect >= 1 ? [half * aspect, half] : [half, half / aspect];
    Object.assign(camera, { left: -w, right: w, top: h, bottom: -h, near: 0.01, far: span * 10, zoom: 1 });
    camera.updateProjectionMatrix();
  }, [camera, panel, span, size.width, size.height]);
  return null;
}

function ActiveModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const copy = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => applyViewOptions(copy, { wireframe: false, colors: true }), [copy]);
  return <primitive object={copy} />;
}

/** e0 외곽(점선 상자): 원래 크기와 비교하는 기준 */
function E0Outline({ bounds }: { bounds: Bounds }) {
  const lines = useMemo(() => {
    const [lo, hi] = bounds;
    const box = new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const seg = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineDashedMaterial({ color: "#a36b25", dashSize: 0.03, gapSize: 0.02 }),
    );
    seg.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    seg.computeLineDistances();
    return seg;
  }, [bounds]);
  return <primitive object={lines} />;
}

function Ground({ span }: { span: number }) {
  return <gridHelper args={[span * 4, 40, "#c9b79a", "#e4ddd0"]} />;
}

export interface SixViewsProps {
  meshUrl: string;
  e0Bounds: Bounds;
  bounds: Bounds;
  selected: Panel;
  onSelect: (p: Panel) => void;
  label: Panel;
}

export function SixViews({ meshUrl, e0Bounds, bounds, selected, onSelect, label }: SixViewsProps) {
  const span = viewSpan(e0Bounds, bounds);
  return (
    <div className={styles.grid} role="radiogroup" aria-label="패널 선택">
      {PANEL_ORDER.map((panel) => (
        <div
          key={panel}
          role="radio"
          tabIndex={0}
          aria-checked={selected === panel}
          aria-label={`${PANEL_NAMES[panel]} 패널`}
          data-testid={`panel-${panel}`}
          className={`${styles.panel} ${selected === panel ? styles.selected : ""}`}
          onClick={() => onSelect(panel)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(panel)}
        >
          <div className={styles.panelHead}>
            <b>{PANEL_NAMES[panel]}</b>
            {panel === label && <span className="badge">입력 그림</span>}
            <span className="spacer" />
            <span className="muted small">범위 {span.toFixed(2)} m</span>
          </div>
          <Canvas orthographic dpr={[1, 2]} className={styles.canvas}>
            <color attach="background" args={["#faf8f3"]} />
            <PanelCamera panel={panel} span={span} />
            <hemisphereLight args={["#ffffff", "#b8a98f", 1.3]} />
            <directionalLight position={[3, 5, 2]} intensity={1.4} />
            <directionalLight position={[-3, -2, -2]} intensity={0.6} />
            <Ground span={span} />
            <E0Outline bounds={e0Bounds} />
            <Suspense fallback={null}>
              <ActiveModel url={meshUrl} />
            </Suspense>
          </Canvas>
        </div>
      ))}
    </div>
  );
}
