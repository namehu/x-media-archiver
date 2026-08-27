import * as React from "react";

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border-subtle px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(140px,0.6fr)_minmax(0,1fr)] sm:gap-4">
      <span className="text-fg-secondary">{label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere] text-fg-primary sm:text-right">{value}</span>
    </div>
  );
}
