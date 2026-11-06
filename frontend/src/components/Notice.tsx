import type { ReactNode } from "react";
import { CheckCircleIcon, CloseIcon, ErrorIcon, InfoIcon, WarningIcon } from "./icons";

/**
 * The one look for every notification: toasts, feature announcements, banners and inline
 * success/error messages. Presentation only. Callers keep their own state, timing, roles and
 * callbacks; this just draws them.
 *
 * Tones map to the theme's --tone-* tokens (index.css, "Notifications"). The tone colours the
 * icon and title only; the message is always --text, so it stays readable in both themes.
 */
export type NoticeTone = "success" | "error" | "warning" | "info" | "feature";

const DEFAULT_ICONS: Record<NoticeTone, ReactNode> = {
  success: <CheckCircleIcon />,
  error: <ErrorIcon />,
  warning: <WarningIcon />,
  info: <InfoIcon />,
  feature: <InfoIcon />,
};

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  title?: ReactNode;
  /** Heading level for the title; feature announcements use h3, as before. */
  titleAs?: "p" | "h3";
  /** Replaces the tone's default icon (e.g. a feature's own icon). */
  icon?: ReactNode;
  /** Adds a close button. */
  onDismiss?: () => void;
  dismissLabel?: string;
  actions?: ReactNode;
  /** Floating toast or banner: adds the elevated shadow. */
  floating?: boolean;
  className?: string;
  role?: "alert" | "status";
  "aria-live"?: "polite" | "assertive";
  "aria-atomic"?: boolean;
}

export default function Notice({
  tone, children, title, titleAs = "p", icon, onDismiss, dismissLabel = "Dismiss", actions,
  floating = false, className, role, ...aria
}: NoticeProps) {
  const Title = titleAs;
  return (
    <div
      className={["notice", `notice--${tone}`, floating && "notice--floating", className].filter(Boolean).join(" ")}
      role={role}
      {...aria}
    >
      <span className="notice__icon">{icon ?? DEFAULT_ICONS[tone]}</span>
      <div className="notice__body">
        {title && <Title className="notice__title">{title}</Title>}
        <div className="notice__message">{children}</div>
        {actions && <div className="notice__actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="notice__close" onClick={onDismiss} aria-label={dismissLabel}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
