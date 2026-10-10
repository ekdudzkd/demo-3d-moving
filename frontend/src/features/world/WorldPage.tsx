import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../../services/api";
import type { Asset } from "../../types/domain";
import { chooseCollider } from "./physics";
import { WorldScene } from "./WorldScene";
import styles from "./WorldPage.module.css";

export function WorldPage() {
  const { jobId = "" } = useParams();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    api
      .getJob(jobId)
      .then((j) => {
        if (!j.asset_id) throw new Error("이 작업에는 월드 자산이 없습니다. 생성이 끝났는지 확인해 주세요.");
        return api.getAsset(j.asset_id);
      })
      .then(setAsset)
      .catch((e) => setError(e.message));
  }, [jobId]);

  const spec = useMemo(() => (asset ? chooseCollider(asset) : null), [asset]);

  if (error) return <div className="notice error">{error}</div>;
  if (!asset || !spec) return <p className="muted">불러오는 중…</p>;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>인터랙티브 월드</h1>
        <span className="badge" data-testid="collider-kind">
          충돌체 {spec.kind === "hull" ? `convex hull (${spec.count}점)` : "상자"}
        </span>
        <span className="badge">질량 {asset.mass}kg</span>
        <span className="spacer" />
        <button className={debug ? "active" : ""} aria-pressed={debug} onClick={() => setDebug((d) => !d)}>
          충돌체 보기
        </button>
        <Link className="button" to={`/jobs/${jobId}/result`}>
          3D 결과
        </Link>
        <Link className="button primary" to={`/jobs/${jobId}/report`}>
          보고서 →
        </Link>
      </div>
      {spec.kind === "box" && <div className="notice warn">{spec.reason} — 상자 충돌체를 사용합니다.</div>}

      <div className={styles.stage}>
        <WorldScene asset={asset} debug={debug} />
        <div className={styles.hud} aria-label="조작법">
          <b>조작</b>
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> 이동
          </span>
          <span>
            <kbd>Q</kbd>
            <kbd>E</kbd> 회전
          </span>
          <span>
            <kbd>Space</kbd> 점프
          </span>
          <span>
            <kbd>R</kbd> 처음 위치로
          </span>
          <span className="muted">마우스 드래그: 카메라 · 상자와 공은 밀 수 있어요</span>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        자동 리깅이 없어 모델 전체를 하나의 물체로 움직입니다. 걷기·관절 애니메이션은 이후 확장 단계에서 다룹니다.
      </p>
    </div>
  );
}
