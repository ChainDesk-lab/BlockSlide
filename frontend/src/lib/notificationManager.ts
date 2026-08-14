/**
 * Notification state management via localStorage.
 * Tracks "seen" state and show counts for feature announcements.
 */

// Configuration for each notification type (show counts and intervals)
export const NOTIFICATION_CONFIG = {
  undoStep: {
    maxShows: 3,
    key: "notif_undo_step",
  },
  cosmetics: {
    maxShows: 3,
    key: "notif_cosmetics",
  },
  flowStateVoting: {
    maxShows: 0, // Reappears periodically, not capped
    key: "notif_flow_state_voting",
    sessionInterval: 5, // Show once every N sessions
  },
  bountyWinner: {
    maxShows: 1, // Show once per bounty
    key: "notif_bounty_winner",
    // Note: bountyId is part of the key to track per-bounty state
  },
};

interface NotificationState {
  shows: number;
  lastShownSession?: number;
}

function getNotificationState(key: string): NotificationState {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : { shows: 0 };
  } catch {
    return { shows: 0 };
  }
}

function setNotificationState(key: string, state: NotificationState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Fail silently if localStorage unavailable
  }
}

export function shouldShowNotification(
  type: "undoStep" | "cosmetics" | "flowStateVoting",
  currentSessionCount: number
): boolean {
  const config = NOTIFICATION_CONFIG[type];
  const state = getNotificationState(config.key);

  // If we have a hard cap on shows and we've reached it, don't show
  if (config.maxShows > 0 && state.shows >= config.maxShows) {
    return false;
  }

  // For notifications with session intervals (like Flow State voting)
  if ("sessionInterval" in config) {
    const lastShown = state.lastShownSession ?? 0;
    const sessionsSinceLastShow = currentSessionCount - lastShown;
    if (sessionsSinceLastShow < config.sessionInterval) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a bounty winner notification should be shown.
 * Each bounty period is tracked separately by bountyId.
 */
export function shouldShowBountyWinnerNotification(bountyId: string): boolean {
  const key = `notif_bounty_winner_${bountyId}`;
  const state = getNotificationState(key);

  const config = NOTIFICATION_CONFIG.bountyWinner;
  if (config.maxShows > 0 && state.shows >= config.maxShows) {
    return false;
  }

  return true;
}

export function markNotificationShown(
  type: "undoStep" | "cosmetics" | "flowStateVoting",
  currentSessionCount: number
) {
  const config = NOTIFICATION_CONFIG[type];
  const state = getNotificationState(config.key);

  state.shows = (state.shows || 0) + 1;
  if ("sessionInterval" in config) {
    state.lastShownSession = currentSessionCount;
  }

  setNotificationState(config.key, state);
}

/**
 * Mark a bounty winner notification as shown.
 */
export function markBountyWinnerNotificationShown(bountyId: string) {
  const key = `notif_bounty_winner_${bountyId}`;
  const state = getNotificationState(key);

  state.shows = (state.shows || 0) + 1;
  setNotificationState(key, state);
}

export function resetNotification(type: "undoStep" | "cosmetics" | "flowStateVoting") {
  const config = NOTIFICATION_CONFIG[type];
  localStorage.removeItem(config.key);
}

/**
 * Reset bounty winner notification state for a specific bounty.
 * Useful for testing or when a new bounty starts.
 */
export function resetBountyWinnerNotification(bountyId: string) {
  const key = `notif_bounty_winner_${bountyId}`;
  localStorage.removeItem(key);
}
