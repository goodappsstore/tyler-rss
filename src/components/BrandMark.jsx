/**
 * Tyler's brand mark, matching the desktop app icon: a warm terracotta tile,
 * a cream page, and an RSS signal. Rendered as inline SVG so it stays crisp.
 */
export default function BrandMark({ size = 20, className = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Tyler"
      focusable="false"
    >
      <rect width="64" height="64" rx="15" fill="#bd3d0c" />
      <rect x="12.5" y="10.5" width="39" height="43.5" rx="7" fill="#fbf6ea" />
      <circle cx="25" cy="42" r="3.4" fill="#1b1915" />
      <path
        d="M25 33.5A8.5 8.5 0 0 1 33.5 42"
        fill="none"
        stroke="#1b1915"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M25 24A18 18 0 0 1 43 42"
        fill="none"
        stroke="#1b1915"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
