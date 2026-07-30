import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { isAddress } from "../lib/profileUtils";

const REF_STORAGE_KEY = "pendingReferrer";

/**
 * Captures ?ref=<address> query parameter on app load
 * Stores it in localStorage for Phase 3 (registerReferrer) to consume
 * Only stores if:
 * - No referrer is already stored
 * - The value is a valid address
 * - The value is not the user's own address (once known)
 */
export function useRefCapture() {
  const { address } = useAuth();

  useEffect(() => {
    // Only run on client, once per app load
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");

    if (!ref) return;

    // Check if already stored
    const existing = localStorage.getItem(`bs_device_${REF_STORAGE_KEY}`);
    if (existing) return;

    // Validate it's an address
    if (!isAddress(ref)) return;

    const refLower = ref.toLowerCase();

    // Don't allow self-referral once we know the user's address
    if (address && address.toLowerCase() === refLower) return;

    // Store it
    localStorage.setItem(`bs_device_${REF_STORAGE_KEY}`, refLower);
  }, [address]);
}

/**
 * Get the stored pending referrer address
 */
export function getPendingReferrer(): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(`bs_device_${REF_STORAGE_KEY}`);
  return stored && isAddress(stored) ? stored : null;
}

/**
 * Clear the stored pending referrer (call after successful registerReferrer)
 */
export function clearPendingReferrer(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`bs_device_${REF_STORAGE_KEY}`);
}
