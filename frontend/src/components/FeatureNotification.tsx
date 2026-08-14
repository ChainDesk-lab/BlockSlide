"use client";

import { ReactNode, useEffect, useState } from "react";

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
    <div
      className={`feature-notification feature-notification--${type}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="feature-notification__content">
        <div className="feature-notification__header">
          <h3 className="feature-notification__title">{title}</h3>
          <button
            className="feature-notification__close"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
        <p className="feature-notification__message">{message}</p>
        {actionLabel && (
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
      </div>
    </div>
  );
}
