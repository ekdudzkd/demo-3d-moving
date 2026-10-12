import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ModelView, type ViewOptions } from "../../three/ModelView";
import { CheckList, QualityTable } from "../quality-report/QualityTable";
import styles from "./ResultPage.module.css";
import { useJobReport } from "./useJobReport";

const OUTCOME: Record<string, [string, string]> = {
  USABLE: ["게임 자산으로 사용 가능", "ok"],
  USABLE_WITH_WARNINGS: ["사용 가능 (경고 있음)", "warn"],
  NOT_USABLE: ["자산으로 사용하기 어려움", "error"],
};

export function ResultPage() {
  const { jobId = "" } = useParams();
  const { job, report, error } = useJobReport(jobId);
  const [options, setOptions] = useState<ViewOptions>({ wireframe: false, colors: true, grid: true });
  const [compare, setCompare] = useState(true);

  if (error) return <div className="notice error">{error}</div>;
  if (!job || !report) return <p className="muted">불러오는 중…</p>;
  const [label, tone] = OUTCOME[report.outcome];
  const toggle = (key: keyof ViewOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>3D 결과</h1>
        <span className={`badge ${tone}`}>{label}</span>
        <span className="badge">모델 {report.model.name}</span>
        <span className="spacer" />
        <Link className="button" to={`/jobs/${job.id}/edit`}>
          6방향 보기·편집
        </Link>
        <Link className="button primary" to={`/jobs/${job.id}/world`}>
          월드에 배치 →
        </Link>
        <Link className="button" to={`/jobs/${job.id}/report`}>
          보고서
        </Link>
      </div>
      <p className="notice info" style={{ margin: 0 }}>
        {report.disclaimer}
      </p>

      <div className="row" role="toolbar" aria-label="보기 옵션">
        <button className={options.wireframe ? "active" : ""} aria-pressed={options.wireframe} onClick={() => toggle("wireframe")}>
          와이어프레임
        </button>
        <button className={options.colors ? "active" : ""} aria-pressed={options.colors} onClick={() => toggle("colors")}>
          {report.quality.repaired.has_texture ? "텍스처" : "색"}
        </button>
        <button className={options.grid ? "active" : ""} aria-pressed={options.grid} onClick={() => toggle("grid")}>
          바닥 격자
        </button>
        <button className={compare ? "active" : ""} aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
          원본·보정본 비교
        </button>
        <span className="muted small">드래그: 회전 · 휠: 확대/축소 · 우클릭 드래그: 이동</span>
      </div>

      <div className={compare ? styles.split : styles.single}>
        {compare && (
          <figure className={styles.view}>
            <ModelView url={report.downloads.raw_glb} options={options} label="원본" />
            <figcaption>
              <b>원본</b> 생성 메시 · 면 {report.quality.raw.face_count.toLocaleString()} · 조각 {report.quality.raw.connected_components}
            </figcaption>
          </figure>
        )}
        <figure className={styles.view}>
          <ModelView url={report.downloads.repaired_glb} options={options} label="보정본" />
          <figcaption>
            <b>보정본</b> 바닥 정렬·높이 1m · 면 {report.quality.repaired.face_count.toLocaleString()}
          </figcaption>
        </figure>
      </div>

      <div className={styles.panels}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>메시 품질 검사</h2>
          <QualityTable raw={report.quality.raw} repaired={report.quality.repaired} />
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>보정본에 남은 경고</h2>
          <CheckList report={report.quality.repaired} />
          <h3 style={{ margin: "8px 0 0" }}>원본에서 발견된 문제</h3>
          <CheckList report={report.quality.raw} />
        </section>
      </div>
    </div>
  );
}
