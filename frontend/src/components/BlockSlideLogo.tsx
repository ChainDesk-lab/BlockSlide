export default function BlockSlideLogo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 3D Isometric cube blocks in BlockSlide brand colors */}

      {/* Top-left block (lightest purple) */}
      <path
        d="M 32 48 L 48 36 L 64 48 L 48 60 Z"
        fill="#A78BFA"
        stroke="#6B4EFF"
        strokeWidth="1.5"
      />

      {/* Top-right block (medium purple) */}
      <path
        d="M 64 48 L 80 36 L 96 48 L 80 60 Z"
        fill="#8B5CF6"
        stroke="#6B4EFF"
        strokeWidth="1.5"
      />

      {/* Left side block (brand purple) */}
      <path
        d="M 32 48 L 48 60 L 48 88 L 32 76 Z"
        fill="#6B4EFF"
        stroke="#5940D4"
        strokeWidth="1.5"
      />

      {/* Right side block (darker purple) */}
      <path
        d="M 64 48 L 80 60 L 80 88 L 64 76 Z"
        fill="#7C3AED"
        stroke="#5940D4"
        strokeWidth="1.5"
      />

      {/* Bottom block (darkest purple) */}
      <path
        d="M 48 60 L 64 72 L 64 100 L 48 88 Z"
        fill="#5940D4"
        stroke="#4C1D95"
        strokeWidth="1.5"
      />

      {/* Front-bottom block (medium dark) */}
      <path
        d="M 64 72 L 80 60 L 80 88 L 64 100 Z"
        fill="#6B4EFF"
        stroke="#5940D4"
        strokeWidth="1.5"
      />

      {/* Highlight/accent (top face) */}
      <path
        d="M 48 60 L 64 48 L 80 60 L 64 72 Z"
        fill="none"
        stroke="#C4B5FD"
        strokeWidth="1"
        opacity="0.6"
      />
    </svg>
  );
}
