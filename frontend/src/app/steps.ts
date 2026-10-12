export const STEPS = ["업로드", "객체 선택", "생성", "3D 결과", "월드", "보고서"] as const;

/** 현재 경로가 몇 번째 화면인지 */
export function stepIndex(pathname: string): number {
  if (/^\/projects\/[^/]+\/mask/.test(pathname)) return 1;
  if (/^\/jobs\/[^/]+\/(result|edit)/.test(pathname)) return 3;
  if (/^\/jobs\/[^/]+\/world/.test(pathname)) return 4;
  if (/^\/jobs\/[^/]+\/report/.test(pathname)) return 5;
  if (/^\/jobs\/[^/]+\/?$/.test(pathname)) return 2;
  return 0;
}
