import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { IssueList } from "../../components/IssueList";
import { api } from "../../services/api";
import type { ProjectOut, ValidationResult } from "../../types/domain";
import { SAMPLES, sampleFile } from "./samples";
import styles from "./UploadPage.module.css";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_MB = 10;

/** 서버 검사 전에 브라우저에서 바로 걸러낼 수 있는 것만 확인한다. 최종 판정은 서버. */
export function precheck(file: File, maxMb = MAX_MB): string | null {
  if (!ACCEPT.includes(file.type)) return "PNG, JPG, WEBP 이미지만 올릴 수 있습니다.";
  if (file.size > maxMb * 1024 * 1024) return `파일이 ${maxMb}MB를 넘습니다.`;
  return null;
}

export function UploadPage() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rejected, setRejected] = useState<ValidationResult | null>(null);
  const [project, setProject] = useState<ProjectOut | null>(null);
  const [retention, setRetention] = useState(24);
  const [maxMb, setMaxMb] = useState(MAX_MB);

  useEffect(() => {
    api.health().then(
      (h) => {
        setRetention(h.retention_hours);
        setMaxMb(h.max_upload_mb);
      },
      () => {},
    );
  }, []);

  async function handle(file: File) {
    setError(null);
    setRejected(null);
    setProject(null);
    const problem = precheck(file, maxMb);
    if (problem) return setError(problem);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const r = await api.createProject(file);
      if (r.ok) setProject(r.project);
      else setRejected(r.validation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const v = project?.validation;

  return (
    <div className={styles.grid}>
      <section className="stack">
        <div>
          <h1>그림을 3D로</h1>
          <p className="muted">그림 한 장을 올리면 객체를 찾아 3D 모델로 만들고, 작은 방에서 움직여 볼 수 있어요.</p>
        </div>

        <div
          className={`${styles.drop} ${dragging ? styles.dragging : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handle(f);
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          aria-label="이미지 업로드"
        >
          {preview ? (
            <img src={preview} alt="업로드한 이미지" className={styles.preview} />
          ) : (
            <div className="stack" style={{ alignItems: "center", gap: 6 }}>
              <span className={styles.icon} aria-hidden>
                ⬆
              </span>
              <b>이미지를 끌어다 놓거나 클릭해서 선택</b>
              <span className="muted small">PNG · JPG · WEBP, 최대 {maxMb}MB, 짧은 변 512px 이상</span>
            </div>
          )}
          {busy && <div className={styles.busy}>검사 중…</div>}
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
            e.target.value = "";
          }}
        />

        {error && <div className="notice error">{error}</div>}
        {rejected && (
          <div className="card stack">
            <h2>이 이미지는 사용할 수 없어요</h2>
            <IssueList errors={rejected.errors} warnings={rejected.warnings} />
          </div>
        )}
        {project && v && (
          <div className="card stack">
            <div className="row">
              <h2 style={{ margin: 0 }}>입력 검사 통과</h2>
              <span className="badge ok">객체 {v.object_count}개</span>
              <span className="badge">차지 비율 {Math.round((v.object_coverage ?? 0) * 100)}%</span>
              <span className="badge">
                {v.width}×{v.height}
              </span>
            </div>
            {v.warnings?.length ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  진행할 수 있지만 결과가 나빠질 수 있는 점이 있어요.
                </p>
                <IssueList warnings={v.warnings} />
              </>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                시스템이 주 객체를 찾아 마스크를 만들어 두었어요. 다음 화면에서 확인하고 고칠 수 있어요.
              </p>
            )}
            <div className="row">
              <button className="primary" onClick={() => navigate(`/projects/${project.id}/mask`)}>
                객체 선택으로 →
              </button>
            </div>
          </div>
        )}

        <div>
          <h3>샘플로 해보기</h3>
          <div className="row">
            {SAMPLES.map((s) => (
              <button key={s.id} className={styles.sample} onClick={async () => handle(await sampleFile(s.url, s.id))} disabled={busy}>
                <img src={s.url} alt="" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="stack">
        <div className="card stack" style={{ gap: 8 }}>
          <h3>잘 나오는 사진 찍기</h3>
          <ul className={styles.list}>
            <li>흰 종이 위 그림, 위에서 정면으로</li>
            <li>그림자와 반사가 적게</li>
            <li>윤곽선은 굵게, 안쪽은 색칠</li>
            <li>한 장에 그림 하나만, 가운데 크게</li>
            <li>종이 밖으로 잘리지 않게</li>
          </ul>
        </div>
        <div className="card stack" style={{ gap: 8 }}>
          <h3>지원 조건</h3>
          <ul className={styles.list}>
            <li>PNG · JPG · WEBP, 최대 {maxMb}MB</li>
            <li>짧은 변 512px 이상 (큰 이미지는 2048px로 줄임)</li>
            <li>투명 배경 PNG 지원</li>
            <li>객체 하나 (여러 개면 다음 화면에서 하나 선택)</li>
          </ul>
        </div>
        <div className="card stack" style={{ gap: 8 }}>
          <h3>개인정보와 저장</h3>
          <ul className={styles.list}>
            <li>위치 등 사진 메타데이터(EXIF)는 업로드 즉시 지웁니다.</li>
            <li>이미지와 생성물은 {retention}시간 뒤 서버에서 자동 삭제됩니다.</li>
            <li>공개되거나 학습에 쓰이지 않습니다.</li>
            <li>아이 그림은 보호자가 올려 주세요.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
