import type { StageEvent } from "../types/domain";

/** 작업 단계 이벤트 구독. EventSource가 끊기면 Last-Event-ID로 자동 재연결한다. */
export function subscribeJobEvents(
  jobId: string,
  onEvent: (e: StageEvent) => void,
  onEnd: (status: string) => void,
): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.addEventListener("stage", (msg) => onEvent(JSON.parse((msg as MessageEvent).data)));
  source.addEventListener("end", (msg) => {
    onEnd(JSON.parse((msg as MessageEvent).data).status);
    source.close();
  });
  return () => source.close();
}
