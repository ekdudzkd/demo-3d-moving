import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../../services/api";
import { subscribeJobEvents } from "../../services/sse";
import { TERMINAL, type JobEventOut, type JobOut, type StageEvent } from "../../types/domain";
import styles from "./ProgressPage.module.css";
import { STAGE_LABELS, deriveStages, formatMs } from "./stages";

const OUTCOME_LABEL: Record<string, [string, string]> = {
  USABLE: ["게임 자산으로 사용 가능", "ok"],
  USABLE_WITH_WARNINGS: ["사용 가능 (경고 있음)", "warn"],
  NOT_USABLE: ["자산으로 사용하기 어려움", "error"],
};

export function ProgressPage() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobOut | null>(null);
  const [events, setEvents] = useState<(JobEventOut | StageEvent)[]>([]);
  const [status, setStatus] = useState<string>("QUEUED");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let closed = false;
    let unsubscribe = () => {};
    setEvents([]);
    api
      .getJob(jobId)
      .then((j) => {
        if (closed) return;
        setJob(j);
        setStatus(j.status);
        // SSE가 처음부터 다시 보내므로 초기 이벤트는 SSE로만 받는다
        unsubscribe = subscribeJobEvents(
          jobId,
          (e) => {
            setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]));
            setStatus(e.status);
          },
          () => api.getJob(jobId).then((final) => !closed && (setJob(final), setStatus(final.status))),
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      closed = true;
      unsubscribe();
    };
  }, [jobId]);

  const running = !TERMINAL.includes(status);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const stages = useMemo(() => deriveStages(events, status), [events, status]);

  async function act(fn: () => Promise<JobOut>, go = false) {
    setBusy(true);
    try {
      const j = await fn();
      if (go) navigate(`/jobs/${j.id}`);
      else setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!job) return <p className="muted">{error ?? "불러오는 중…"}</p>;
  const err = job.error;
  const outcome = job.outcome ? OUTCOME_LABEL[job.outcome] : null;
  const retryOptions = err?.code === "CUDA_OOM" ? { options: { mc_resolution: 192 } } : {};

  return (
    <div className={styles.grid}>
      <section className="stack">
        <div className="row">
          <h1 style={{ margin: 0 }}>3D 생성</h1>
          <span className="badge">모델 {job.model_name ?? job.generator}</span>
          <span className={`badge ${status === "COMPLETED" ? "ok" : status === "FAILED" ? "error" : ""}`} data-testid="job-status">
            {STAGE_LABELS[status] ?? status}
          </span>
          <span className="spacer" />
          {running && (
            <button onClick={() => act(() => api.cancelJob(job.id))} disabled={busy || job.cancel_requested}>
              {job.cancel_requested ? "취소 요청됨" : "취소"}
            </button>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          실제로 진행 중인 단계를 보여줍니다. 각 단계의 세부 진행률은 알 수 없어 퍼센트 대신 단계와 경과 시간만 표시해요.
        </p>

        <ol className={styles.timeline} aria-label="생성 단계">
          {status === "QUEUED" && (
            <li className={styles.running}>
              <span className={styles.dot} />
              <span>대기열에서 차례를 기다리는 중</span>
            </li>
          )}
          {stages.map((s) => {
            const live = s.state === "running" && s.startedAt ? Math.max(0, now - Date.parse(s.startedAt)) : null;
            return (
              <li key={s.stage} className={styles[s.state]} data-stage={s.stage} data-state={s.state}>
                <span className={styles.dot} />
                <span className={styles.name}>{STAGE_LABELS[s.stage]}</span>
                <span className={styles.code}>{s.stage}</span>
                <span className="spacer" />
                <span className={styles.time}>
                  {s.state === "done" && formatMs(s.elapsedMs)}
                  {s.state === "running" && `${formatMs(live)} 경과`}
                  {s.state === "failed" && "실패"}
                  {s.state === "skipped" && "건너뜀"}
                </span>
              </li>
            );
          })}
        </ol>

        {status === "COMPLETED" && outcome && (
          <div className="card stack">
            <div className="row">
              <h2 style={{ margin: 0 }}>생성 완료</h2>
              <span className={`badge ${outcome[1]}`}>{outcome[0]}</span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              파일이 만들어졌다고 바로 성공이 아니라, 메시 검사 결과로 자산 사용 가능 여부를 판정했어요.
            </p>
            <div className="row">
              <Link className="button primary" to={`/jobs/${job.id}/result`}>
                3D 결과 보기 →
              </Link>
              <Link className="button" to={`/jobs/${job.id}/world`}>
                월드에 배치
              </Link>
              <Link className="button" to={`/jobs/${job.id}/report`}>
                보고서
              </Link>
            </div>
          </div>
        )}

        {err && (
          <div className="card stack" data-testid="job-error">
            <div className="row">
              <h2 style={{ margin: 0 }}>{status === "CANCELLED" ? "취소됨" : "생성 실패"}</h2>
              <span className="badge error">{err.code}</span>
              <span className="badge">단계 {STAGE_LABELS[err.stage] ?? err.stage}</span>
            </div>
            <p style={{ margin: 0 }}>{err.user_message}</p>
            {err.detail && <code className="muted small">{err.detail}</code>}
            <div className="row">
              {err.retryable && (
                <button className="primary" onClick={() => act(() => api.retryJob(job.id, retryOptions), true)} disabled={busy}>
                  다시 시도{err.code === "CUDA_OOM" ? " (해상도 낮춤)" : ""}
                </button>
              )}
              <Link className="button" to={`/projects/${job.project_id}/mask`}>
                마스크 수정
              </Link>
              {err.log_url && (
                <a className="button" href={err.log_url} target="_blank" rel="noreferrer">
                  로그 보기
                </a>
              )}
            </div>
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
      </section>

      <aside className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>진행 로그</h3>
        <ol className={styles.log} data-testid="job-log">
          {events.map((e) => (
            <li key={e.seq} className={e.kind === "error" ? styles.logError : undefined}>
              <time>{new Date(e.at).toLocaleTimeString()}</time>
              <span>{e.message}</span>
              {e.elapsed_ms != null && <span className="muted">({formatMs(e.elapsed_ms)})</span>}
            </li>
          ))}
        </ol>
        {job.retry_of && (
          <p className="muted small" style={{ margin: 0 }}>
            재시도 작업입니다. 이전 작업: <Link to={`/jobs/${job.retry_of}`}>{job.retry_of}</Link>
          </p>
        )}
      </aside>
    </div>
  );
}
