import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, type ModelEntry } from "../../services/api";
import type { MaskOut, ProjectOut } from "../../types/domain";
import { loadImage, renderPreviews, type Previews } from "./maskRender";
import styles from "./MaskPage.module.css";
import { EMPTY, isUsableBox, normalizeBox, toImageCoords, type Mode, type Prompts } from "./prompts";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "positive", label: "＋ 포함", hint: "객체에 포함할 곳을 클릭" },
  { id: "negative", label: "− 제외", hint: "지울 배경을 클릭" },
  { id: "box", label: "▭ 사각형", hint: "객체를 감싸도록 드래그" },
];

export function MaskPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const stage = useRef<HTMLDivElement>(null);

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [mask, setMask] = useState<MaskOut | null>(null);
  const [previews, setPreviews] = useState<Previews | null>(null);
  const [prompts, setPrompts] = useState<Prompts>(EMPTY);
  const [mode, setMode] = useState<Mode>("positive");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  const [models, setModels] = useState<ModelEntry[]>([]);
  const [generator, setGenerator] = useState("");
  const [seed, setSeed] = useState(0);
  const [ratio, setRatio] = useState(0.85);

  const refresh = useCallback(async (p: ProjectOut, m: MaskOut) => {
    const [orig, maskImg] = await Promise.all([loadImage(p.original_url), loadImage(m.url)]);
    setPreviews(renderPreviews(orig, maskImg));
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getProject(projectId)
      .then(async (p) => {
        if (!alive) return;
        setProject(p);
        const last = p.masks[p.masks.length - 1];
        if (last) {
          setMask(last);
          await refresh(p, last);
        }
      })
      .catch((e) => setError(e.message));
    api.models().then(
      (r) => {
        setModels(r.adapters.filter((a) => a.enabled));
        setGenerator(r.default);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [projectId, refresh]);

  async function run(next: Prompts) {
    if (!project) return;
    setPrompts(next);
    setBusy(true);
    setError(null);
    try {
      const m = await api.segment(project.id, { points: next.points, box: next.box });
      setMask(m);
      setEdits((n) => n + 1);
      await refresh(project, m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function coords(e: React.PointerEvent) {
    const rect = stage.current!.getBoundingClientRect();
    return toImageCoords(e.clientX, e.clientY, rect, project!.width, project!.height);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!project || busy) return;
    const p = coords(e);
    if (mode === "box") {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDrag({ a: p, b: p });
      return;
    }
    run({ ...prompts, points: [...prompts.points, { ...p, label: mode === "positive" ? 1 : 0 }] });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag) setDrag({ ...drag, b: coords(e) });
  }

  function onPointerUp() {
    if (!drag || !project) return;
    const box = normalizeBox(drag.a, drag.b);
    setDrag(null);
    if (isUsableBox(box, project.width)) run({ ...prompts, box });
  }

  async function confirmAndGenerate() {
    if (!project || !mask) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmMask(project.id, mask.version);
      const job = await api.createJob(project.id, {
        generator: generator || undefined,
        options: { seed },
        preprocess: { foreground_ratio: ratio },
      });
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!project) return <p className="muted">{error ?? "불러오는 중…"}</p>;
  const W = project.width;
  const H = project.height;
  const r = Math.max(W, H) / 90;
  const box = drag ? normalizeBox(drag.a, drag.b) : prompts.box;

  return (
    <div className={styles.grid}>
      <section className="stack">
        <div className="row">
          <h1 style={{ margin: 0 }}>객체 선택</h1>
          <span className="spacer" />
          {mask && (
            <span className="badge" title="마스크 버전 · 분할 방법 · 처리 시간">
              v{mask.version} · {mask.method} · {mask.elapsed_ms}ms
            </span>
          )}
          {mask && <span className="badge">객체 {Math.round(mask.coverage * 100)}%</span>}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          AI가 찾은 영역이 맞는지 확인하세요. 빠진 부분은 <b>포함</b>, 섞인 배경은 <b>제외</b>로 고칠 수 있어요.
        </p>

        <div className={`row ${styles.toolbar}`} role="toolbar" aria-label="마스크 편집 도구">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} onClick={() => setMode(m.id)} title={m.hint} aria-pressed={mode === m.id}>
              {m.label}
            </button>
          ))}
          <span className="spacer" />
          <button onClick={() => run({ ...prompts, points: prompts.points.slice(0, -1) })} disabled={busy || !prompts.points.length}>
            ↶ 마지막 점 취소
          </button>
          <button onClick={() => run(EMPTY)} disabled={busy}>
            ⟲ 초기화
          </button>
        </div>

        <div
          ref={stage}
          className={`${styles.stage} ${mode === "box" ? styles.crosshair : ""}`}
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          data-testid="mask-stage"
        >
          {previews ? <img src={previews.overlay} alt="원본과 선택 영역" draggable={false} /> : <img src={project.original_url} alt="원본 (마스크 불러오는 중)" draggable={false} />}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.svg} aria-hidden>
            {box && (
              <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} className={styles.box} strokeWidth={r / 3} />
            )}
            {prompts.points.map((p, i) => (
              <g key={i} transform={`translate(${p.x} ${p.y})`}>
                <circle r={r} className={p.label ? styles.pos : styles.neg} strokeWidth={r / 4} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.4} fill="#fff" fontWeight={700}>
                  {p.label ? "+" : "−"}
                </text>
              </g>
            ))}
          </svg>
          {busy && <div className={styles.busy}>분할 중…</div>}
        </div>
        {error && <div className="notice error">{error}</div>}
        <p className="muted small" style={{ margin: 0 }}>
          수정 {edits}회 · {MODES.find((m) => m.id === mode)?.hint}
        </p>
      </section>

      <aside className="stack">
        <div className="card stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>미리보기</h3>
          <div className={styles.previews}>
            {(
              [
                ["원본", project.original_url],
                ["선택된 객체", previews?.cutout],
                ["제거될 배경", previews?.removed],
                ["마스크 경계", previews?.boundary],
              ] as const
            ).map(([label, src]) => (
              <figure key={label} className={styles.figure}>
                <div className={label === "선택된 객체" ? styles.checker : styles.plain}>{src && <img src={src} alt={label} />}</div>
                <figcaption>{label}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        <div className="card stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>생성 설정</h3>
          <label className={styles.field}>
            <span>생성 모델</span>
            <select value={generator} onChange={(e) => setGenerator(e.target.value)}>
              {models.map((m) => (
                <option key={m.name} value={m.name} disabled={!m.environment?.ok}>
                  {m.name}
                  {m.environment?.ok ? "" : " (사용 불가)"}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>객체 크기 비율 {ratio.toFixed(2)}</span>
            <input type="range" min={0.6} max={0.95} step={0.05} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
          </label>
          <label className={styles.field}>
            <span>seed</span>
            <input type="number" value={seed} min={0} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
          <button className="primary" onClick={confirmAndGenerate} disabled={busy || !mask || mask.coverage < 0.01}>
            이 마스크로 3D 생성 →
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            AI가 만든 마스크를 그대로 쓰지 않고, 확인한 버전(v{mask?.version ?? "-"})만 생성에 사용합니다.
          </p>
        </div>
      </aside>
    </div>
  );
}
