/**
 * The address | connector | chain readout in the bottom corner is a support tool, not product
 * UI. It shows in development, and in production only when asked for: open any page with
 * `?debug=1` (remembered on that device) and `?debug=0` to turn it off again.
 */
export const DIAGNOSTICS_STORAGE_KEY = "bs_debug";

export function diagnosticsEnabled(nodeEnv: string | undefined, search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get("debug");
  if (param === "1") return true;
  if (param === "0") return false;
  if (stored === "1") return true;
  return nodeEnv !== "production";
}

/** What to remember after reading `?debug=`: "1", "0" (forget), or null for no change. */
export function diagnosticsPreference(search: string): "1" | "0" | null {
  const param = new URLSearchParams(search).get("debug");
  return param === "1" || param === "0" ? param : null;
}
