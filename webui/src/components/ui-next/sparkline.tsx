import { cn } from "./_utils/cn";

export function Sparkline({
  data,
  className,
  height = 36,
}: {
  data: number[];
  className?: string;
  height?: number;
}) {
  const width = 120;
  const values = data.length > 1 ? data : [0, data[0] ?? 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 8) - 4;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-9 w-28 text-brand", className)} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
