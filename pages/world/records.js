// 종목 기록 (브라우저 저장소). 저장소가 막혀 있어도 월드는 그대로 동작한다.
const KEY = "d2w-world-records-v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function save(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 저장 불가: 이번 접속에서만 기억하지 못한다 */
  }
}

/** lowerIsBetter: 시간처럼 작을수록 좋은 기록 */
export const RECORD_RULES = {
  run: { lowerIsBetter: true, label: (v) => `${v.toFixed(2)}초` },
  hj: { lowerIsBetter: false, label: (v) => `${v.toFixed(2)}m` },
  arch: { lowerIsBetter: false, label: (v) => `${v}점` },
  swim: { lowerIsBetter: true, label: (v) => `${v.toFixed(2)}초` },
  tug: { lowerIsBetter: true, label: (v) => `${v.toFixed(1)}초` },
  orch: { lowerIsBetter: false, label: (v) => `${v}점` },
};

export function bestOf(id) {
  const v = load()[id];
  return typeof v === "number" ? v : null;
}

/** 새 최고 기록이면 저장하고 true */
export function submitRecord(id, value) {
  const rule = RECORD_RULES[id];
  const all = load();
  const cur = all[id];
  const better = typeof cur !== "number" || (rule.lowerIsBetter ? value < cur : value > cur);
  if (better) {
    all[id] = value;
    save(all);
  }
  return better;
}

export function bestText(id) {
  const v = bestOf(id);
  return v === null ? "아직 기록 없음" : `내 최고 ${RECORD_RULES[id].label(v)}`;
}
