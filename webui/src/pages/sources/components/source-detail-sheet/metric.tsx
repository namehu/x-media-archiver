import * as React from "react";

export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="text-fg-primary">{value}</div>
    </div>
  );
}
