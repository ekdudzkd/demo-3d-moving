import { useEffect, useState } from "react";

import { api } from "../../services/api";
import type { JobOut, Report } from "../../types/domain";

/** 완료된 작업과 보고서를 함께 불러온다 */
export function useJobReport(jobId: string) {
  const [job, setJob] = useState<JobOut | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getJob(jobId)
      .then(async (j) => {
        if (!alive) return;
        setJob(j);
        if (j.status !== "COMPLETED") {
          setError("아직 완료되지 않은 작업입니다.");
          return;
        }
        const r = await api.getJson<Report>(j.files.report);
        if (alive) setReport(r);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [jobId]);

  return { job, report, error };
}
