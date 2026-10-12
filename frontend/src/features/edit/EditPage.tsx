import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../../services/api";
import { subscribeAssetEvents } from "../../services/sse";
import type { EditsOut, JobOut } from "../../types/domain";
import { type Bounds, PANEL_NAMES, type Panel } from "./basis";
import styles from "./EditPage.module.css";
import { type ChatMessage, QUICK_PROMPTS, finishedMessage, kindLabel, planMessage, versionLabel } from "./messages";
import { SixViews } from "./SixViews";

const POLL_MS = 1500;

export function EditPage() {
  const { jobId = "" } = useParams();
  const [job, setJob] = useState<JobOut | null>(null);
  const [state, setState] = useState<EditsOut | null>(null);
  const [panel, setPanel] = useState<Panel>("front");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const awaiting = useRef<number | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const assetId = job?.asset_id ?? null;

  const say = (m: ChatMessage) => setChat((c) => [...c, m]);

  const reload = useCallback(async () => {
    if (!assetId) return;
    const next = await api.getEdits(assetId);
    setState(next);
    const wait = awaiting.current;
    const v = wait != null ? next.versions.find((x) => x.version === wait) : undefined;
    if (v && (v.status === "ready" || v.status === "failed")) {
      awaiting.current = null;
      say(finishedMessage(v));
    }
  }, [assetId]);

  useEffect(() => {
    let alive = true;
    api
      .getJob(jobId)
      .then((j) => {
        if (!alive) return;
        if (!j.asset_id) setError("아직 자산이 만들어지지 않은 작업입니다.");
        setJob(j);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (!assetId) return;
    reload().catch((e) => setError(e.message));
    return subscribeAssetEvents(assetId, () => void reload());
  }, [assetId, reload]);

  // 입력 그림 패널을 처음 선택값으로
  const label = (state?.view_label ?? "front") as Panel;
  useEffect(() => setPanel(label), [label]);

  // SSE가 끊긴 환경을 위해 진행 중일 때는 짧게 폴링
  useEffect(() => {
    if (state?.in_progress == null) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [state?.in_progress, reload]);

  useEffect(() => {
    // 최신 브라우저의 scrollIntoView는 Promise를 돌려주므로 effect의 반환값(cleanup)으로 넘기지 않는다
    chatEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [chat]);

  async function send(message: string) {
    if (!assetId || !message.trim() || busy) return;
    setBusy(true);
    say({ role: "user", text: `[${PANEL_NAMES[panel]}] ${message}` });
    try {
      const r = await api.edit(assetId, panel, message);
      say(planMessage(r));
      if (r.queued) awaiting.current = r.version;
      setText("");
      await reload();
    } catch (e) {
      say({ role: "system", text: e instanceof Error ? e.message : String(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<{ version: number }>, label: string) {
    setBusy(true);
    try {
      const v = await fn();
      awaiting.current = v.version;
      say({ role: "system", text: `${label}: e${v.version} 적용 중…`, tone: "info" });
      await reload();
    } catch (e) {
      say({ role: "system", text: e instanceof Error ? e.message : String(e), tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="notice error">{error}</div>;
  if (!job || !state || !assetId) return <p className="muted">불러오는 중…</p>;

  const active = state.versions.find((v) => v.version === state.active_version)!;
  const e0 = state.versions[0];
  const pending = state.in_progress != null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>6방향 보기·편집</h1>
        <span className="badge" data-testid="active-version">
          현재 e{state.active_version}
        </span>
        {pending && <span className="badge warn">e{state.in_progress} 적용 중</span>}
        <span className="spacer" />
        <Link className="button" to={`/jobs/${job.id}/result`}>
          ← 3D 결과
        </Link>
        <Link className="button primary" to={`/jobs/${job.id}/world`}>
          월드에 배치 →
        </Link>
      </div>
      <p className="notice info" style={{ margin: 0 }}>
        뒷면·옆면은 그림 한 장으로 AI가 추정한 모양입니다. 패널을 골라 그 화면 기준으로 말하면 전체 방향·두께·크기를 고칩니다. 점선 상자는
        처음(e0) 크기예요.
      </p>

      <div className={styles.layout}>
        <SixViews
          meshUrl={active.mesh_url!}
          e0Bounds={e0.bounds as Bounds}
          bounds={active.bounds as Bounds}
          selected={panel}
          onSelect={setPanel}
          label={label}
        />

        <aside className="stack" style={{ gap: 12 }}>
          <section className="card stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>
              말로 고치기 <span className="muted small">· {PANEL_NAMES[panel]} 패널 기준</span>
            </h2>
            <div className={styles.chat} aria-live="polite" data-testid="edit-chat">
              {chat.length === 0 && <p className="muted small">예: "옆으로 누워 있어, 세워줘", "더 두껍게", "옆으로 2배 길게"</p>}
              {chat.map((m, i) => (
                <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.user : m.tone ? styles[m.tone] : ""}`}>
                  {m.text}
                  {m.suggested && (
                    <button style={{ marginLeft: 8 }} onClick={() => setText(m.suggested!)}>
                      "{m.suggested}"로 고쳐 쓰기
                    </button>
                  )}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className={styles.chips}>
              {QUICK_PROMPTS.map((q) => (
                <button key={q} disabled={busy || pending} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
            <form
              className={styles.input}
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <input
                aria-label="편집 요청"
                placeholder={`${PANEL_NAMES[panel]} 화면 기준으로 말해 주세요`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
              <button className="primary" type="submit" disabled={busy || pending || !text.trim()}>
                보내기
              </button>
            </form>
          </section>

          <section className="card stack" style={{ gap: 8 }}>
            <div className="row">
              <h2 style={{ margin: 0 }}>버전</h2>
              <span className="spacer" />
              <button disabled={busy || pending || !state.can_undo} onClick={() => act(() => api.undo(assetId), "되돌리기")}>
                되돌리기
              </button>
            </div>
            <ol className={styles.timeline} data-testid="edit-versions">
              {[...state.versions].reverse().map((v) => (
                <li key={v.version} className={v.version === state.active_version ? styles.active : ""}>
                  <b>e{v.version}</b>
                  <span className="badge">{kindLabel(v.kind)}</span>
                  <span className={styles.text} title={versionLabel(v)}>
                    {versionLabel(v)}
                  </span>
                  {v.status !== "ready" && (
                    <span className={`badge ${v.status === "failed" ? "error" : "warn"}`}>{v.status === "failed" ? "실패" : "처리 중"}</span>
                  )}
                  {v.status === "ready" && v.version !== state.active_version && (
                    <button disabled={busy || pending} onClick={() => act(() => api.revert(assetId, v.version), `e${v.version}로 복귀`)}>
                      이 버전으로
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
