import type { Issue } from "../types/domain";

export function IssueList({ errors = [], warnings = [] }: { errors?: Issue[]; warnings?: Issue[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
      {errors.map((i) => (
        <li key={`e-${i.code}`} className="notice error" data-code={i.code}>
          {i.message}
        </li>
      ))}
      {warnings.map((i) => (
        <li key={`w-${i.code}`} className="notice warn" data-code={i.code}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}
