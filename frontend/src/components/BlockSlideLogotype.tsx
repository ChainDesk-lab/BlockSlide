/**
 * BlockSlide Full Logotype (horizontal lockup)
 * Icon mark + wordmark "BlockSlide" side-by-side
 * Used for header, marketing, full branding
 */
export default function BlockSlideLogotype({ height = 48, variant = "color" }: { height?: number; variant?: "color" | "mono" }) {
  const width = height * 2.8; // icon + gap + text (approximately)
  const textColor = variant === "mono" ? "currentColor" : "#1F2937";

  return (
    <svg width={width} height={height} viewBox="0 0 336 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Icon mark (left) */}
      <g>
        {/* Top-left tile */}
        <rect x="4" y="4" width="12" height="12" rx="2" fill={variant === "mono" ? "currentColor" : "#6B4EFF"} />
        {/* Top-right tile */}
        <rect x="20" y="4" width="12" height="12" rx="2" fill={variant === "mono" ? "currentColor" : "#6B4EFF"} />
        {/* Bottom-left tile */}
        <rect x="4" y="20" width="12" height="12" rx="2" fill={variant === "mono" ? "currentColor" : "#8B5CF6"} />
        {/* Bottom-right tile (offset) */}
        <rect x="24" y="24" width="12" height="12" rx="2" fill={variant === "mono" ? "currentColor" : "#C4B5FD"} opacity={variant === "mono" ? 0.6 : 1} />
      </g>

      {/* Wordmark (right) */}
      <text
        x="44"
        y="35"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="32"
        fontWeight="800"
        fill={textColor}
        letterSpacing="-0.02em"
        dominantBaseline="middle"
      >
        BlockSlide
      </text>
    </svg>
  );
}
