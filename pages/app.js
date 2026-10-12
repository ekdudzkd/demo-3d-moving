import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import * as P from "./pipeline.js";

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

const state = { busy: false, seed: 0, result: null, view: "world", lastImage: null, lastLabel: "" };

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
  const mode = $("#mode").value;
  const budget = Number($("#budget").value);
  const artifacts = $("#artifacts").checked;
  resetSteps();
  setStep("input", "done");
  let step = "segment";
  try {
    busy(true, "객체 분할 중… (배경색 기반 전경 추정)");
    setStep("segment", "active");
    await pause(120);
    const seg = P.segment(imageData);
    renderSeg(seg, null);
    setStep("segment", "done");

    step = "generate";
    busy(true, "3D 메시 생성 중… (실루엣 돌출 · 로컬 기하 대체)");
    setStep("generate", "active");
    await pause(160);
    const gen = P.generateMesh(seg, { mode, artifacts, seed: state.seed });
    renderSeg(seg, gen.info.contour);
    renderGen(gen, label);
    setStep("generate", "done");

    step = "inspect";
    busy(true, "메시 검사·자동 보정 중…");
    setStep("inspect", "active");
    await pause(160);
    const th = { face_budget: budget, target_size: P.TARGET_SIZE };
    const rawReport = P.inspectMesh(gen.mesh, th);
    const repair = P.repairMesh(gen.mesh, budget);
    const repairedReport = P.inspectMesh(repair.mesh, th);
    const collider = P.buildCollider(repair.mesh);
    state.result = { seg, gen, rawReport, repair, repairedReport, collider, label };
    renderQC(state.result);
    buildInspectObjects(state.result);
    setStep("inspect", repairedReport.is_usable ? "done" : "failed");

    step = "world";
    if (!repairedReport.is_usable) {
      // 생성 성공 ≠ 자산 사용 가능: 사용 불가 판정이면 월드에 넣지 않는다
      showError("보정 후에도 사용 불가 판정입니다. 월드에 배치하지 않습니다. 다른 그림으로 시도해 주세요.");
      setView("repaired");
    } else {
      setStep("world", "active");
      await pause(120);
      spawnPlayer(state.result);
      setView("world");
      setStep("world", "done");
    }
    document.body.dataset.status = "ready";
  } catch (err) {
    console.error(err);
    setStep(step, "failed");
    showError(err.code ? `[${err.code}] ${err.message}` : `처리 중 오류: ${err.message}`);
    document.body.dataset.status = "error";
  } finally {
    busy(false);
    state.busy = false;
  }
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
    ["임계값", seg.threshold == null ? "alpha ≥ 128" : `ΔE > ${fmt(seg.threshold, 1)}`],
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
    ["생성기", i.mode === "inflate" ? "실루엣 부풀리기 (mock 변형)" : "mock · extrude-1 (실루엣 돌출)"],
    ["외곽선", `${i.contour_points}점 (approxPolyDP 0.8px, ${P.WORK}² 작업 해상도)`],
    ["두께", `폭 × ${P.DEPTH_RATIO} = ${fmt(i.depth, 3)}`],
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
  if (state.result?.repairedReport.is_usable) {
    setView("world");
    $("#viewport").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

$("#downloadGlb").addEventListener("click", () => {
  if (!state.result) return;
  const mesh = new THREE.Mesh(meshGeometry(state.result.repair.mesh, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
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
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.f), 1));
  if (!creased) {
    g.computeVertexNormals();
    return g;
  }
  return toCreasedNormals(g, Math.PI / 5);
}
const objectMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
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

function spawnPlayer(res) {
  disposeGroup(player.tilt);
  const geom = meshGeometry(res.repair.mesh);
  const mesh = new THREE.Mesh(geom, objectMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const wire = new THREE.Mesh(geom, wireMaterial);
  wire.name = "wire";
  const col = colliderHelpers({ ...res.collider, points: null });
  player.tilt.add(mesh, wire, col);
  player.tilt.scale.setScalar(WORLD_SCALE);
  const [hx, hy, hz] = res.collider.box.half_extents;
  player.half = [hx * WORLD_SCALE, hy * WORLD_SCALE, hz * WORLD_SCALE];
  player.height = hy * 2 * WORLD_SCALE;
  player.ready = true;
  respawn();
  resetGems();
  applyViewOptions();
}
function respawn() {
  player.pos.set(0, 6, 0);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
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
  state.view = v;
  $$(".vt").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#pad").hidden = v !== "world" || !player.ready;
  $("#help").textContent = v === "world" && !player.ready ? "그림을 변환하면 여기에 등장합니다" : HELP[v];
  inspectObjects.raw.visible = v === "raw";
  inspectObjects.repaired.visible = v === "repaired";
  const r = state.result;
  const rep = r && (v === "raw" ? r.rawReport : r.repairedReport);
  $("#legend").textContent = rep ? `${v === "raw" ? "원본" : "보정본"} · 정점 ${fmt(rep.vertex_count)} · 면 ${fmt(rep.face_count)}` : "";
  if (v === "world" && r) $("#legend").textContent = `월드 배율 ×${WORLD_SCALE} · 충돌체: 상자`;
  if (!controls) return;
  if (v === "world") {
    controls.autoRotate = false;
    frameWorldCamera(true);
  } else {
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
  renderer.render(state.view === "world" ? worldScene : inspectScene, camera);
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
