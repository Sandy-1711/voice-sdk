const HEIGHTS = [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.3, 0.75];

/**
 * A level meter. `animated` staggers the bars so it reads as live audio;
 * without it the bars hold a fixed pattern.
 */
export function Waveform({
  className,
  bars = HEIGHTS.length,
  animated = false,
}: {
  className?: string;
  bars?: number;
  animated?: boolean;
}) {
  const width = bars * 4 - 1;

  return (
    <svg
      viewBox={`0 0 ${width} 20`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      fill="currentColor"
    >
      {Array.from({ length: bars }, (_, index) => {
        const height = (HEIGHTS[index % HEIGHTS.length] ?? 0.5) * 20;
        return (
          <rect
            key={index}
            x={index * 4}
            y={(20 - height) / 2}
            width="2.5"
            height={height}
            rx="1.25"
            style={
              animated
                ? {
                    transformOrigin: "center",
                    animation: `level ${1.1 + (index % 5) * 0.22}s ease-in-out ${index * 0.07}s infinite`,
                  }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}
