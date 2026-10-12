// 한국어 규칙 기반 Mock 플래너 — backend/app/edit/planner.py MockPlanner를 그대로 옮긴 것.
// 문장 → 화면 기준 op. 월드 축 변환·범위 검사는 edit.js(resolve)가 한다.
// 기대값: backend/tests/fixtures/edit_cases.json "planner" (Python과 같은 표).

import { MAX_FACTOR, MIN_FACTOR } from "./edit.js";

export const EXAMPLES = "예: '세워줘', '더 두껍게', '옆으로 2배 길게', '시계방향으로 90도 돌려', '좌우 반전'";

const PARTS = ["귀", "다리", "팔", "머리", "꼬리", "바퀴", "손잡이", "눈", "코", "입", "날개", "뿔",
  "지붕", "문", "창문", "손", "발", "목", "몸통", "얼굴", "부리", "줄기", "잎", "뚜껑"];
const SHAPE_EDIT = ["추가", "달아", "붙여", "없애", "지워", "빼줘", "만들어", "그려"];
const COLOR = ["색", "빨갛", "파랗", "노랗", "까맣", "하얗", "칠해", "무늬", "텍스처"];
const INCREASE = ["두껍", "두툼", "뚱뚱", "통통", "길게", "길쭉", "높게", "높여", "크게", "키워", "넓게", "넓혀", "늘려", "늘여"];
const DECREASE = ["얇", "날씬", "홀쭉", "납작", "짧게", "줄여", "낮게", "낮춰", "작게", "좁게", "좁혀"];
const DEPTH = ["두껍", "두툼", "두께", "뚱뚱", "통통", "얇", "날씬", "홀쭉", "납작"];
const WIDTH = ["옆으로", "가로", "넓", "좁", "폭"];
const HEIGHT = ["길게", "길쭉", "짧게", "높", "낮", "키를", "키가", "세로", "위아래로"];
const UNIFORM = ["크게", "작게", "키워", "줄여", "전체 크기", "크기"];

const has = (text, words) => words.some((w) => text.includes(w));

function partMentioned(text) {
  return PARTS.find((p) => new RegExp(`${p}(?:을|를|이|가|은|는|만|도|쪽|부분|\\s|$)`).test(text)) ?? null;
}

function factorOf(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*배/);
  if (m) return Number(m[1]);
  if (has(text, ["절반", "반으로"])) return 2.0; // 줄이는 방향과 함께 1/2
  if (has(text, ["많이", "훨씬", "아주", "엄청"])) return 1.5;
  if (has(text, ["조금", "살짝", "약간"])) return 1.1;
  return 1.25;
}

const clauses = (text) => text.split(/[,.\n]|그리고|그다음|그 다음|하고 나서/).map((p) => p.trim()).filter(Boolean);

/** planner.py PlanResult의 op 스키마 검사 (factor 범위, k 범위) */
function validOp(op) {
  if ("factor" in op && !(op.factor >= MIN_FACTOR && op.factor <= MAX_FACTOR)) return false;
  if ("k" in op && !(Number.isInteger(op.k) && op.k !== 0 && op.k >= -3 && op.k <= 3)) return false;
  return true;
}

function clause(t) {
  if (has(t, ["반대로", "거꾸로 해", "방금 거 반대"])) return [{ type: "invert_last" }];
  if (has(t, ["세워", "일으켜", "똑바로", "서게"])) return [{ type: "stand_up" }];
  if (has(t, ["반전", "거울", "대칭"]) || (t.includes("뒤집") && has(t, ["좌우", "상하", "위아래", "앞뒤"]))) {
    if (has(t, ["상하", "위아래"])) return [{ type: "mirror", axis: "screen_up" }];
    if (t.includes("앞뒤")) return [{ type: "mirror", axis: "toward_viewer" }];
    return [{ type: "mirror", axis: "screen_right" }];
  }
  if (has(t, ["뒤집", "거꾸로"])) return [{ type: "rotate90", axis: "screen_right", k: 2 }];

  const angle = t.match(/(-?\d+)\s*도/);
  const turning = has(t, ["돌려", "회전", "돌리", "틀어", "숙여", "젖혀"]);
  if (angle || turning) {
    const deg = angle ? parseInt(angle[1], 10) : 90;
    if (deg % 90) {
      return { kind: "refuse", ops: [], reason_code: "angle_not_supported", message: "90도 단위로만 돌릴 수 있어요 (90·180·270도)." };
    }
    let k = ((Math.floor(deg / 90) % 4) + 4) % 4;
    if (k === 0) return { kind: "noop", ops: [], message: "한 바퀴 돌리면 그대로예요." };
    if (k === 3) k = -1; // 270° = 반대 방향 90°
    let axis;
    if (has(t, ["옆모습", "옆으로 돌", "좌우로 돌", "빙글"])) axis = "screen_up";
    else if (has(t, ["앞으로", "숙여"])) axis = "screen_right";
    else if (has(t, ["뒤로", "젖혀"])) [axis, k] = ["screen_right", -k];
    else {
      axis = "toward_viewer";
      if (t.includes("시계") && !has(t, ["반시계", "시계 반대"])) k = -k;
      else if (t.includes("오른쪽으로") && !t.includes("시계")) k = -k;
    }
    return [{ type: "rotate90", axis, k }];
  }
  if (has(t, ["눕혀", "눕게", "넘어뜨려"])) return [{ type: "rotate90", axis: "toward_viewer", k: -1 }];

  let up = has(t, INCREASE);
  const down = has(t, DECREASE);
  if (!(up || down) && /\d+(?:\.\d+)?\s*배/.test(t)) up = true; // "두께 2배로"
  if (up || down) {
    const f = factorOf(t);
    const factor = down && !up ? 1 / f : f;
    if (has(t, DEPTH)) return [{ type: "scale_axis", axis: "toward_viewer", factor }];
    if (has(t, WIDTH)) return [{ type: "scale_axis", axis: "screen_right", factor }];
    if (has(t, HEIGHT)) return [{ type: "scale_axis", axis: "screen_up", factor }];
    if (has(t, UNIFORM)) return [{ type: "scale_uniform", factor }];
  }
  return [];
}

/** 문장 → {kind: ops|refuse|clarify|noop, ops, reason_code?, message, suggested_text?} */
export function planEdit(rawText) {
  const text = rawText.trim();
  if (!text) return { kind: "clarify", ops: [], message: `어떻게 바꿀지 적어 주세요. ${EXAMPLES}` };
  if (has(text, SHAPE_EDIT)) {
    return { kind: "refuse", ops: [], reason_code: "out_of_scope", message: "모양을 더하거나 빼는 편집은 아직 못 해요. 돌리기·크기·반전만 할 수 있어요." };
  }
  if (has(text, COLOR)) return { kind: "refuse", ops: [], reason_code: "out_of_scope", message: "색 바꾸기는 아직 못 해요." };
  const part = partMentioned(text);
  if (part && !text.includes("전체")) {
    return {
      kind: "refuse",
      ops: [],
      reason_code: "part_edit",
      message: `'${part}'만 따로 바꾸는 부분 편집은 아직 못 해요. 전체에 적용할까요?`,
      suggested_text: text.replace(new RegExp(`${part}\\S*\\s*`), "전체를 "),
    };
  }
  if (has(text, ["아까처럼", "아까 같이", "전처럼"])) return { kind: "clarify", ops: [], message: "어느 상태로 돌아갈지 버전 목록에서 골라 주세요." };
  if (has(text, ["되돌려", "취소", "원래대로", "처음으로"])) return { kind: "clarify", ops: [], message: "되돌리기 버튼이나 버전 목록을 써 주세요." };

  const ops = [];
  for (const c of clauses(text)) {
    const res = clause(c);
    if (!Array.isArray(res)) return res;
    ops.push(...res);
  }
  if (!ops.length) return { kind: "clarify", ops: [], message: `무엇을 바꿀지 잘 모르겠어요. ${EXAMPLES}` };
  const kept = ops.slice(0, 4);
  if (!kept.every(validOp)) return { kind: "refuse", ops: [], reason_code: "out_of_range", message: "크기는 한 번에 0.1~10배까지만 바꿀 수 있어요." };
  return { kind: "ops", ops: kept, message: "" };
}
