import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";

/**
 * Registers the connected wallet with the off-chain player registry so it
 * appears on the leaderboard immediately — before any on-chain username or
 * score. Fire-and-forget; never blocks the UI. Re-syncs when the on-chain
 * username becomes available so the registry can serve it during the window
 * before the subgraph indexes the UsernameSet event.
 *
 * @param username current on-chain username (empty string when unset)
 */
export function usePlayerRegistration(username?: string) {
  const { address, isConnected } = useAuth();
  // Last {address, username} pair successfully sent — avoids re-POSTing on every render.
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    if (!isConnected || !address) return;

    const name = (username ?? "").trim();
    const key = `${address.toLowerCase()}:${name}`;
    if (lastSentRef.current === key) return;
    lastSentRef.current = key;

    const controller = new AbortController();
    fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, username: name || undefined }),
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // Non-critical. If the request genuinely failed (not an intentional
      // abort), clear the marker so a later render retries.
      if (!controller.signal.aborted && lastSentRef.current === key) {
        lastSentRef.current = "";
      }
    });

    return () => controller.abort();
  }, [address, isConnected, username]);
}
