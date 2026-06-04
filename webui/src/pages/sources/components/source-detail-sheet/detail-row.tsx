import * as React from "react";

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-secondary">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
