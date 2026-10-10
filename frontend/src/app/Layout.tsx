import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { api, type Health } from "../services/api";
import styles from "./Layout.module.css";
import { STEPS, stepIndex } from "./steps";

export function Layout() {
  const { pathname } = useLocation();
  const current = stepIndex(pathname);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api.health().then(setHealth, () => setOffline(true));
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden>
            ▲
          </span>
          Draw2World AI
        </Link>
        <ol className={styles.steps} aria-label="진행 단계">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i === current ? styles.current : i < current ? styles.done : undefined}
              aria-current={i === current ? "step" : undefined}
            >
              <span className={styles.num}>{i + 1}</span>
              <span className={styles.label}>{label}</span>
            </li>
          ))}
        </ol>
      </header>

      {offline && (
        <div className={`notice error ${styles.banner}`}>
          백엔드 API에 연결할 수 없습니다. <code>uvicorn</code> 서버와 워커가 실행 중인지 확인해 주세요.
        </div>
      )}
      {health?.generator === "mock" && (
        <div className={`notice warn ${styles.banner}`}>
          현재 생성기는 <b>Mock</b>입니다. 그림의 실루엣을 두께 있게 밀어낸 형상이며 AI 모델 결과가 아닙니다.
        </div>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>

      <footer className={styles.footer}>
        한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다. 보이지 않는 부분은 실제 모습과 다를 수 있습니다.
        {health && (
          <span className={styles.meta}>
            분할 {health.segmenter} · 생성 {health.generator} · 업로드 이미지는 {health.retention_hours}시간 후 삭제
          </span>
        )}
      </footer>
    </div>
  );
}
