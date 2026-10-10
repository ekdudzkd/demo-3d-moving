import type { InspectReport } from "../../types/domain";

export interface QualityRow {
  key: string;
  label: string;
  raw: string;
  repaired: string;
  /** 보정본이 기준을 만족하는지 (null = 정보성) */
  ok: boolean | null;
}

const yes = (v: boolean) => (v ? "예" : "아니오");

export function qualityRows(raw: InspectReport, repaired: InspectReport): QualityRow[] {
  const size = (r: InspectReport) => r.extents.map((v) => v.toFixed(2)).join(" × ");
  return [
    { key: "is_usable", label: "자산 사용 가능", raw: yes(raw.is_usable), repaired: yes(repaired.is_usable), ok: repaired.is_usable },
    { key: "face_count", label: "면 수", raw: fmt(raw.face_count), repaired: fmt(repaired.face_count), ok: null },
    { key: "vertex_count", label: "정점 수", raw: fmt(raw.vertex_count), repaired: fmt(repaired.vertex_count), ok: null },
    {
      key: "connected_components",
      label: "분리된 조각",
      raw: String(raw.connected_components),
      repaired: String(repaired.connected_components),
      ok: repaired.small_components === 0,
    },
    {
      key: "non_manifold_edges",
      label: "non-manifold edge",
      raw: String(raw.non_manifold_edges),
      repaired: String(repaired.non_manifold_edges),
      ok: !repaired.errors.some((c) => c.code === "non_manifold"),
    },
    {
      key: "open_boundary_edges",
      label: "열린 경계 edge",
      raw: String(raw.open_boundary_edges),
      repaired: String(repaired.open_boundary_edges),
      ok: null,
    },
    { key: "duplicate_vertices", label: "중복 정점", raw: String(raw.duplicate_vertices), repaired: String(repaired.duplicate_vertices), ok: repaired.duplicate_vertices === 0 },
    { key: "centered", label: "원점 중앙", raw: yes(raw.centered), repaired: yes(repaired.centered), ok: repaired.centered },
    { key: "grounded", label: "바닥에 닿음", raw: yes(raw.grounded), repaired: yes(repaired.grounded), ok: repaired.grounded },
    { key: "extents", label: "크기 (m)", raw: size(raw), repaired: size(repaired), ok: null },
    {
      key: "color",
      label: "색 정보",
      raw: colorKind(raw),
      repaired: colorKind(repaired),
      ok: repaired.has_texture || repaired.has_vertex_colors,
    },
  ];
}

function colorKind(r: InspectReport) {
  if (r.has_texture) return "텍스처";
  if (r.has_vertex_colors) return "정점 색";
  return "없음";
}

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}
