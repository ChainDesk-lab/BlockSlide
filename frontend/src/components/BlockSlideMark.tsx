/**
 * BlockSlide Icon Mark (standalone)
 * 2×2 grid with offset bottom-right tile
 * Used for favicon, app icon, social avatar
 */
export default function BlockSlideMark({ size = 128, variant = "color" }: { size?: number; variant?: "color" | "mono" }) {
  if (variant === "mono") {
    // Monochrome: white on dark or black on light
    return (
      <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Top-left */}
        <rect x="16" y="16" width="40" height="40" rx="6" fill="currentColor" />
        {/* Top-right */}
        <rect x="72" y="16" width="40" height="40" rx="6" fill="currentColor" />
        {/* Bottom-left */}
        <rect x="16" y="72" width="40" height="40" rx="6" fill="currentColor" />
        {/* Bottom-right (offset) */}
        <rect x="80" y="80" width="40" height="40" rx="6" fill="currentColor" opacity="0.6" />
      </svg>
    );
  }

  // Color version: brand purple + lighter shade
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Top-left tile - brand purple */}
      <rect x="16" y="16" width="40" height="40" rx="6" fill="#6B4EFF" />

      {/* Top-right tile - brand purple */}
      <rect x="72" y="16" width="40" height="40" rx="6" fill="#6B4EFF" />

      {/* Bottom-left tile - darker purple */}
      <rect x="16" y="72" width="40" height="40" rx="6" fill="#8B5CF6" />

      {/* Bottom-right tile (offset) - lighter purple, creates "break" effect */}
      <rect x="80" y="80" width="40" height="40" rx="6" fill="#C4B5FD" />
    </svg>
  );
}
