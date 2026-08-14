import { useState, useEffect, useCallback } from "react";
import { shouldShowNotification, markNotificationShown, shouldShowBountyWinnerNotification, markBountyWinnerNotificationShown } from "../lib/notificationManager";
import { getUserStorage, setUserStorage } from "../lib/unifiedStorage";
import { findBountyWinner } from "../lib/bountyWinners";

interface ActiveNotification {
  type: "undoStep" | "cosmetics" | "flowStateVoting" | "bountyWinner";
  id: string;
  bountyId?: string; // For bounty winner notifications
  placement?: number;
  week?: number;
  prizeAmount?: number;
}

/**
 * Hook to manage feature notifications during gameplay.
 * Tracks session count and determines which notifications to show.
 */
export function useFeatureNotifications(
  address: string | undefined,
  sessionCount: number,
  moveCount: number,
  isGameActive: boolean,
  isVerified: boolean,
  username?: string
) {
  const [activeNotifications, setActiveNotifications] = useState<ActiveNotification[]>([]);
  const [shownThisSession, setShownThisSession] = useState<Set<string>>(new Set());

  // Initialize session count tracking
  useEffect(() => {
    if (!address) return;

    const sessionCountKey = `session_count_${address}`;
    const stored = getUserStorage(address, sessionCountKey);
    const currentCount = parseInt(stored || "0", 10);

    // Only initialize once per session
    if (currentCount === 0) {
      setUserStorage(address, sessionCountKey, "1");
    }
  }, [address]);

  // Check for bounty winner notification on mount or address change
  useEffect(() => {
    if (!address) return;

    const winner = findBountyWinner(address as `0x${string}`, username);
    if (winner && shouldShowBountyWinnerNotification(winner.bountyId)) {
      setActiveNotifications((prev) => [
        ...prev,
        {
          type: "bountyWinner",
          id: `bounty-winner-${winner.bountyId}`,
          bountyId: winner.bountyId,
          placement: winner.placement,
          week: winner.week,
          prizeAmount: winner.prizeAmount,
        },
      ]);
      markBountyWinnerNotificationShown(winner.bountyId);
    }
  }, [address, username]);

  // Trigger notifications based on game state
  useEffect(() => {
    if (!address || !isGameActive) return;

    // Trigger Undo Step notification after 3+ moves into the session
    // (give player time to understand the game before announcing features)
    if (moveCount === 3 && !shownThisSession.has("undoStep")) {
      if (shouldShowNotification("undoStep", sessionCount)) {
        setActiveNotifications((prev) => [
          ...prev,
          { type: "undoStep", id: `undo-${Date.now()}` },
        ]);
        setShownThisSession((prev) => new Set(prev).add("undoStep"));
        markNotificationShown("undoStep", sessionCount);
      }
    }

    // Trigger Cosmetics notification after 8+ moves (deeper into session)
    if (moveCount === 8 && !shownThisSession.has("cosmetics")) {
      if (shouldShowNotification("cosmetics", sessionCount)) {
        setActiveNotifications((prev) => [
          ...prev,
          { type: "cosmetics", id: `cosmetics-${Date.now()}` },
        ]);
        setShownThisSession((prev) => new Set(prev).add("cosmetics"));
        markNotificationShown("cosmetics", sessionCount);
      }
    }

    // Trigger Flow State voting reminder after 10+ moves, only for verified players
    if (moveCount === 10 && !shownThisSession.has("flowStateVoting") && isVerified) {
      if (shouldShowNotification("flowStateVoting", sessionCount)) {
        setActiveNotifications((prev) => [
          ...prev,
          { type: "flowStateVoting", id: `flow-state-${Date.now()}` },
        ]);
        setShownThisSession((prev) => new Set(prev).add("flowStateVoting"));
        markNotificationShown("flowStateVoting", sessionCount);
      }
    }
  }, [address, moveCount, sessionCount, isGameActive, isVerified, shownThisSession]);

  const dismissNotification = useCallback((id: string) => {
    setActiveNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    activeNotifications,
    dismissNotification,
  };
}
