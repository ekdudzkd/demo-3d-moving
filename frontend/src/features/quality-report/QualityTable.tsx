import type { InspectReport } from "../../types/domain";
import { qualityRows } from "./quality";

export function QualityTable({ raw, repaired }: { raw: InspectReport; repaired: InspectReport }) {
  return (
    <table data-testid="quality-table">
      <thead>
        <tr>
          <th>항목</th>
          <th>원본</th>
          <th>보정본</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {qualityRows(raw, repaired).map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td className="num">{r.raw}</td>
            <td className="num">{r.repaired}</td>
            <td>{r.ok === null ? null : <span className={`badge ${r.ok ? "ok" : "warn"}`}>{r.ok ? "OK" : "확인"}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CheckList({ report }: { report: InspectReport }) {
  const items = [...report.errors, ...report.warnings];
  if (!items.length) return <p className="muted small">경고 없음</p>;
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
      {items.map((c) => (
        <li key={c.code} className="row" style={{ gap: 6, fontSize: 13 }}>
          <span className={`badge ${c.severity === "error" ? "error" : "warn"}`}>{c.code}</span>
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}
