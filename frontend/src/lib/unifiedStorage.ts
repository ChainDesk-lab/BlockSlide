/**
 * Unified storage layer that provides consistent experience across devices and signup methods.
 *
 * Uses device-level storage for app state that should be consistent regardless of which
 * wallet/auth method the user chooses, while maintaining address-specific storage for
 * user-specific wallet data (scores, identity verification).
 */

export interface StorageConfig {
  /** Device-level (global): settings, theme, dismissed modals */
  deviceLevel: Record<string, string>;
  /** User-level (per-address): game state, identity, session data */
  userLevel: Record<string, Record<string, string>>;
}

const DEVICE_STORAGE_PREFIX = "bs_device_";
const USER_STORAGE_PREFIX = "bs_user_";

/**
 * Get device-level storage key (consistent across all addresses on this device)
 */
export function getDeviceKey(key: string): string {
  return `${DEVICE_STORAGE_PREFIX}${key}`;
}

/**
 * Get user-level storage key (specific to wallet address)
 */
export function getUserKey(address: string | undefined, key: string): string {
  if (!address) return "";
  return `${USER_STORAGE_PREFIX}${address.toLowerCase()}_${key}`;
}

/**
 * Read from device-level storage (works across all wallets on this device)
 */
export function getDeviceStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(getDeviceKey(key));
  } catch {
    return null;
  }
}

/**
 * Write to device-level storage (persists across wallet switches)
 */
export function setDeviceStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getDeviceKey(key), value);
  } catch {
    // Storage might be full or unavailable (incognito mode)
  }
}

/**
 * Remove from device-level storage
 */
export function removeDeviceStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getDeviceKey(key));
  } catch {
    // Storage might be unavailable
  }
}

/**
 * Read from user-level storage (specific to connected wallet)
 */
export function getUserStorage(address: string | undefined, key: string): string | null {
  if (typeof window === "undefined" || !address) return null;
  try {
    return localStorage.getItem(getUserKey(address, key));
  } catch {
    return null;
  }
}

/**
 * Write to user-level storage (specific to connected wallet)
 */
export function setUserStorage(address: string | undefined, key: string, value: string): void {
  if (typeof window === "undefined" || !address) return;
  try {
    localStorage.setItem(getUserKey(address, key), value);
  } catch {
    // Storage might be full or unavailable
  }
}

/**
 * Remove from user-level storage
 */
export function removeUserStorage(address: string | undefined, key: string): void {
  if (typeof window === "undefined" || !address) return;
  try {
    localStorage.removeItem(getUserKey(address, key));
  } catch {
    // Storage might be unavailable
  }
}

/**
 * Clear all user-level storage for the current address when logging out
 */
export function clearUserStorageForAddress(address: string | undefined): void {
  if (typeof window === "undefined" || !address) return;
  try {
    const prefix = `${USER_STORAGE_PREFIX}${address.toLowerCase()}_`;
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
    keys.forEach(key => localStorage.removeItem(key));
  } catch {
    // Storage might be unavailable
  }
}
