import { useCallback, useState } from "react";

const FLOWSTATE_VOTE_URL = "https://flowstate.network/flow-councils/42220/0x582e3314d4ef56c18930acb10bb64313525e7820";

interface VotingReminder {
  lastShownAt: number; // timestamp
  dismissedUntil: number; // timestamp when dismissal expires
}

// localStorage key for tracking voting reminder state
const VOTING_REMINDER_KEY = "flowstate_voting_reminder";

export function useFlowstateVoting() {
  const [shouldShow, setShouldShow] = useState(false);

  // Load reminder state from localStorage
  const getReminderState = useCallback((): VotingReminder | null => {
    try {
      const stored = localStorage.getItem(VOTING_REMINDER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }, []);

  // Check if we should show the reminder based on timing
  const shouldShowReminder = useCallback((): boolean => {
    const reminder = getReminderState();
    const now = Date.now();

    // If dismissed, check if dismissal period is still active (1 week)
    if (reminder?.dismissedUntil && now < reminder.dismissedUntil) {
      return false;
    }

    // If shown today, don't show again (max once per day)
    if (reminder?.lastShownAt) {
      const lastShownDate = new Date(reminder.lastShownAt).toDateString();
      const today = new Date().toDateString();
      if (lastShownDate === today) {
        return false;
      }
    }

    return true;
  }, [getReminderState]);

  // Trigger the voting reminder (call after game success, etc.)
  const triggerVotingReminder = useCallback((): boolean => {
    // Don't show if not allowed to show (already shown today or dismissed for the week)
    if (!shouldShowReminder()) {
      return false;
    }

    // Record that we're showing it today
    const reminder: VotingReminder = {
      lastShownAt: Date.now(),
      dismissedUntil: 0, // reset dismissal
    };
    try {
      localStorage.setItem(VOTING_REMINDER_KEY, JSON.stringify(reminder));
    } catch {
      /* ignore localStorage errors */
    }

    setShouldShow(true);
    return true;
  }, [shouldShowReminder]);

  // Dismiss the reminder for the rest of the week
  const dismissForWeek = useCallback(() => {
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const reminder: VotingReminder = {
      lastShownAt: Date.now(),
      dismissedUntil: Date.now() + oneWeekMs,
    };
    try {
      localStorage.setItem(VOTING_REMINDER_KEY, JSON.stringify(reminder));
    } catch {
      /* ignore localStorage errors */
    }
    setShouldShow(false);
  }, []);

  // Close the modal
  const close = useCallback(() => {
    setShouldShow(false);
  }, []);

  return {
    shouldShow,
    triggerVotingReminder,
    dismissForWeek,
    close,
    voteUrl: FLOWSTATE_VOTE_URL,
  };
}
