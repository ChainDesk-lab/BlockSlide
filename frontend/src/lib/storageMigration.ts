/**
 * Storage key migration: Maps old localStorage keys to new unified storage format.
 * Runs once per session to migrate user data from old format to new format.
 *
 * CRITICAL: Handles two cases:
 * 1. User never logged in during buggy window: old key has data, new key doesn't exist → migrate
 * 2. User logged in during buggy window: both keys exist → new key has post-bug data, skip migration
 *
 * Old format: `blockslide_${type}_${optional_address}`
 * New format: `bs_device_${key}` or `bs_user_${address}_${key}`
 */

import { setDeviceStorage, setUserStorage, getDeviceStorage, getUserStorage } from "./unifiedStorage";

interface OldKeyMapping {
  oldKey: string | ((addr?: string) => string);
  newKey: string | ((addr?: string) => string);
  isDevice: boolean;
}

const KEY_MAPPINGS: OldKeyMapping[] = [
  // Device-level (same for all addresses)
  { oldKey: "blockslide-theme", newKey: "theme", isDevice: true },
  { oldKey: "blockslide_sound", newKey: "sound", isDevice: true },
  { oldKey: "blockslide_seen_htp", newKey: "seen_htp", isDevice: true },
  { oldKey: "blockslide_gd_claim_visited", newKey: "gd_claim_visited", isDevice: true },

  // User-level (specific to each address)
  { oldKey: (addr) => `blockslide_game_${addr?.toLowerCase()}`, newKey: "game_state", isDevice: false },
  { oldKey: (addr) => `blockslide_verified_${addr?.toLowerCase()}`, newKey: "identity_verified", isDevice: false },
  { oldKey: (addr) => `blockslide_fv_pending_${addr?.toLowerCase()}`, newKey: "identity_pending", isDevice: false },
  { oldKey: (addr) => `blockslide_session_seed_${addr?.toLowerCase()}`, newKey: "session_seed", isDevice: false },
  { oldKey: (addr) => `blockslide_username_dismissed_${addr?.toLowerCase()}`, newKey: "username_modal_dismissed", isDevice: false },
];

/**
 * Migrate all old storage keys to new unified format.
 * Safe to call multiple times (idempotent).
 *
 * CRITICAL: Only migrates if new key doesn't already exist (safe fallback for overlap window).
 * If both old and new keys exist, the new key is assumed to contain post-bug data and is preserved.
 */
export function migrateStorageKeys(address?: string): void {
  if (typeof window === "undefined") return;

  const migrationLog: string[] = [];
  const overlapCases: string[] = []; // Track users who may have lost post-bug data

  try {
    for (const mapping of KEY_MAPPINGS) {
      // Get old key name
      const oldKeyName = typeof mapping.oldKey === "function" ? mapping.oldKey(address) : mapping.oldKey;
      if (!oldKeyName) continue;

      // Get new key name
      const newKeyName = typeof mapping.newKey === "function" ? mapping.newKey(address) : mapping.newKey;

      // Get value from old storage
      const oldValue = localStorage.getItem(oldKeyName);
      if (!oldValue) continue; // Nothing to migrate

      // CRITICAL: Check if new key already exists
      const newValue = mapping.isDevice
        ? getDeviceStorage(newKeyName)
        : getUserStorage(address, newKeyName);

      if (newValue) {
        // Both old and new keys exist = user logged in during buggy window
        // New key contains post-bug data, don't overwrite it
        overlapCases.push(`${newKeyName} (has post-bug data, skipping migrate from ${oldKeyName})`);
        continue;
      }

      // Safe to migrate: new key doesn't exist, old key has data
      try {
        // Write to new storage
        if (mapping.isDevice) {
          setDeviceStorage(newKeyName, oldValue);
        } else {
          setUserStorage(address, newKeyName, oldValue);
        }

        // VERIFY write succeeded before deleting old key
        const verifyNewValue = mapping.isDevice
          ? getDeviceStorage(newKeyName)
          : getUserStorage(address, newKeyName);

        if (verifyNewValue === oldValue) {
          // Write verified successful, safe to delete old key
          localStorage.removeItem(oldKeyName);
          migrationLog.push(`✅ Migrated ${oldKeyName} → ${newKeyName}`);
        } else {
          // Write failed or stored different value, don't delete old key
          migrationLog.push(`⚠️  Write verification failed for ${newKeyName}, kept ${oldKeyName}`);
        }
      } catch (err) {
        migrationLog.push(`❌ Failed to migrate ${oldKeyName}: ${err}`);
      }
    }

    if (migrationLog.length > 0 || overlapCases.length > 0) {
      console.log("🔄 Storage Migration Report:", migrationLog);
      if (overlapCases.length > 0) {
        console.warn("⚠️  Overlap window detected (buggy 2026-07-20 to 2026-07-27):", overlapCases);
        console.warn("📝 User may have progress in new keys that wasn't recovered from old keys");
      }
    }
  } catch (err) {
    console.error("Storage migration error:", err);
  }
}

/**
 * Find all user addresses that have old-format storage keys (for diagnostics).
 * Returns array of addresses that have orphaned data.
 */
export function findAddressesWithOldKeys(): string[] {
  if (typeof window === "undefined") return [];

  const addresses = new Set<string>();
  const oldKeyPatterns = [
    /^blockslide_game_(0x[a-fA-F0-9]{40})$/,
    /^blockslide_verified_(0x[a-fA-F0-9]{40})$/,
    /^blockslide_fv_pending_(0x[a-fA-F0-9]{40})$/,
    /^blockslide_session_seed_(0x[a-fA-F0-9]{40})$/,
    /^blockslide_username_dismissed_(0x[a-fA-F0-9]{40})$/,
  ];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      for (const pattern of oldKeyPatterns) {
        const match = key.match(pattern);
        if (match) {
          addresses.add(match[1]);
          break;
        }
      }
    }
  } catch (err) {
    console.error("Error finding old storage keys:", err);
  }

  return Array.from(addresses);
}
