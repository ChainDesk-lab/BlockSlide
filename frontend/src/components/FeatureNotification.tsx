"use client";

import { ReactNode, useEffect, useState } from "react";
import Notice, { type NoticeTone } from "./Notice";
import { PaletteIcon, TrophyIcon, UndoIcon, VoteIcon } from "./icons";

const LOOK: Record<FeatureNotificationProps["type"], { tone: NoticeTone; icon: ReactNode }> = {
  undoStep: { tone: "feature", icon: <UndoIcon /> },
  cosmetics: { tone: "feature", icon: <PaletteIcon /> },
  flowStateVoting: { tone: "feature", icon: <VoteIcon /> },
  bountyWinner: { tone: "success", icon: <TrophyIcon /> },
};

export interface FeatureNotificationProps {
  type: "undoStep" | "cosmetics" | "flowStateVoting" | "bountyWinner";
  title: string;
  message: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  autoHideDuration?: number; // ms, 0 = no auto-hide
  onDismiss: () => void;
}

/**
 * Non-intrusive feature notification toast.
 * Appears as a small popup overlay without blocking gameplay.
 * Auto-dismisses if autoHideDuration is set, or can be manually dismissed.
 */
export default function FeatureNotification({
  type,
  title,
  message,
  actionLabel,
  onAction,
  autoHideDuration = 7000,
  onDismiss,
}: FeatureNotificationProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (autoHideDuration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300); // Wait for fade-out animation
      }, autoHideDuration);

      return () => clearTimeout(timer);
    }
  }, [autoHideDuration, onDismiss]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  if (!isVisible) return null;

  return (
    <Notice
      tone={LOOK[type].tone}
      icon={LOOK[type].icon}
      title={title}
      titleAs="h3"
      className={`feature-notification feature-notification--${type}`}
      role="status"
      aria-live="polite"
      aria-atomic
      floating
      onDismiss={handleDismiss}
      dismissLabel="Dismiss notification"
      actions={actionLabel && (
        <button
          className="feature-notification__action btn btn--sm btn--primary"
          onClick={() => {
            onAction?.();
            handleDismiss();
          }}
        >
          {actionLabel}
        </button>
      )}
    >
      <p className="feature-notification__message">{message}</p>
    </Notice>
  );
}
