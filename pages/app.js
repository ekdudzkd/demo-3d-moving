import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { EditSession, HEADING_PANELS, PANEL_NAMES, PANEL_ORDER, createEditCore, headingHalfExtents, headingRotation, viewSpan } from "./edit.js";
import * as P from "./pipeline.js";
import { MODELS, chatWithClaude } from "./llm.js";
import { planEdit } from "./planner.js";
import { hullDepth, predictViews } from "./views.js";
import { openWorld } from "./world/world.js";
import { TEMPLATES, chooseTemplate, estimateJoints, linesOf } from "./rig.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

window.__d2wErrors = [];
function showError(msg) {
  const box = $("#err");
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(showError.t);
  showError.t = setTimeout(() => (box.hidden = true), 7000);
}
window.addEventListener("error", (e) => {
  window.__d2wErrors.push(String(e.message));
  document.body.dataset.errors = window.__d2wErrors.join(" | ");
  showError(`오류: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  window.__d2wErrors.push(String(e.reason));
  document.body.dataset.errors = window.__d2wErrors.join(" | ");
  showError(`오류: ${e.reason?.message || e.reason}`);
});

// samples.json (assets/samples/)
const SAMPLES = [
  { id: "apple", file: "samples/apple.png", name: "사과", description: "단순 원형, 쉬움" },
  { id: "car", file: "samples/car.png", name: "자동차", description: "바퀴·창문 등 여러 부분" },
  { id: "star", file: "samples/star.png", name: "별 캐릭터", description: "뾰족한 모서리" },
];

const OUTCOME_LABEL = {
  USABLE: ["사용 가능", "USABLE"],
  USABLE_WITH_WARNINGS: ["경고 있음 · 사용 가능", "USABLE_WITH_WARNINGS"],
  NOT_USABLE: ["사용 불가", "NOT_USABLE"],
};
const METRIC_LABEL = {
  face_count: "면 수",
  vertex_count: "정점 수",
  connected_components: "연결 조각 수",
  open_boundary_edges: "열린 경계 edge",
  non_manifold_edges: "non-manifold edge",
  duplicate_vertices: "중복 정점",
  degenerate_faces: "면적 0인 면",
  centered: "원점 중앙",
  grounded: "바닥 접지",
  winding_consistent: "면 방향 일관",
};

const state = { busy: false, seed: 0, result: null, view: "world", lastImage: null, lastLabel: "", edit: null };

// 패널 기준표는 백엔드와 같은 파일 (배포 때 backend/app/edit/basis.json을 복사)
const editCorePromise = fetch("basis.json")
  .then((r) => {
    if (!r.ok) throw new Error(`basis.json HTTP ${r.status}`);
    return r.json();
  })
  .then(createEditCore);

// ---------------------------------------------------------------------------
// 단계 표시
// ---------------------------------------------------------------------------
function setStep(step, status) {
  const li = $(`#stepper li[data-step="${step}"]`);
  li.classList.remove("active", "done", "failed");
  if (status) li.classList.add(status);
}
function resetSteps() {
  $$("#stepper li").forEach((li) => li.classList.remove("active", "done", "failed"));
}
const pause = (ms) => new Promise((r) => requestAnimationFrame(() => setTimeout(r, ms)));
function busy(on, text = "") {
  $("#busy").hidden = !on;
  if (text) $("#busyText").textContent = text;
}

// ---------------------------------------------------------------------------
// 입력: 샘플 / 그리기 / 업로드
// ---------------------------------------------------------------------------
function imageToData(src, max = 512) {
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

async function loadSample(sample) {
  const img = new Image();
  img.src = sample.file;
  await img.decode();
  return imageToData(img);
}

const sampleBox = $("#samples");
for (const s of SAMPLES) {
  const b = document.createElement("button");
  b.className = "sample";
  b.dataset.id = s.id;
  b.innerHTML = `<img src="${s.file}" alt="${esc(s.name)} 샘플" loading="eager"><b>${esc(s.name)}</b><small>${esc(s.description)}</small>`;
  b.addEventListener("click", async () => {
    if (state.busy) return;
    selectSample(s.id);
    run(await loadSample(s), `샘플: ${s.name}`);
  });
  sampleBox.append(b);
}
function selectSample(id) {
  $$(".sample").forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
}

$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    $$(".tabpane").forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
  }),
);

// 그리기
const drawCanvas = $("#drawCanvas");
const dctx = drawCanvas.getContext("2d", { willReadFrequently: true });
const COLORS = ["#e4572e", "#f3a712", "#2e86de", "#3bb273", "#8e44ad", "#222222"];
const SIZES = [8, 18, 36];
const pen = { color: COLORS[0], size: SIZES[1], eraser: false, drawn: false, last: null };
function clearDrawing() {
  dctx.fillStyle = "#ffffff";
  dctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  pen.drawn = false;
  $("#drawHint").hidden = false;
}
clearDrawing();
for (const c of COLORS) {
  const b = document.createElement("button");
  b.className = "swatch" + (c === pen.color ? " selected" : "");
  b.style.background = c;
  b.setAttribute("aria-label", `색 ${c}`);
  b.addEventListener("click", () => {
    pen.color = c;
    pen.eraser = false;
    $("#eraser").setAttribute("aria-pressed", "false");
    $$(".swatch").forEach((s) => s.classList.toggle("selected", s === b));
  });
  $("#swatches").append(b);
}
for (const s of SIZES) {
  const b = document.createElement("button");
  b.className = "size" + (s === pen.size ? " selected" : "");
  b.setAttribute("aria-label", `굵기 ${s}`);
  b.innerHTML = `<i style="width:${4 + s / 3}px;height:${4 + s / 3}px"></i>`;
  b.addEventListener("click", () => {
    pen.size = s;
    $$(".size").forEach((x) => x.classList.toggle("selected", x === b));
  });
  $("#sizes").append(b);
}
$("#eraser").addEventListener("click", (e) => {
  pen.eraser = !pen.eraser;
  e.currentTarget.setAttribute("aria-pressed", String(pen.eraser));
});
$("#clearDraw").addEventListener("click", clearDrawing);
function canvasPoint(e) {
  const r = drawCanvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * drawCanvas.width, ((e.clientY - r.top) / r.height) * drawCanvas.height];
}
function stroke(a, b) {
  dctx.strokeStyle = pen.eraser ? "#ffffff" : pen.color;
  dctx.lineWidth = pen.eraser ? pen.size * 1.6 : pen.size;
  dctx.lineCap = "round";
  dctx.lineJoin = "round";
  dctx.beginPath();
  dctx.moveTo(a[0], a[1]);
  dctx.lineTo(b[0], b[1]);
  dctx.stroke();
}
drawCanvas.addEventListener("pointerdown", (e) => {
  drawCanvas.setPointerCapture(e.pointerId);
  pen.last = canvasPoint(e);
  stroke(pen.last, [pen.last[0] + 0.01, pen.last[1]]);
  if (!pen.eraser) {
    pen.drawn = true;
    $("#drawHint").hidden = true;
  }
});
drawCanvas.addEventListener("pointermove", (e) => {
  if (!pen.last) return;
  const p = canvasPoint(e);
  stroke(pen.last, p);
  pen.last = p;
});
["pointerup", "pointercancel", "pointerleave"].forEach((t) => drawCanvas.addEventListener(t, () => (pen.last = null)));
$("#useDrawing").addEventListener("click", () => {
  if (!pen.drawn) return showError("먼저 캔버스에 물체를 하나 그려 주세요.");
  selectSample(null);
  run(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height), "직접 그린 그림");
});

// 업로드
async function useFile(file) {
  if (!file || !file.type.startsWith("image/")) return showError("이미지 파일(PNG·JPG·WebP)을 골라 주세요.");
  const bmp = await createImageBitmap(file);
  selectSample(null);
  run(imageToData(bmp, 768), `업로드: ${file.name}`);
}
$("#file").addEventListener("change", (e) => useFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  useFile(e.dataTransfer.files[0]);
});

$("#rerun").addEventListener("click", () => {
  if (state.lastImage) run(state.lastImage, state.lastLabel);
});

// ---------------------------------------------------------------------------
// 파이프라인 실행
// ---------------------------------------------------------------------------
async function run(imageData, label) {
  if (state.busy) return;
  state.busy = true;
  state.lastImage = imageData;
  state.lastLabel = label;
  state.seed++;
  document.body.dataset.status = "running";
  resetSteps();
  setStep("input", "done");
  stopViews();
  stopEditing();
  disposeGroup(player.tilt);
  player.ready = false;
  $("#genCard").hidden = true;
  $("#qcCard").hidden = true;
  let step = "segment";
  try {
    busy(true, "객체 분할 중… (배경색 기반 전경 추정)");
    setStep("segment", "active");
    await pause(120);
    const seg = P.segment(imageData);
    renderSeg(seg, null);
    setStep("segment", "done");

    if (viewsWanted()) {
      // 3D를 바로 만들지 않고 Claude가 그린 6방향 예상 그림을 먼저 확인·수정한다 (D-031)
      step = "views";
      busy(true, "Claude가 뒤·옆·위 모습을 예상해 그리는 중…");
      setStep("views", "active");
      await startViews(seg, label);
      document.body.dataset.status = "views";
      return;
    }
    await build(seg, label, null, (s) => (step = s));
  } catch (err) {
    fail(step, err);
  } finally {
    busy(false);
    state.busy = false;
  }
}

function fail(step, err) {
  console.error(err);
  setStep(step, "failed");
  showError(err.code ? `[${err.code}] ${err.message}` : `처리 중 오류: ${err.message}`);
  document.body.dataset.status = "error";
}

/** 분할 결과 → 3D 생성·검사·보정 → 6방향 설계도. makeDepth가 있으면 예상 그림 외곽선으로 두께를 정한다 */
async function build(seg, label, makeDepth, onStep) {
  const mode = $("#mode").value;
  const budget = Number($("#budget").value);
  const artifacts = $("#artifacts").checked;
  onStep("generate");
  busy(true, makeDepth ? "예상 그림의 옆·위 외곽선으로 3D를 만드는 중…" : "3D 메시 생성 중… (실루엣 돌출 · 로컬 기하 대체)");
  setStep("generate", "active");
  await pause(160);
  const gen = P.generateMesh(seg, { mode, artifacts, seed: state.seed, makeDepth });
  renderSeg(seg, gen.info.contour);
  renderGen(gen, label);
  setStep("generate", "done");

  onStep("inspect");
  busy(true, "메시 검사·자동 보정 중…");
  setStep("inspect", "active");
  await pause(160);
  const th = { face_budget: budget, target_size: P.TARGET_SIZE };
  const rawReport = P.inspectMesh(gen.mesh, th);
  const repair = P.repairMesh(gen.mesh, budget);
  const repairedReport = P.inspectMesh(repair.mesh, th);
  const collider = P.buildCollider(repair.mesh);
  state.result = { seg, gen, rawReport, repair, repairedReport, collider, label };
  initRig(seg);
  applyObjectTexture(gen.texture);
  renderQC(state.result);
  buildInspectObjects(state.result);
  setStep("inspect", repairedReport.is_usable ? "done" : "failed");

  onStep("blueprint");
  if (!repairedReport.is_usable) {
    // 생성 성공 ≠ 자산 사용 가능: 사용 불가 판정이면 월드에 넣지 않는다
    stopEditing();
    showError("보정 후에도 사용 불가 판정입니다. 월드에 배치하지 않습니다. 다른 그림으로 시도해 주세요.");
    setView("repaired");
  } else {
    // 바로 월드에 넣지 않고 6방향 설계도에서 확인·수정한 뒤 사용자가 배치한다
    setStep("blueprint", "active");
    await pause(120);
    await startEditing(state.result);
    setView("edit");
  }
  document.body.dataset.status = "ready";
}

// ---------------------------------------------------------------------------
// 결과 패널
// ---------------------------------------------------------------------------
function kv(el, rows) {
  el.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
}
const fmt = (n, d = 0) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d });
const yes = (b) => (b ? "예" : "아니오");

function renderSeg(seg, contour) {
  $("#segCard").hidden = false;
  const c = $("#segCanvas");
  const ctx = c.getContext("2d");
  const S = seg.size;
  const img = new ImageData(new Uint8ClampedArray(seg.rgba.data), S, S);
  for (let i = 0; i < S * S; i++) {
    if (!seg.mask[i]) {
      const d = img.data;
      d[i * 4] = d[i * 4] * 0.3 + 20;
      d[i * 4 + 1] = d[i * 4 + 1] * 0.3 + 30;
      d[i * 4 + 2] = d[i * 4 + 2] * 0.3 + 40;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (contour) {
    ctx.strokeStyle = "#e3a14a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    contour.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"]((x + 0.5) * S, (0.5 - y) * S));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const [x, y] of contour) ctx.fillRect((x + 0.5) * S - 2, (0.5 - y) * S - 2, 4, 4);
  }
  kv($("#segInfo"), [
    ["방식", seg.source === "alpha" ? "투명도(alpha)" : "배경색 거리 (Lab ΔE + Otsu)"],
    ["임계값", seg.threshold == null ? "alpha ≥ 128" : seg.threshold_low != null ? `ΔE > ${fmt(seg.threshold, 1)} (연한 부분은 > ${fmt(seg.threshold_low, 1)}까지 확장)` : `ΔE > ${fmt(seg.threshold, 1)}`],
    ["전경 비율", `${fmt(seg.coverage * 100, 1)}%`],
    ["마스크", `${S}×${S} · 구멍 채움 · 최대 조각만`],
    ["시간", `${seg.elapsed_ms} ms`],
    ...seg.warnings.map((w) => ["주의", esc(w)]),
  ]);
}

function renderGen(gen, label) {
  $("#genCard").hidden = false;
  const i = gen.info;
  kv($("#genInfo"), [
    ["입력", esc(label)],
    ["생성기", i.mode === "views" ? "예상 그림 실루엣 교차 (정면 그림 × 옆·위 외곽선)" : i.mode === "inflate" ? "실루엣 부풀리기 (mock 변형)" : "mock · extrude-1 (실루엣 돌출)"],
    ["외곽선", `${i.contour_points}점 (approxPolyDP 0.8px, ${P.WORK}² 작업 해상도)`],
    ["두께", i.mode === "views" ? `점마다 옆·위 외곽선이 겹치는 구간 (두께 비율 ${fmt(state.views.versions[state.views.active].cur.depthRatio, 2)})` : `폭 × ${P.DEPTH_RATIO} = ${fmt(i.depth, 3)}`],
    ["원본 메시", `정점 ${fmt(i.vertex_count)} · 면 ${fmt(i.face_count)}`],
    ["시간", `${i.elapsed_ms} ms`],
  ]);
  $("#injected").innerHTML = i.injected.length
    ? i.injected.map((x) => `<li><em>${x.origin === "mock" ? "Mock과 동일" : "데모 추가"}</em><span>${esc(x.label)}</span></li>`).join("")
    : `<li><em>결함 없음</em><span>결함 섞기를 끈 깨끗한 출력</span></li>`;
}

function outcomeHTML(title, r) {
  const [ko, code] = OUTCOME_LABEL[r.outcome];
  return `<small>${title}</small><b>${ko}</b><span>${code} · 오류 ${r.errors.length} · 경고 ${r.warnings.length}</span>`;
}

function renderQC(res) {
  $("#qcCard").hidden = false;
  const raw = $("#rawOutcome");
  const rep = $("#repOutcome");
  raw.className = `outcome ${res.rawReport.outcome}`;
  rep.className = `outcome ${res.repairedReport.outcome}`;
  raw.innerHTML = outcomeHTML("원본 (raw)", res.rawReport);
  rep.innerHTML = outcomeHTML("보정본 (repaired)", res.repairedReport);

  const diff = P.qualityDiff(res.rawReport, res.repairedReport);
  const show = (v) => (typeof v === "boolean" ? yes(v) : fmt(v));
  $("#diffTable").innerHTML =
    `<thead><tr><th>지표</th><th>원본</th><th>보정본</th></tr></thead><tbody>` +
    diff.map((d) => `<tr><td>${METRIC_LABEL[d.key]}<code>${d.key}</code></td><td>${show(d.raw)}</td><td class="${d.verdict}">${show(d.repaired)}</td></tr>`).join("") +
    `<tr><td>최대 축 길이<code>extents.max</code></td><td>${fmt(Math.max(...res.rawReport.extents), 3)}</td><td>${fmt(Math.max(...res.repairedReport.extents), 3)}</td></tr></tbody>`;

  $("#repairSteps").innerHTML = res.repair.steps
    .map((s) => {
      const cls = s.rolled_back ? "rolled" : s.changed ? "changed" : "";
      const icon = s.rolled_back ? "↺" : s.changed ? "✓" : "–";
      let note = s.rolled_back ? `롤백: ${esc(s.reason)}` : s.changed ? "" : "변화 없음";
      if (s.changed && s.before.face_count !== s.after.face_count) note = `면 ${fmt(s.before.face_count)} → ${fmt(s.after.face_count)}`;
      else if (s.changed) {
        const fixed = s.before.warnings.filter((w) => !s.after.warnings.includes(w));
        note = fixed.length ? `해결: ${fixed.join(", ")}` : "적용";
      }
      return `<li class="${cls}"><span class="dot">${icon}</span><div>${esc(s.label)}<small>${s.name} · ${note}</small></div><span class="ms">${s.elapsed_ms} ms</span></li>`;
    })
    .join("");

  const chips = (r) =>
    r.checks.length
      ? r.checks.map((c) => `<div class="chip ${c.severity}"><b>${c.severity}</b><span>${esc(c.message)} <code>${c.code}${c.value != null ? ` = ${esc(JSON.stringify(c.value))}` : ""}</code></span></div>`).join("")
      : `<div class="chip ok"><b>ok</b><span>검사 항목 모두 통과</span></div>`;
  $("#checks").innerHTML = `<div><h4>원본</h4>${chips(res.rawReport)}</div><div><h4>보정본</h4>${chips(res.repairedReport)}</div>`;

  const col = res.collider;
  kv($("#colliderInfo"), [
    ["형태", col.type === "convex_hull" ? `convex hull (최원점 ${col.points.length}개)` : "bounding box"],
    ["상자 반치수", col.box.half_extents.map((x) => fmt(x, 3)).join(" × ")],
    ["구 반지름", fmt(col.sphere.radius, 3)],
    ["월드 물리", "상자 충돌체(AABB) 사용 · 생성 메시를 그대로 충돌체로 쓰지 않음 (D-009)"],
    ...(col.reason ? [["비고", esc(col.reason)]] : []),
  ]);
}

$("#toWorld").addEventListener("click", () => {
  if (state.edit) placeInWorld();
});

$("#downloadGlb").addEventListener("click", () => {
  if (!state.result) return;
  const mesh = new THREE.Mesh(meshGeometry(state.result.repair.mesh, false), new THREE.MeshStandardMaterial({ map: objectMaterial.map, vertexColors: !objectMaterial.map, roughness: 0.7 }));
  mesh.name = "draw2world_repaired";
  new GLTFExporter().parse(
    mesh,
    (glb) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
      a.download = "draw2world-repaired.glb";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    (e) => showError(`GLB 내보내기 실패: ${e.message || e}`),
    { binary: true },
  );
});

// ---------------------------------------------------------------------------
// three.js 공통
// ---------------------------------------------------------------------------
const viewport = $("#viewport");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
} catch (e) {
  viewport.insertAdjacentHTML("beforeend", `<div class="err">이 브라우저에서 WebGL을 쓸 수 없어 3D 뷰를 표시할 수 없습니다. 분할·검사 결과는 왼쪽 패널에서 볼 수 있습니다.</div>`);
}
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 300);
let controls = null;
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewport.prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 1.2;
  controls.maxDistance = 24;
  new ResizeObserver(resize).observe(viewport);
  resize();
}
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function meshGeometry(mesh, creased = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(mesh.v), 3));
  g.setAttribute("color", new THREE.BufferAttribute(Float32Array.from(mesh.c, toLinear), 3));
  if (mesh.uv) g.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(mesh.uv), 2));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.f), 1));
  if (!creased) {
    g.computeVertexNormals();
    return g;
  }
  return toCreasedNormals(g, Math.PI / 5);
}
const objectMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });

/** 생성 결과의 텍스처(원본 그림)를 공용 재질에 연결한다. 없으면 정점 색으로 돌아간다. */
function applyObjectTexture(texture) {
  if (objectMaterial.map) objectMaterial.map.dispose();
  let map = null;
  if (texture) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = texture.size;
    cv.getContext("2d").putImageData(new ImageData(texture.data, texture.size, texture.size), 0, 0);
    map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  objectMaterial.map = map;
  objectMaterial.vertexColors = !map;
  objectMaterial.needsUpdate = true;
}
const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x25323b, wireframe: true, transparent: true, opacity: 0.35 });

function addLights(scene, shadow) {
  scene.add(new THREE.HemisphereLight(0xfff7e8, 0x6b7a6f, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 5);
  if (shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -9;
    s.right = s.top = 9;
    s.near = 0.5;
    s.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun, sun.target);
  return sun;
}

// ---------------------------------------------------------------------------
// 검사 뷰 (원본 / 보정본)
// ---------------------------------------------------------------------------
const inspectScene = new THREE.Scene();
inspectScene.background = new THREE.Color(0xe7ecea);
addLights(inspectScene, false);
const grid = new THREE.GridHelper(4, 40, 0x8a949a, 0xc9cfcc);
inspectScene.add(grid);
const floorPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4),
  new THREE.MeshBasicMaterial({ color: 0xa36b25, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
);
floorPlane.rotation.x = -Math.PI / 2;
inspectScene.add(floorPlane, new THREE.AxesHelper(0.35));
const inspectObjects = { raw: new THREE.Group(), repaired: new THREE.Group() };
inspectScene.add(inspectObjects.raw, inspectObjects.repaired);

function disposeGroup(g) {
  g.traverse((o) => o.geometry && o.geometry.dispose());
  g.clear();
}

function colliderHelpers(col) {
  const group = new THREE.Group();
  const [hx, hy, hz] = col.box.half_extents;
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)),
    new THREE.LineBasicMaterial({ color: 0xe4572e }),
  );
  box.position.fromArray(col.box.center);
  group.add(box);
  if (col.points && col.points.length >= 4) {
    try {
      const hull = new THREE.Mesh(
        new ConvexGeometry(col.points.map((p) => new THREE.Vector3(...p))),
        new THREE.MeshBasicMaterial({ color: 0x2e86de, wireframe: true, transparent: true, opacity: 0.5 }),
      );
      group.add(hull);
    } catch {
      /* hull 실패 시 상자만 표시 */
    }
  }
  group.name = "collider";
  return group;
}

function buildInspectObjects(res) {
  for (const [key, mesh] of [["raw", res.gen.mesh], ["repaired", res.repair.mesh]]) {
    const g = inspectObjects[key];
    disposeGroup(g);
    const geom = meshGeometry(mesh);
    const solid = new THREE.Mesh(geom, objectMaterial);
    const wire = new THREE.Mesh(geom, wireMaterial);
    wire.name = "wire";
    g.add(solid, wire);
    if (key === "repaired") g.add(colliderHelpers(res.collider));
  }
  applyViewOptions();
}

// ---------------------------------------------------------------------------
// 월드
// ---------------------------------------------------------------------------
const WORLD_SCALE = 1.3;
const LIMIT = 18;
const worldScene = new THREE.Scene();
worldScene.background = new THREE.Color(0xbfe0e6);
worldScene.fog = new THREE.Fog(0xbfe0e6, 22, 48);
const sun = addLights(worldScene, true);

function groundTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#cfe0b6";
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#c3d7a8";
  x.fillRect(0, 0, 128, 128);
  x.fillRect(128, 128, 128, 128);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(80,110,60,${Math.random() * 0.12})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.anisotropy = 4;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(LIMIT * 2 + 8, LIMIT * 2 + 8), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
worldScene.add(ground);
const fence = new THREE.Mesh(
  new THREE.RingGeometry(LIMIT + 0.6, LIMIT + 0.9, 4, 1),
  new THREE.MeshBasicMaterial({ color: 0xa36b25, transparent: true, opacity: 0.5 }),
);
fence.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
fence.position.y = 0.01;
worldScene.add(fence);

const obstacles = [];
const clickable = [ground];
function addBlock(x, z, w, h, d, color, y0 = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.position.set(x, y0 + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  worldScene.add(m);
  obstacles.push({ min: [x - w / 2, y0, z - d / 2], max: [x + w / 2, y0 + h, z + d / 2] });
  clickable.push(m);
  return m;
}
function addTree(x, z, s = 1) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1 * s, 8), new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 1 }));
  trunk.position.set(x, 0.5 * s, z);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.85 * s, 1.9 * s, 9), new THREE.MeshStandardMaterial({ color: 0x4f8f4a, roughness: 0.9 }));
  leaves.position.set(x, 1.75 * s, z);
  trunk.castShadow = leaves.castShadow = true;
  worldScene.add(trunk, leaves);
  obstacles.push({ min: [x - 0.3 * s, 0, z - 0.3 * s], max: [x + 0.3 * s, 2.7 * s, z + 0.3 * s] });
}
// 계단식 단상 (점프로 올라갈 수 있음)
addBlock(-6, -5, 4, 0.5, 3, 0xd9cdb4);
addBlock(-6.6, -5.4, 2, 0.5, 1.6, 0xcbbd9f, 0.5);
// 상자
addBlock(5, -4, 1.1, 1.1, 1.1, 0xc8955a);
addBlock(6.2, -4.3, 1.1, 1.1, 1.1, 0xb98448);
addBlock(5.6, -4.1, 1.1, 1.1, 1.1, 0xd4a46a, 1.1);
addBlock(7, 5, 1.4, 0.8, 1.4, 0x9fb7c4);
addBlock(-4, 6, 2.6, 0.35, 2.6, 0xe3d6bd);
[[-10, -9, 1.2], [11, -10, 1.4], [-12, 7, 1.1], [10, 9, 1.3], [0, -12, 1], [-15, -1, 1.2], [14, 1, 1.1], [3, 13, 1.3]].forEach(([x, z, s]) => addTree(x, z, s));

const gemGeometry = new THREE.OctahedronGeometry(0.24);
const gemMaterial = new THREE.MeshStandardMaterial({ color: 0xffc53d, emissive: 0xa36b25, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.4 });
const GEM_SPOTS = [[3, 2.5, 0.6], [-3, 3, 0.6], [-6, -5, 1.6], [-6.6, -5.4, 2.1], [5.6, -4.1, 2.8], [7, 5, 1.4], [-4, 6, 0.95], [0, 6, 0.6], [9, -1, 0.6]];
const gems = GEM_SPOTS.map(([x, z, y]) => {
  const g = new THREE.Mesh(gemGeometry, gemMaterial);
  g.position.set(x, y, z);
  g.castShadow = true;
  g.userData.base = y;
  worldScene.add(g);
  return g;
});
let score = 0;
function resetGems() {
  score = 0;
  gems.forEach((g) => (g.visible = true));
  updateScore();
}
function updateScore() {
  $("#score").textContent = state.view === "world" && player.ready ? `보석 ${score} / ${gems.length}` : "";
}

const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 32), new THREE.MeshBasicMaterial({ color: 0xa36b25, transparent: true, opacity: 0.9, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
worldScene.add(marker);

const player = {
  ready: false,
  root: new THREE.Group(),
  tilt: new THREE.Group(),
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0,
  half: [0.5, 0.5, 0.5],
  height: 1,
  onGround: false,
  squash: 0,
  target: null,
  phase: 0,
  collider: null,
};
player.root.add(player.tilt);
worldScene.add(player.root);

/** 월드에 자산을 둔다. 앞쪽 패널이 로컬 +X(진행 방향)를 보게 돌린다. respawn=false면 위치·보석은 그대로. */
function spawnPlayer(meshData, collider, heading, respawnPlayer = true) {
  disposeGroup(player.tilt);
  const geom = meshGeometry(meshData);
  const mesh = new THREE.Mesh(geom, objectMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const wire = new THREE.Mesh(geom, wireMaterial);
  wire.name = "wire";
  const col = colliderHelpers({ ...collider, points: null });
  const model = new THREE.Group();
  const theta = headingRotation(state.edit.core.panels, heading);
  model.rotation.y = theta;
  model.add(mesh, wire, col);
  player.tilt.add(model);
  player.tilt.scale.setScalar(WORLD_SCALE);
  const [hx, hy, hz] = collider.box.half_extents;
  const [ax, az] = headingHalfExtents([hx, hy, hz], theta);
  player.half = [ax * WORLD_SCALE, hy * WORLD_SCALE, az * WORLD_SCALE];
  player.height = hy * 2 * WORLD_SCALE;
  player.ready = true;
  if (respawnPlayer) {
    respawn();
    resetGems();
  } else {
    // 크기가 바뀌었을 수 있으니 살짝 띄워 다시 착지시킨다
    player.pos.y += 0.6;
    player.onGround = false;
  }
  applyViewOptions();
}
function respawn() {
  player.pos.set(0, 6, 0);
  player.vel.set(0, 0, 0);
  player.yaw = -Math.PI / 2; // 앞쪽이 카메라(+z)를 보게 떨어진다
  player.target = null;
  player.onGround = false;
  marker.visible = false;
  if (state.view === "world") frameWorldCamera(true);
}

const keys = new Set();
const KEYMAP = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
window.addEventListener("keydown", (e) => {
  if (state.view !== "world" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
  if (KEYMAP[e.code]) {
    keys.add(KEYMAP[e.code]);
    player.target = null;
    marker.visible = false;
    e.preventDefault();
  } else if (e.code === "Space") {
    jump();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => KEYMAP[e.code] && keys.delete(KEYMAP[e.code]));
window.addEventListener("blur", () => keys.clear());
function jump() {
  if (player.ready && player.onGround) {
    player.vel.y = 7.6;
    player.onGround = false;
  }
}
$("#jumpBtn").addEventListener("click", jump);
$("#resetBtn").addEventListener("click", () => {
  if (player.ready) {
    respawn();
    resetGems();
  }
});

// 클릭/탭으로 이동 (드래그는 시점 회전)
const raycaster = new THREE.Raycaster();
let down = null;
if (renderer) {
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || state.view !== "world" || !player.ready) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 400;
    down = null;
    if (moved > 8 || !quick) return;
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects(clickable, false)[0];
    if (!hit) return;
    player.target = new THREE.Vector3(THREE.MathUtils.clamp(hit.point.x, -LIMIT, LIMIT), 0, THREE.MathUtils.clamp(hit.point.z, -LIMIT, LIMIT));
    marker.position.set(player.target.x, hit.point.y + 0.02, player.target.z);
    marker.visible = true;
  });
}

function footprint() {
  const c = Math.abs(Math.cos(player.yaw));
  const s = Math.abs(Math.sin(player.yaw));
  return [c * player.half[0] + s * player.half[2], s * player.half[0] + c * player.half[2]];
}
const overlapsY = (o, y) => y < o.max[1] - 0.02 && y + player.height > o.min[1] + 0.02;
const overlapsXZ = (o, x, z, ax, az) => x + ax > o.min[0] && x - ax < o.max[0] && z + az > o.min[2] && z - az < o.max[2];

function stepPlayer(dt) {
  const p = player;
  // 입력 방향 (카메라 기준)
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const dir = new THREE.Vector3();
  if (keys.has("f")) dir.add(fwd);
  if (keys.has("b")) dir.sub(fwd);
  if (keys.has("r")) dir.add(right);
  if (keys.has("l")) dir.sub(right);
  if (!dir.lengthSq() && p.target) {
    dir.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
    if (dir.length() < 0.15) {
      p.target = null;
      marker.visible = false;
      dir.set(0, 0, 0);
    }
  }
  const moving = dir.lengthSq() > 0;
  if (moving) dir.normalize();
  const speed = 4.4;
  const k = Math.min(1, dt * (p.onGround ? 12 : 4));
  p.vel.x += (dir.x * speed - p.vel.x) * k;
  p.vel.z += (dir.z * speed - p.vel.z) * k;
  p.vel.y -= 22 * dt;

  if (moving) {
    // 로컬 +X(그림의 오른쪽)가 진행 방향을 보게 회전
    const want = Math.atan2(-dir.z, dir.x);
    let d = want - p.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yaw += d * Math.min(1, dt * 10);
  }
  let [ax, az] = footprint();

  // x
  p.pos.x += p.vel.x * dt;
  for (const o of obstacles) {
    if (overlapsY(o, p.pos.y) && overlapsXZ(o, p.pos.x, p.pos.z, ax, az)) {
      p.pos.x = p.pos.x < (o.min[0] + o.max[0]) / 2 ? o.min[0] - ax - 1e-3 : o.max[0] + ax + 1e-3;
      p.vel.x = 0;
    }
  }
  // z
  p.pos.z += p.vel.z * dt;
  for (const o of obstacles) {
    if (overlapsY(o, p.pos.y) && overlapsXZ(o, p.pos.x, p.pos.z, ax, az)) {
      p.pos.z = p.pos.z < (o.min[2] + o.max[2]) / 2 ? o.min[2] - az - 1e-3 : o.max[2] + az + 1e-3;
      p.vel.z = 0;
    }
  }
  p.pos.x = THREE.MathUtils.clamp(p.pos.x, -LIMIT + ax, LIMIT - ax);
  p.pos.z = THREE.MathUtils.clamp(p.pos.z, -LIMIT + az, LIMIT - az);

  // y
  const prevY = p.pos.y;
  const vy = p.vel.y;
  p.pos.y += p.vel.y * dt;
  let landed = false;
  if (p.pos.y <= 0) {
    p.pos.y = 0;
    landed = true;
  }
  for (const o of obstacles) {
    if (!overlapsXZ(o, p.pos.x, p.pos.z, ax - 0.02, az - 0.02)) continue;
    if (vy <= 0 && prevY >= o.max[1] - 0.06 && p.pos.y < o.max[1]) {
      p.pos.y = o.max[1];
      landed = true;
    } else if (vy > 0 && prevY + p.height <= o.min[1] + 0.02 && p.pos.y + p.height > o.min[1]) {
      p.pos.y = o.min[1] - p.height;
      p.vel.y = 0;
    }
  }
  if (landed) {
    if (!p.onGround && vy < -5) p.squash = Math.min(0.32, -vy * 0.025);
    p.vel.y = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  // 보석
  for (const g of gems) {
    if (!g.visible) continue;
    const dxz = Math.hypot(g.position.x - p.pos.x, g.position.z - p.pos.z);
    const dy = g.position.y - (p.pos.y + p.height / 2);
    if (dxz < Math.max(ax, az) + 0.35 && Math.abs(dy) < p.height / 2 + 0.45) {
      g.visible = false;
      score++;
      updateScore();
      if (score === gems.length) {
        toast("보석을 모두 모았어요!");
        setTimeout(resetGems, 2500);
      }
    }
  }

  // 표시: 이동 중 통통 튀고 앞으로 살짝 기울기, 착지 시 찌그러짐
  const horiz = Math.hypot(p.vel.x, p.vel.z) / speed;
  p.phase += dt * 13 * horiz;
  const bob = p.onGround ? Math.abs(Math.sin(p.phase)) * 0.09 * horiz : 0;
  p.root.position.set(p.pos.x, p.pos.y, p.pos.z);
  p.root.rotation.y = p.yaw;
  p.tilt.position.y = bob;
  p.tilt.rotation.z = THREE.MathUtils.lerp(p.tilt.rotation.z, -0.12 * horiz, Math.min(1, dt * 8));
  p.squash *= Math.exp(-dt * 9);
  const s = WORLD_SCALE;
  p.tilt.scale.set(s * (1 + p.squash * 0.5), s * (1 - p.squash), s * (1 + p.squash * 0.5));
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  viewport.append(t);
  setTimeout(() => t.remove(), 2300);
}

// ---------------------------------------------------------------------------
// 뷰 전환·카메라
// ---------------------------------------------------------------------------
const HELP = {
  world: "WASD·방향키 이동 · Space 점프 · 바닥 클릭/탭으로 이동 · 드래그로 시점 회전",
  raw: "생성 직후 메시: 바닥 아래로 내려가 있고, 떠 있는 조각·뒤집힌 면(구멍처럼 보임)이 섞여 있습니다",
  repaired: "보정 후: 최대 축 1m, 원점 중앙, 바닥(y=0)에 놓임 · 빨간 상자/파란 망 = 충돌체",
};
function setView(v) {
  if (v === "edit" && !state.edit) v = "world";
  if (v === "views" && !state.views) v = "world";
  if (v === "rig" && !state.rig) v = "world";
  state.view = v;
  $$(".vt").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#pad").hidden = v !== "world" || !player.ready;
  $("#editGrid").hidden = v !== "edit";
  $("#viewsGrid").hidden = v !== "views";
  $("#rigPane").hidden = v !== "rig";
  $("#hud").hidden = v === "edit" || v === "views" || v === "rig"; // 패널 머리글과 겹치므로 설계도에서는 숨긴다 (안내는 왼쪽 카드)
  const waiting = state.edit && !state.edit.placed ? "6방향 설계도를 확인하고 '이 모양으로 월드에 배치'를 누르면 여기에 등장합니다" : "그림을 변환하면 여기에 등장합니다";
  $("#help").textContent = v === "world" && !player.ready ? waiting : (HELP[v] ?? "");
  inspectObjects.raw.visible = v === "raw";
  inspectObjects.repaired.visible = v === "repaired";
  const r = state.result;
  const rep = r && (v === "raw" ? r.rawReport : r.repairedReport);
  $("#legend").textContent = rep ? `${v === "raw" ? "원본" : "보정본"} · 정점 ${fmt(rep.vertex_count)} · 면 ${fmt(rep.face_count)}` : "";
  if (v === "world" && r && player.ready) $("#legend").textContent = `월드 배율 ×${WORLD_SCALE} · 충돌체: 상자 · 편집 e${state.edit.session.active} · 앞쪽 ${PANEL_NAMES[state.edit.heading]}`;
  if (v === "edit") $("#legend").textContent = `설계도(정사영, 패널마다 고정 범위 ${state.edit.span.toFixed(2)} m) · 현재 e${state.edit.session.active}`;
  if (v === "views") {
    $("#legend").textContent = `Claude 예상 그림 v${state.views.active} · 크기는 최대 변 1 m 기준`;
    renderViews();
  }
  if (v === "rig") {
    $("#legend").textContent = "관절: 점을 끌어서 그림에 맞추면 월드에서 팔다리가 움직여요";
    renderRig();
  }
  if (!controls) return;
  controls.enabled = v !== "edit" && v !== "views" && v !== "rig";
  if (v === "world") {
    controls.autoRotate = false;
    frameWorldCamera(true);
  } else if (v !== "edit" && v !== "views" && v !== "rig") {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;
    frameInspect(inspectObjects[v]);
  }
  updateScore();
}
$$(".vt").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

function frameInspect(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  box.expandByPoint(new THREE.Vector3(0, 0, 0));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  camera.position.set(c.x + size * 0.7, c.y + size * 0.55, c.z + size * 1.15);
  controls.minDistance = 0.4;
  controls.update();
}
function playerFocus() {
  return new THREE.Vector3(player.pos.x, player.pos.y + player.height * 0.5, player.pos.z);
}
function frameWorldCamera(reset) {
  if (!controls) return;
  controls.minDistance = 2;
  const focus = player.ready ? playerFocus() : new THREE.Vector3(0, 0.5, 0);
  if (reset) {
    controls.target.copy(focus);
    camera.position.set(focus.x + 3.5, focus.y + 3.2, focus.z + 6.5);
  }
  controls.update();
}

function applyViewOptions() {
  const wire = $("#wire").checked;
  const col = $("#showCollider").checked;
  for (const g of [inspectObjects.raw, inspectObjects.repaired, player.tilt]) {
    g.traverse((o) => {
      if (o.name === "wire") o.visible = wire;
      if (o.name === "collider") o.visible = col || g === inspectObjects.repaired;
    });
  }
  player.tilt.traverse((o) => o.name === "collider" && (o.visible = col));
}
$("#wire").addEventListener("change", applyViewOptions);
$("#showCollider").addEventListener("change", applyViewOptions);

// ---------------------------------------------------------------------------
// 6방향 보기·편집 (edit.js 코어 + planner.js Mock 규칙, 버전은 브라우저 메모리)
// ---------------------------------------------------------------------------
const QUICK_PROMPTS = ["가장자리 둥글게", "볼록하게", "위로 갈수록 얇게", "평평하게", "세워줘", "더 두껍게", "더 얇게", "시계방향으로 90도 돌려", "좌우 반전", "반대로"];
const LABEL_HINTS = {
  front: "물체를 앞에서 본 그림",
  back: "물체를 뒤에서 본 그림",
  left: "앞에서 볼 때 왼쪽 옆면",
  right: "앞에서 볼 때 오른쪽 옆면",
  top: "위에서 내려다본 그림 (실험 기능)",
  bottom: "아래에서 올려다본 그림 (실험 기능)",
};
const KIND_LABEL = { base: "기본", edit: "편집", undo: "되돌리기", revert: "복귀" };

const editScene = new THREE.Scene();
editScene.background = new THREE.Color(0xfaf8f3);
editScene.add(new THREE.HemisphereLight(0xffffff, 0xb8a98f, 1.3));
const editKey = new THREE.DirectionalLight(0xffffff, 1.4);
editKey.position.set(3, 5, 2);
const editFill = new THREE.DirectionalLight(0xffffff, 0.6);
editFill.position.set(-3, -2, -2);
editScene.add(editKey, editFill);
const editObjects = new THREE.Group();
editScene.add(editObjects);
const editCamera = new THREE.OrthographicCamera();
const panelCells = {};

for (const panel of PANEL_ORDER) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "pcell";
  cell.setAttribute("role", "radio");
  cell.dataset.panel = panel;
  cell.setAttribute("aria-label", `${PANEL_NAMES[panel]} 패널`);
  cell.innerHTML = `<div class="ph"><b>${PANEL_NAMES[panel]}</b><em hidden>입력 그림</em><i hidden>앞(W)</i><small></small></div><div class="pv"></div>`;
  cell.addEventListener("click", () => selectPanel(panel));
  $("#editGrid").append(cell);
  panelCells[panel] = cell;
}

function selectPanel(panel) {
  if (!state.edit) return;
  state.edit.panel = panel;
  for (const [p, cell] of Object.entries(panelCells)) cell.setAttribute("aria-checked", String(p === panel));
  $("#editPanelName").textContent = `· ${PANEL_NAMES[panel]} 패널 기준`;
  $("#editText").placeholder = `${PANEL_NAMES[panel]} 화면 기준으로 말해 주세요`;
}

for (const q of QUICK_PROMPTS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = q;
  b.addEventListener("click", () => sendEdit(q));
  $("#editChips").append(b);
}

/** 채팅 한 줄. user가 아닌 말은 Claude에 보낼 대화 이력에서 assistant 쪽으로 남긴다 */
function say(text, tone = "", suggested = null) {
  state.edit?.history.push({ role: tone === "user" ? "user" : "assistant", text });
  state.worldHost?.say(text, tone, suggested);
  const m = document.createElement("div");
  m.className = `msg ${tone}`;
  m.textContent = text;
  if (suggested) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `"${suggested}"로 고쳐 쓰기`;
    b.addEventListener("click", () => {
      $("#editText").value = suggested;
      $("#editText").focus();
    });
    m.append(b);
  }
  $("#editChat").append(m);
  $("#editChat").scrollTop = $("#editChat").scrollHeight;
}

function versionText(v) {
  if (v.kind === "base") return `입력 그림 기준 (${v.intent.label})`;
  if (v.kind === "undo") return `e${v.intent.undo_of} 되돌림 → e${v.intent.to} 상태`;
  if (v.kind === "revert") return `e${v.intent.revert_to} 상태로 복귀`;
  return v.intent.text || `${v.intent.screen_ops?.length ?? 0}개 op`;
}

function stopEditing() {
  state.worldHost?.close();
  state.edit = null;
  syncEnterWorld();
  $("#editCard").hidden = true;
  clearEditObjects();
  if (state.view === "edit") setView("world");
}

function clearEditObjects() {
  // 격자·점선 상자 재질은 갱신마다 새로 만들므로 함께 해제한다 (메시 재질은 공용)
  editObjects.traverse((o) => o.material && o.material !== objectMaterial && o.material.dispose());
  disposeGroup(editObjects);
}

/** 보정 메시를 v0으로 e0을 만든다. 월드 배치는 사용자가 설계도를 확인한 뒤 placeInWorld로 한다. */
async function startEditing(res) {
  const core = await editCorePromise.catch((e) => {
    throw new Error(`편집 기준표(basis.json)를 불러오지 못했습니다: ${e.message}`);
  });
  const label = $("#viewLabel").value || "front";
  const session = new EditSession(core, res.repair.mesh, label, { faceBudget: Number($("#budget").value) });
  state.edit = { core, session, panel: label, heading: $("#heading").value || "front", placed: false, history: [], thinking: false };
  disposeGroup(player.tilt);
  player.ready = false;
  setStep("world", "");
  $("#editChat").replaceChildren();
  $("#editCard").hidden = false;
  $("#editToWorld").textContent = "이 모양으로 월드에 배치 →";
  for (const [p, cell] of Object.entries(panelCells)) cell.querySelector("em").hidden = p !== label;
  selectPanel(label);
  refreshEdit();
}

/** 설계도 확인 끝: 활성 버전을 고른 앞쪽으로 월드에 놓는다 */
function placeInWorld() {
  const ed = state.edit;
  const active = ed.session.activeVersion;
  ed.placed = true;
  spawnPlayer(active.mesh, active.collider, ed.heading, true);
  setStep("blueprint", "done");
  setStep("world", "done");
  $("#editToWorld").textContent = "월드에서 보기 →";
  setView("world");
  $("#viewport").scrollIntoView({ behavior: "smooth", block: "center" });
}

/** 버전 목록·6패널 장면·월드 자산을 활성 버전으로 맞춘다 */
function refreshEdit() {
  const { session } = state.edit;
  const active = session.activeVersion;
  const e0 = session.versions[0];
  $("#editCard").dataset.active = `e${session.active}`;
  $("#editUndo").disabled = !session.canUndo;
  $("#editVersions").replaceChildren(
    ...[...session.versions].reverse().map((v) => {
      const li = document.createElement("li");
      li.className = v.version === session.active ? "active" : "";
      li.innerHTML = `<b>e${v.version}</b><em>${KIND_LABEL[v.kind]}</em><span class="vtext"></span>${v.status === "failed" ? `<em class="failed">실패</em>` : ""}`;
      li.querySelector(".vtext").textContent = versionText(v);
      li.querySelector(".vtext").title = versionText(v);
      if (v.status === "ready" && v.version !== session.active) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "이 버전으로";
        b.addEventListener("click", () => editAction(() => session.revert(v.version), `e${v.version}로 복귀`));
        li.append(b);
      }
      return li;
    }),
  );

  clearEditObjects();
  const span = viewSpan(e0.bounds, active.bounds);
  state.edit.span = span;
  // 설계도 치수: 패널마다 화면 가로·세로에 해당하는 실제 크기
  const size = [0, 1, 2].map((k) => active.bounds[1][k] - active.bounds[0][k]);
  const dim = (vec) => size[vec.findIndex((x) => x !== 0)];
  for (const [p, cell] of Object.entries(panelCells)) {
    const axes = state.edit.core.panels[p];
    cell.querySelector("small").textContent = `${dim(axes.screen_right).toFixed(2)} × ${dim(axes.screen_up).toFixed(2)} m`;
    cell.querySelector("i").hidden = p !== state.edit.heading;
  }
  editObjects.add(new THREE.GridHelper(span * 4, 40, 0xc9b79a, 0xe4ddd0));
  editObjects.add(new THREE.Mesh(meshGeometry(active.mesh), objectMaterial));
  const [lo, hi] = e0.bounds;
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])),
    new THREE.LineDashedMaterial({ color: 0xa36b25, dashSize: span * 0.02, gapSize: span * 0.014 }),
  );
  box.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  box.computeLineDistances();
  editObjects.add(box);

  if (state.edit.placed) spawnPlayer(active.mesh, active.collider, state.edit.heading, false);
  if (state.view === "edit" || state.view === "world") setView(state.view);
  state.worldHost?.refreshModel(); // 전체화면 월드가 열려 있으면 그 안의 말도 새 버전으로 바꾼다
  syncEnterWorld();
}

function editAction(fn, label) {
  try {
    const v = fn();
    reportVersion(v, label);
  } catch (e) {
    say(e.message, "warn");
  }
  refreshEdit();
}

function reportVersion(v, label) {
  if (v.status === "failed") say(`${label}: e${v.version} 실패 (${v.error}). 이전 상태를 그대로 쓰고 있어요.`, "error");
  else say(`${label}: e${v.version} 적용 완료${v.qc.warnings.length ? ` (경고: ${v.qc.warnings.join(", ")})` : ""}`, "ok");
}

function sendEdit(text) {
  const ed = state.edit;
  if (!ed || !text.trim() || ed.thinking) return;
  if ($("#planner").value === "claude") return sendToClaude(text);
  say(`[${PANEL_NAMES[ed.panel]}] ${text}`, "user");
  const plan = planEdit(text);
  if (plan.kind !== "ops") {
    say(plan.message, plan.kind === "refuse" ? "warn" : "", plan.suggested_text ?? null);
    return;
  }
  $("#editText").value = "";
  applyPlan(plan.ops, text, "mock");
}

/** 화면 op를 편집 버전으로 적용하고 결과를 채팅에 남긴다 (Mock·Claude 공용) */
function applyPlan(ops, text, planner) {
  const res = state.edit.session.edit(ops, state.edit.panel, { text, planner, screen_ops: ops });
  if (!res.version) {
    say(res.message, res.kind === "refuse" ? "warn" : "");
    return;
  }
  reportVersion(res.version, "편집");
  for (const note of res.notes) say(note);
  refreshEdit();
}

async function sendToClaude(text) {
  const ed = state.edit;
  const apiKey = $("#apiKey").value.trim();
  if (!apiKey) {
    say("Claude와 대화하려면 위에 Anthropic API 키를 넣어 주세요. 키 없이 쓰려면 대화 상대를 'Mock 규칙'으로 바꾸세요.", "warn");
    $("#apiKey").focus();
    return;
  }
  const history = ed.history.slice();
  say(`[${PANEL_NAMES[ed.panel]}] ${text}`, "user");
  $("#editText").value = "";
  const active = ed.session.activeVersion;
  const size = [0, 1, 2].map((k) => +(active.bounds[1][k] - active.bounds[0][k]).toFixed(3));
  const st = {
    panel: ed.panel,
    size_m: { x: size[0], y: size[1], z: size[2] },
    edits: active.ops.filter((o) => o.op !== "label"),
    version: `e${active.version}`,
  };
  const thinking = document.createElement("div");
  thinking.className = "msg thinking";
  thinking.textContent = "Claude가 생각하는 중…";
  $("#editChat").append(thinking);
  $("#editChat").scrollTop = $("#editChat").scrollHeight;
  ed.thinking = true;
  $("#editCard").dataset.thinking = "true";
  try {
    const model = $("#model").value;
    const r = await chatWithClaude({ apiKey, model, history, text: `[${ed.panel} 패널] ${text}`, state: st });
    thinking.remove();
    if (state.edit !== ed) return; // 그 사이 다른 그림으로 바뀜
    say(r.reply || "(답 없음)", r.kind === "refuse" ? "warn" : "");
    if (r.kind === "ops") applyPlan(r.ops, text, `claude:${model}`);
  } catch (e) {
    thinking.remove();
    say(e.message, "error");
  } finally {
    ed.thinking = false;
    delete $("#editCard").dataset.thinking;
  }
}

$("#editForm").addEventListener("submit", (e) => {
  e.preventDefault();
  sendEdit($("#editText").value);
});
$("#editUndo").addEventListener("click", () => state.edit && editAction(() => state.edit.session.undo(), "되돌리기"));

// ---------------------------------------------------------------------------
// 관절(뼈대): 분할된 그림 위에 관절을 자동으로 찍고 끌어서 고친다. 월드의 말은 이 관절로 팔다리를 움직인다 (rig.js, world/skin.js)
// ---------------------------------------------------------------------------
const RIG_HINT = {
  human: "점을 끌어서 그림에 맞춰 주세요 · 월드에서 걷거나 100m를 달릴 때 팔다리가 움직여요",
  quad: "옆모습 네발 동물용이에요 · 앞다리 둘·뒷다리 둘을 끌어서 맞춰 주세요",
  none: "관절 없이 지금처럼 몸 전체가 통통 튀며 움직여요",
};
let rigCut = null; // 배경을 지운 그림(정사각형)
let rigDrag = null;
let rigHover = null;
function initRig(seg) {
  const tid = chooseTemplate(seg.mask, seg.size);
  state.rig = { templateId: tid, joints: {}, seg };
  if (tid !== "none") state.rig.joints[tid] = estimateJoints(seg.mask, seg.size, tid);
  rigCut = null;
  if (state.view === "rig") renderRig();
}
function rigForWorld() {
  const r = state.rig;
  if (!r || r.templateId === "none" || !r.joints[r.templateId]) return null;
  return { templateId: r.templateId, joints: r.joints[r.templateId], mask: r.seg.mask, S: r.seg.size };
}
function rigChanged() {
  const host = state.worldHost;
  if (host && !host.active) host.refreshModel();
}
function setRigTemplate(tid) {
  const r = state.rig;
  if (!r) return;
  r.templateId = tid;
  if (tid !== "none" && !r.joints[tid]) r.joints[tid] = estimateJoints(r.seg.mask, r.seg.size, tid);
  // 옆모습 네발 동물은 머리 쪽 옆면이 앞(W)이어야 다리가 그림 평면 안에서 자연스럽게 움직인다
  if (tid === "quad" && state.edit && state.edit.heading === "front") {
    const J = r.joints.quad;
    const side = J.head[0] >= J.pelvis[0] ? "right" : "left";
    const sel = $("#heading");
    if ([...sel.options].some((o) => o.value === side)) {
      sel.value = side;
      sel.dispatchEvent(new Event("change"));
    }
  }
  renderRig();
  rigChanged();
}
function rigLayout() {
  const r = state.rig;
  const cv = $("#rigCanvas");
  const box = cv.getBoundingClientRect();
  const S = r.seg.size;
  let x0 = S;
  let x1 = 0;
  let y0 = S;
  let y1 = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (r.seg.mask[y * S + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const pad = 0.08;
  const bw = (x1 - x0 + 1) / S;
  const bh = (y1 - y0 + 1) / S;
  const k = Math.min((box.width - 40) / (bw * (1 + 2 * pad)), (box.height - 30) / (bh * (1 + 2 * pad)));
  const ox = box.width / 2 - ((x0 / S + bw / 2) * k);
  const oy = box.height / 2 - ((y0 / S + bh / 2) * k);
  return { box, k, ox, oy, toScreen: ([ix, iy]) => [ox + ix * k, oy + iy * k], toImage: (sx, sy) => [(sx - ox) / k, (sy - oy) / k] };
}
function renderRig() {
  const r = state.rig;
  if (!r || state.view !== "rig") return;
  $$("#rigPane [data-tpl]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.tpl === r.templateId)));
  $("#rigAuto").disabled = r.templateId === "none";
  $("#rigHint").textContent = RIG_HINT[r.templateId];
  const S = r.seg.size;
  if (!rigCut) {
    rigCut = document.createElement("canvas");
    rigCut.width = rigCut.height = S;
    const g = rigCut.getContext("2d");
    const img = new ImageData(new Uint8ClampedArray(r.seg.rgba.data), S, S);
    for (let i = 0; i < S * S; i++) img.data[i * 4 + 3] = r.seg.mask[i] ? 255 : 0;
    g.putImageData(img, 0, 0);
  }
  const cv = $("#rigCanvas");
  const L = rigLayout();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(L.box.width * dpr));
  cv.height = Math.max(1, Math.round(L.box.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, L.box.width, L.box.height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, L.box.width, L.box.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(rigCut, L.ox, L.oy, L.k, L.k);
  if (r.templateId === "none") return;
  const tpl = TEMPLATES[r.templateId];
  const J = r.joints[r.templateId];
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(37,50,59,.55)";
  for (const [a, b] of linesOf(tpl)) {
    const [ax, ay] = L.toScreen(J[a]);
    const [bx, by] = L.toScreen(J[b]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.font = "600 12px system-ui, sans-serif";
  for (const name of tpl.joints) {
    const [x, y] = L.toScreen(J[name]);
    const on = rigDrag?.name === name || rigHover === name;
    ctx.beginPath();
    ctx.arc(x, y, on ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#ffb020" : "#d9434f";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    const side = /^(sL|eL|hL|hipL|kL|fL)$/.test(name) ? " (왼)" : /^(sR|eR|hR|hipR|kR|fR)$/.test(name) ? " (오)" : "";
    const text = tpl.labels[name] + side;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,253,248,.9)";
    ctx.strokeText(text, x + 10, y - 8);
    ctx.fillStyle = "#25323b";
    ctx.fillText(text, x + 10, y - 8);
  }
}
function rigPick(e) {
  const r = state.rig;
  if (!r || r.templateId === "none") return null;
  const L = rigLayout();
  const sx = e.clientX - L.box.left;
  const sy = e.clientY - L.box.top;
  let best = null;
  let bd = 16;
  for (const name of TEMPLATES[r.templateId].joints) {
    const [x, y] = L.toScreen(r.joints[r.templateId][name]);
    const d = Math.hypot(x - sx, y - sy);
    if (d < bd) {
      bd = d;
      best = name;
    }
  }
  return { name: best, L, sx, sy };
}
$("#rigCanvas").addEventListener("pointerdown", (e) => {
  const p = rigPick(e);
  if (!p?.name) return;
  rigDrag = { name: p.name, moved: false };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.classList.add("dragging");
  renderRig();
});
$("#rigCanvas").addEventListener("pointermove", (e) => {
  const r = state.rig;
  if (!r) return;
  if (!rigDrag) {
    const p = rigPick(e);
    if ((p?.name ?? null) !== rigHover) {
      rigHover = p?.name ?? null;
      renderRig();
    }
    return;
  }
  const L = rigLayout();
  const [ix, iy] = L.toImage(e.clientX - L.box.left, e.clientY - L.box.top);
  r.joints[r.templateId][rigDrag.name] = [Math.min(1, Math.max(0, ix)), Math.min(1, Math.max(0, iy))];
  rigDrag.moved = true;
  renderRig();
});
const endRigDrag = (e) => {
  if (!rigDrag) return;
  const moved = rigDrag.moved;
  rigDrag = null;
  e.currentTarget.classList.remove("dragging");
  renderRig();
  if (moved) rigChanged();
};
$("#rigCanvas").addEventListener("pointerup", endRigDrag);
$("#rigCanvas").addEventListener("pointercancel", endRigDrag);
$$("#rigPane [data-tpl]").forEach((b) => b.addEventListener("click", () => setRigTemplate(b.dataset.tpl)));
$("#rigAuto").addEventListener("click", () => {
  const r = state.rig;
  if (!r || r.templateId === "none") return;
  r.joints[r.templateId] = estimateJoints(r.seg.mask, r.seg.size, r.templateId);
  renderRig();
  rigChanged();
});
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => state.view === "rig" && renderRig()).observe(viewport);
window.__d2wRig = () => state.rig; // 테스트·디버그용

// ---------------------------------------------------------------------------
// 월드 입장 (전체화면 월드 + 종목, pages/world/)
// ---------------------------------------------------------------------------
function syncEnterWorld() {
  const btn = $("#enterWorld");
  if (btn) btn.disabled = !state.edit;
}
function enterFullWorld() {
  const ed = state.edit;
  if (!ed || state.worldHost) return;
  state.worldHost = openWorld({
    getModel() {
      const v = ed.session.activeVersion;
      return { mesh: v.mesh, collider: v.collider, theta: headingRotation(ed.core.panels, ed.heading), rig: rigForWorld() };
    },
    makeGeometry: (mesh) => meshGeometry(mesh),
    material: objectMaterial,
    headingHalfExtents,
    edit: {
      quick: QUICK_PROMPTS,
      send: (text) => sendEdit(text),
      undo: () => editAction(() => ed.session.undo(), "되돌리기"),
    },
    onClose() {
      state.worldHost = null;
    },
  });
}
$("#enterWorld").addEventListener("click", enterFullWorld);
window.__d2wWorld = () => state.worldHost; // 테스트·디버그용
$("#editToWorld").addEventListener("click", () => {
  if (!state.edit) return;
  if (state.edit.placed) {
    setView("world");
    $("#viewport").scrollIntoView({ behavior: "smooth", block: "center" });
  } else placeInWorld();
});
for (const p of HEADING_PANELS) {
  const o = document.createElement("option");
  o.value = p;
  o.textContent = `${PANEL_NAMES[p]} 패널 쪽 면`;
  $("#heading").append(o);
}
$("#heading").addEventListener("change", () => {
  if (!state.edit) return;
  state.edit.heading = $("#heading").value;
  say(`앞쪽을 '${PANEL_NAMES[state.edit.heading]}' 패널 쪽 면으로 정했어요. W를 누르면 이 면이 가는 방향을 봐요.`);
  refreshEdit();
});

// 대화 상대·API 키 (D-030): 키는 기본 sessionStorage, "기억"을 고르면 localStorage에만
const KEY_NAME = "d2w.anthropicKey";
for (const m of MODELS) {
  const o = document.createElement("option");
  o.value = m.id;
  o.textContent = m.label;
  $("#model").append(o);
}
$("#planner").value = localStorage.getItem("d2w.planner") ?? "mock";
$("#model").value = localStorage.getItem("d2w.model") ?? MODELS[0].id;
$("#apiKey").value = localStorage.getItem(KEY_NAME) ?? sessionStorage.getItem(KEY_NAME) ?? "";
$("#rememberKey").checked = localStorage.getItem(KEY_NAME) != null;
function syncPlannerUI() {
  const claude = $("#planner").value === "claude";
  $("#claudeSettings").hidden = !claude;
  $("#plannerTag").textContent = claude ? "Claude 대화" : "Mock 규칙";
  $("#plannerHint").textContent = claude
    ? "Claude와 대화하며 고쳐요. 이 대화에는 그림을 보내지 않아요(문장·치수만)."
    : "Mock 규칙: 아래 버튼 같은 표현만 알아들어요. 1번 카드에서 Claude를 켜면 자유롭게 대화할 수 있어요.";
}
syncPlannerUI();
function storeKey() {
  const key = $("#apiKey").value.trim();
  localStorage.removeItem(KEY_NAME);
  sessionStorage.removeItem(KEY_NAME);
  if (key) ($("#rememberKey").checked ? localStorage : sessionStorage).setItem(KEY_NAME, key);
}
$("#apiKey").addEventListener("change", storeKey);
$("#rememberKey").addEventListener("change", storeKey);
$("#model").addEventListener("change", () => localStorage.setItem("d2w.model", $("#model").value));
$("#planner").addEventListener("change", () => {
  localStorage.setItem("d2w.planner", $("#planner").value);
  syncPlannerUI();
  if (state.edit) say($("#planner").value === "claude" ? "이제 Claude와 대화하며 고쳐요. 편하게 말해 주세요." : "이제 Mock 규칙으로 고쳐요(정해진 표현만 알아들어요).");
});
for (const p of PANEL_ORDER) {
  const o = document.createElement("option");
  o.value = p;
  o.textContent = `${PANEL_NAMES[p]} — ${LABEL_HINTS[p]}`;
  $("#viewLabel").append(o);
}
$("#viewLabel").addEventListener("change", () => {
  if (!state.result?.repairedReport.is_usable) return;
  startEditing(state.result)
    .then(() => say(`그림 방향을 '${PANEL_NAMES[state.edit.session.label]}'으로 바꿔 e0부터 다시 시작했어요.`))
    .catch((e) => showError(e.message));
});

/** 패널 칸마다 scissor로 정사영 렌더 (범위는 버전과 무관하게 고정 → 크기 변화가 보인다) */
function renderEditPanels() {
  const canvasRect = renderer.domElement.getBoundingClientRect();
  renderer.setScissorTest(false);
  renderer.setClearColor(0xe9e4da, 1);
  renderer.clear();
  renderer.setScissorTest(true);
  const span = state.edit.span;
  for (const panel of PANEL_ORDER) {
    const r = panelCells[panel].querySelector(".pv").getBoundingClientRect();
    const x = r.left - canvasRect.left;
    const y = canvasRect.bottom - r.bottom;
    if (r.width < 2 || r.height < 2) continue;
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setScissor(x, y, r.width, r.height);
    const { toward_viewer: t, screen_up: u } = state.edit.core.panels[panel];
    const side = panel !== "top" && panel !== "bottom";
    const target = new THREE.Vector3(0, side ? span * 0.4 : 0, 0);
    editCamera.up.set(...u);
    editCamera.position.set(target.x + t[0] * span * 4, target.y + t[1] * span * 4, target.z + t[2] * span * 4);
    editCamera.lookAt(target);
    const aspect = r.width / r.height;
    const half = span / 2;
    const [w, h] = aspect >= 1 ? [half * aspect, half] : [half, half / aspect];
    Object.assign(editCamera, { left: -w, right: w, top: h, bottom: -h, near: 0.01, far: span * 10 });
    editCamera.updateProjectionMatrix();
    renderer.render(editScene, editCamera);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvasRect.width, canvasRect.height);
}

// ---------------------------------------------------------------------------
// 6방향 예상 그림 (views.js, D-031): Claude가 그린 2D 그림 → 대화로 수정 → 그 외곽선으로 3D
// ---------------------------------------------------------------------------
const VIEW_PROMPTS = ["옆모습을 더 둥글게", "더 두껍게", "더 얇게", "위에서 보면 더 동그랗게", "뒷모습을 다시 그려줘"];
const viewCells = {};
for (const panel of PANEL_ORDER) {
  const cell = document.createElement("div");
  cell.className = "pcell vcell";
  cell.dataset.panel = panel;
  cell.innerHTML = `<div class="ph"><b>${PANEL_NAMES[panel]}</b>${panel === "front" ? "<em>입력 그림</em>" : "<em>예상</em>"}<small></small></div><canvas></canvas>`;
  $("#viewsGrid").append(cell);
  viewCells[panel] = cell;
}
for (const q of VIEW_PROMPTS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = q;
  b.addEventListener("click", () => sendViews(q));
  $("#viewsChips").append(b);
}

const viewsWanted = () => $("#planner").value === "claude" && $("#apiKey").value.trim() !== "" && $("#viewsConsent").checked;
const activeViews = () => state.views.versions[state.views.active].cur;

function sayViews(text, tone = "") {
  state.views.history.push({ role: tone === "user" ? "user" : "assistant", text });
  const m = document.createElement("div");
  m.className = `msg ${tone}`;
  m.textContent = text;
  $("#viewsChat").append(m);
  $("#viewsChat").scrollTop = $("#viewsChat").scrollHeight;
}

function stopViews() {
  state.views = null;
  $("#viewsCard").hidden = true;
  if (state.view === "views") setView("world");
}

/** 분할 마스크로 정면 그림(배경 흰색)·외곽 상자를 만들고 Claude에 첫 예상을 부탁한다 */
async function startViews(seg, label) {
  const S = seg.size;
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (seg.mask[y * S + x]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const full = document.createElement("canvas");
  full.width = full.height = S;
  const img = new ImageData(new Uint8ClampedArray(seg.rgba.data), S, S);
  for (let i = 0; i < S * S; i++) {
    if (seg.mask[i]) img.data[i * 4 + 3] = 255;
    else img.data.set([255, 255, 255, 0], i * 4);
  }
  full.getContext("2d").putImageData(img, 0, 0);
  const crop = document.createElement("canvas");
  crop.width = x1 - x0 + 1;
  crop.height = y1 - y0 + 1;
  crop.getContext("2d").drawImage(full, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const send = document.createElement("canvas");
  send.width = send.height = S;
  const sctx = send.getContext("2d");
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, S, S);
  sctx.drawImage(full, 0, 0);
  const png = send.toDataURL("image/png").split(",")[1];
  state.views = { seg, label, png, crop, front: { width: crop.width / S, height: crop.height / S }, versions: [], active: -1, history: [], thinking: false };
  $("#viewsChat").replaceChildren();
  $("#viewsCard").hidden = false;
  const r = await predictViews({ apiKey: $("#apiKey").value.trim(), model: $("#model").value, pngBase64: png, front: state.views.front });
  addViewsVersion(r, "예상", "처음 예상", null);
  sayViews(r.reply || "뒤·옆·위 모습을 예상해 그렸어요.");
  setView("views");
}

function addViewsVersion(cur, kind, text, prev) {
  const v = state.views;
  v.versions.push({ cur: { depthRatio: cur.depthRatio, views: cur.views }, kind, text, prev });
  v.active = v.versions.length - 1;
  renderViewsList();
  if (state.view === "views") setView("views");
}

function renderViewsList() {
  const v = state.views;
  $("#viewsCard").dataset.active = `v${v.active}`;
  $("#viewsUndo").disabled = v.versions[v.active].prev == null;
  $("#viewsVersions").replaceChildren(
    ...[...v.versions.keys()].reverse().map((i) => {
      const li = document.createElement("li");
      li.className = i === v.active ? "active" : "";
      li.innerHTML = `<b>v${i}</b><em>${v.versions[i].kind}</em><span class="vtext"></span>`;
      li.querySelector(".vtext").textContent = `${v.versions[i].text} · 두께 비율 ${v.versions[i].cur.depthRatio.toFixed(2)}`;
      return li;
    }),
  );
}

async function sendViews(text) {
  const v = state.views;
  if (!v || !text.trim() || v.thinking || state.busy) return;
  if (!viewsWanted()) {
    sayViews("예상 그림을 고치려면 1번 카드에서 Claude 사용·API 키·그림 전송 동의가 필요해요.", "warn");
    return;
  }
  const history = v.history.slice();
  sayViews(text, "user");
  $("#viewsText").value = "";
  const thinking = document.createElement("div");
  thinking.className = "msg thinking";
  thinking.textContent = "Claude가 그림을 고치는 중…";
  $("#viewsChat").append(thinking);
  v.thinking = true;
  $("#viewsCard").dataset.thinking = "true";
  try {
    const r = await predictViews({ apiKey: $("#apiKey").value.trim(), model: $("#model").value, pngBase64: v.png, front: v.front, current: activeViews(), history, text });
    thinking.remove();
    if (state.views !== v) return;
    sayViews(r.reply || (r.changed ? "고쳤어요." : "그대로 두었어요."));
    if (r.changed) addViewsVersion(r, "수정", text, v.active);
  } catch (e) {
    thinking.remove();
    sayViews(e.message, "error");
  } finally {
    v.thinking = false;
    delete $("#viewsCard").dataset.thinking;
  }
}

/** 예상 그림 6장을 같은 축척으로 그린다 (최대 변 = 1 m) */
function renderViews() {
  const v = state.views;
  if (!v || v.active < 0) return;
  const cur = activeViews();
  const W = v.front.width;
  const H = v.front.height;
  const D = cur.depthRatio * W;
  const unit = Math.max(W, H, D);
  const box = { front: [W, H], back: [W, H], left: [D, H], right: [D, H], top: [W, D], bottom: [W, D] };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sizes = PANEL_ORDER.map((p) => viewCells[p].querySelector("canvas").getBoundingClientRect());
  const k = Math.min(...PANEL_ORDER.map((p, i) => Math.min((sizes[i].width - 36) / box[p][0], (sizes[i].height - 30) / box[p][1])));
  for (const [i, p] of PANEL_ORDER.entries()) {
    const canvas = viewCells[p].querySelector("canvas");
    canvas.width = Math.max(1, Math.round(sizes[i].width * dpr));
    canvas.height = Math.max(1, Math.round(sizes[i].height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [bw, bh] = [box[p][0] * k, box[p][1] * k];
    const ox = (sizes[i].width - bw) / 2;
    const oy = (sizes[i].height - bh) / 2;
    viewCells[p].querySelector("small").textContent = `${(box[p][0] / unit).toFixed(2)} × ${(box[p][1] / unit).toFixed(2)} m`;
    drawView(ctx, p, cur, v, ox, oy, bw, bh);
  }
}

function drawView(ctx, panel, cur, v, ox, oy, bw, bh) {
  const at = ([u, vv], flipU = false, flipV = false) => [ox + (flipU ? 1 - u : u) * bw, oy + (flipV ? 1 - vv : vv) * bh];
  const path = (pts, flipU, flipV) => {
    ctx.beginPath();
    pts.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](...at(p, flipU, flipV)));
    ctx.closePath();
  };
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "#a36b25";
  ctx.strokeRect(ox, oy, bw, bh);
  ctx.restore();
  if (panel === "front") {
    ctx.drawImage(v.crop, ox, oy, bw, bh);
    return;
  }
  const look = cur.views[panel];
  // 외곽선: left·top은 그대로, right·bottom은 거울, back은 정면 그림 실루엣의 좌우 거울
  const outline = { left: [cur.views.left.outline, false, false], right: [cur.views.left.outline, true, false], top: [cur.views.top.outline, false, false], bottom: [cur.views.top.outline, false, true] }[panel];
  ctx.save();
  if (panel === "back") {
    const sil = document.createElement("canvas");
    sil.width = v.crop.width;
    sil.height = v.crop.height;
    const s = sil.getContext("2d");
    s.translate(sil.width, 0);
    s.scale(-1, 1);
    s.drawImage(v.crop, 0, 0);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = look.base_color;
    s.fillRect(0, 0, sil.width, sil.height);
    s.globalCompositeOperation = "source-atop";
    for (const part of look.parts) {
      s.fillStyle = part.color;
      s.beginPath();
      part.points.forEach(([u, vv], i) => s[i ? "lineTo" : "moveTo"](u * sil.width, vv * sil.height));
      s.closePath();
      s.fill();
    }
    ctx.drawImage(sil, ox, oy, bw, bh);
  } else {
    path(outline[0], outline[1], outline[2]);
    ctx.fillStyle = look.base_color;
    ctx.fill();
    ctx.clip();
    for (const part of look.parts) {
      path(part.points);
      ctx.fillStyle = part.color;
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    path(outline[0], outline[1], outline[2]);
    ctx.strokeStyle = "#25323b";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  // 물체 앞(입력 그림 쪽)이 어느 쪽인지 표시
  const front = { left: "앞 →", right: "← 앞", top: "앞 ↓", bottom: "앞 ↑", back: "" }[panel];
  if (front) {
    ctx.fillStyle = "#6b7378";
    ctx.font = "11px Pretendard Variable, sans-serif";
    ctx.fillText(front, ox + 4, oy + bh + 14 > ctx.canvas.height ? oy - 4 : oy + bh + 14);
  }
}

$("#viewsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  sendViews($("#viewsText").value);
});
$("#viewsUndo").addEventListener("click", () => {
  const v = state.views;
  const target = v && v.versions[v.versions[v.active].prev];
  if (!target) return;
  addViewsVersion(target.cur, "되돌리기", `v${v.active} 되돌림 → v${v.versions[v.active].prev}`, target.prev);
  sayViews(`v${v.active}: 이전 그림으로 되돌렸어요.`);
});
$("#viewsBuild").addEventListener("click", async () => {
  const v = state.views;
  if (!v || state.busy || v.thinking) return;
  state.busy = true;
  let step = "generate";
  const cur = activeViews();
  try {
    setStep("views", "done");
    await build(v.seg, v.label, (box) => hullDepth(cur, box), (s) => (step = s));
    sayViews(`v${v.active} 그림으로 3D를 만들었어요. 오른쪽 '6방향 3D'에서 확인하세요.`, "ok");
  } catch (err) {
    fail(step, err);
  } finally {
    busy(false);
    state.busy = false;
  }
});
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => state.view === "views" && renderViews()).observe(viewport);

// ---------------------------------------------------------------------------
// 렌더 루프
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  if (!renderer) return;
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;
  if (state.view === "world") {
    if (player.ready) {
      const before = playerFocus();
      stepPlayer(dt);
      const after = playerFocus();
      const delta = after.sub(before);
      camera.position.add(delta);
      controls.target.add(delta);
      sun.position.set(player.pos.x + 5, 9, player.pos.z + 6);
      sun.target.position.set(player.pos.x, 0, player.pos.z);
    }
    gems.forEach((g, i) => {
      g.rotation.y = t * 1.8 + i;
      g.position.y = g.userData.base + Math.sin(t * 2.4 + i) * 0.08;
    });
    marker.material.opacity = 0.55 + Math.sin(t * 6) * 0.3;
  }
  controls.update();
  if (state.view === "views" || state.view === "rig") return; // 예상 그림·관절은 2D 캔버스만 보인다
  if (state.view === "edit") renderEditPanels();
  else renderer.render(state.view === "world" ? worldScene : inspectScene, camera);
}
setView("world");
loop();

// ---------------------------------------------------------------------------
// 시작: 자동차 샘플을 바로 변환해 월드에 띄운다
// ---------------------------------------------------------------------------
(async () => {
  const first = SAMPLES[1];
  selectSample(first.id);
  try {
    busy(true, "샘플 불러오는 중…");
    const data = await loadSample(first);
    await run(data, `샘플: ${first.name}`);
  } catch (e) {
    busy(false);
    showError(`샘플을 불러오지 못했습니다: ${e.message}`);
    document.body.dataset.status = "error";
  }
})();
