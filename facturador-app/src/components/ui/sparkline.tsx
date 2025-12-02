'use client';

interface SparklineProps {
  data: number[];
  color: string;
}

export function Sparkline({ data, color }: SparklineProps) {
  const width = 120;
  const height = 36;
  const padding = 4;

  if (!data.length) {
    return (
      <div className="h-9 w-32 rounded-full bg-slate-100" aria-hidden="true" />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x =
      (index / Math.max(1, data.length - 1)) * (width - padding * 2) + padding;
    const normalized = (value - min) / range;
    const y = height - normalized * (height - padding * 2) - padding;
    return `${x},${y}`;
  });

  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-9 w-32"
      role="presentation"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={points.join(' ')} strokeLinecap="round" />
      <polygon
        fill={`url(#${gradientId})`}
        points={[
          `${padding},${height - padding}`,
          ...points,
          `${width - padding},${height - padding}`,
        ].join(' ')}
        opacity={0.5}
      />
    </svg>
  );
}
