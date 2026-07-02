import { ReactNode } from "react";

interface IconBadgeProps {
  icon: ReactNode;
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
}

/**
 * Unified icon badge component using the brand gradient (purple to pink).
 * Used consistently across home features, daily claim, and shop items.
 */
export function IconBadge({
  icon,
  size = "md",
  ariaLabel,
}: IconBadgeProps) {
  const sizeClass = {
    sm: "icon-badge--sm",
    md: "icon-badge--md",
    lg: "icon-badge--lg",
  }[size];

  return (
    <span className={`icon-badge ${sizeClass}`} aria-label={ariaLabel}>
      {icon}
    </span>
  );
}
