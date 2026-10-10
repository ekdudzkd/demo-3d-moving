import { Link, useParams } from "react-router-dom";

import { useJobReport } from "../model-viewer/useJobReport";
import { STAGE_LABELS, formatMs } from "../generation/stages";
import { CheckList, QualityTable } from "./QualityTable";
import styles from "./ReportPage.module.css";

const OUTCOME: Record<string, [string, string]> = {
  USABLE: ["게임 자산으로 사용 가능", "ok"],
  USABLE_WITH_WARNINGS: ["사용 가능 (경고 있음)", "warn"],
  NOT_USABLE: ["자산으로 사용하기 어려움", "error"],
};

const STEP_LABELS: Record<string, string> = {
  merge_vertices: "중복 정점 병합",
  remove_degenerate_faces: "퇴화·중복 면 제거",
  remove_small_components: "작은 분리 조각 제거",
  fix_normals: "노멀·면 방향 재계산",
  fill_small_holes: "작은 구멍 채우기",
  decimate: "폴리곤 감소",
  normalize_scale: "크기 1m로 정규화",
  center_and_ground: "원점 중앙·바닥 정렬",
};

const DOWNLOADS: [string, string][] = [
  ["repaired_glb", "보정된 GLB (월드용)"],
  ["raw_glb", "원본 GLB"],
  ["raw_mesh", "원본 메시 (모델 출력)"],
  ["asset", "asset.json (충돌체 포함)"],
  ["report", "품질 보고서 JSON"],
];

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "예" : "아니오") : typeof v === "number" ? v.toLocaleString("ko-KR") : String(v));

export function ReportPage() {
  const { jobId = "" } = useParams();
  const { job, report, error } = useJobReport(jobId);

  if (error) return <div className="notice error">{error}</div>;
  if (!job || !report) return <p className="muted">불러오는 중…</p>;
  const [label, tone] = OUTCOME[report.outcome];
  const total = report.timings.stages.reduce((a, s) => a + s.elapsed_ms, 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>결과 보고서</h1>
        <span className={`badge ${tone}`} data-testid="report-outcome">
          {label}
        </span>
        <span className="spacer" />
        <Link className="button" to={`/jobs/${job.id}/world`}>
          월드
        </Link>
        <Link className="button" to="/">
          새 그림
        </Link>
      </div>
      <p className="notice info" style={{ margin: 0 }}>
        {report.disclaimer}
      </p>

      <div className={styles.summary}>
        <Stat label="사용 가능 여부" value={report.usable ? "가능" : "불가"} tone={report.usable ? "ok" : "error"} />
        <Stat label="생성 모델" value={`${report.model.name} ${report.model.version}`} />
        <Stat label="생성 시간 (추론)" value={formatMs(report.timings.generation_ms)} />
        <Stat label="전체 처리 시간" value={formatMs(total)} />
        <Stat label="GPU 메모리 최대" value={report.timings.peak_vram_mb == null ? "측정 안 함 (CPU)" : `${report.timings.peak_vram_mb} MB`} />
        <Stat label="충돌체" value={report.asset.collision_type === "convex_hull" ? "convex hull" : "상자"} />
      </div>

      <div className={styles.cols}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>메시 품질 (보정 전 → 후)</h2>
          <QualityTable raw={report.quality.raw} repaired={report.quality.repaired} />
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>보정 전후 변화</h2>
          <table data-testid="diff-table">
            <thead>
              <tr>
                <th>지표</th>
                <th>전</th>
                <th>후</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.quality.diff.map((d) => (
                <tr key={d.metric}>
                  <td>
                    <code>{d.metric}</code>
                  </td>
                  <td className="num">{show(d.before)}</td>
                  <td className="num">{show(d.after)}</td>
                  <td>{d.improved === true ? <span className="badge ok">개선</span> : d.improved === false ? <span className="muted small">변화 없음</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className={styles.cols}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>실패 유형 분석</h2>
          {report.failure_types.length === 0 ? (
            <p className="muted">발견된 실패 유형이 없습니다.</p>
          ) : (
            <ul className={styles.failures} data-testid="failure-types">
              {report.failure_types.map((f) => (
                <li key={f.type}>
                  <div className="row" style={{ gap: 6 }}>
                    <code className={styles.ftype}>{f.type}</code>
                    {f.fixed_by_repair ? <span className="badge ok">자동 보정됨</span> : <span className="badge warn">남아 있음</span>}
                  </div>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    {f.remedy}
                  </p>
                  <p className="muted small" style={{ margin: 0 }}>
                    근거: {f.evidence.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <h3 style={{ margin: "8px 0 0" }}>보정본에 남은 경고</h3>
          <CheckList report={report.quality.repaired} />
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>자동 보정 단계</h2>
          <table data-testid="repair-steps">
            <tbody>
              {report.repair_steps.map((s) => (
                <tr key={s.name}>
                  <td>{STEP_LABELS[s.name] ?? s.name}</td>
                  <td>
                    {s.rolled_back ? (
                      <span className="badge warn" title={s.reason}>
                        되돌림
                      </span>
                    ) : (
                      <span className="badge ok">적용</span>
                    )}
                  </td>
                  <td className="num muted">{formatMs(s.elapsed_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ margin: "8px 0 0" }}>단계별 처리 시간</h3>
          <table>
            <tbody>
              {report.timings.stages.map((s) => (
                <tr key={s.stage}>
                  <td>{STAGE_LABELS[s.stage] ?? s.stage}</td>
                  <td className="num">{formatMs(s.elapsed_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className={styles.cols}>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>모델과 라이선스</h2>
          <table>
            <tbody>
              <tr>
                <th>모델</th>
                <td>
                  {report.model.name} ({report.model.version})
                </td>
              </tr>
              <tr>
                <th>설명</th>
                <td>{report.model.description || "-"}</td>
              </tr>
              <tr>
                <th>코드 / 가중치 라이선스</th>
                <td>
                  {report.model.code_license} / {report.model.weights_license}
                </td>
              </tr>
              <tr>
                <th>상업 이용</th>
                <td>{report.model.commercial_use}</td>
              </tr>
              <tr>
                <th>생성 옵션</th>
                <td>
                  <code>{JSON.stringify(report.model.options)}</code>
                </td>
              </tr>
              <tr>
                <th>입력 마스크</th>
                <td>
                  {report.input.mask ? `v${report.input.mask.version} · ${report.input.mask.method} · 객체 ${Math.round(report.input.mask.coverage * 100)}%` : "-"}
                </td>
              </tr>
            </tbody>
          </table>
          {report.model.warnings.map((w) => (
            <div key={w} className="notice warn">
              {w}
            </div>
          ))}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>다운로드</h2>
          <ul className={styles.downloads}>
            {DOWNLOADS.filter(([k]) => report.downloads[k]).map(([k, text]) => (
              <li key={k}>
                <a href={report.downloads[k]} download>
                  {text}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`card ${styles.stat}`}>
      <span className="muted small">{label}</span>
      <b className={tone ? styles[tone] : undefined}>{value}</b>
    </div>
  );
}
