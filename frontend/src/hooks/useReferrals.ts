import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSigner } from "./useSigner";
import { inviteListMessage } from "../lib/referrals";

/** Invite counts change when someone signs in or starts a game; a minute keeps them current. */
const REFRESH_MS = 60_000;

export interface InviteCounts { address: string; joined: number; played: number | null }
export interface TopInviter { address: string; username: string | null; joined: number; played: number | null }
export interface TopInviters { top: TopInviter[]; totals: { inviters: number; joined: number; played: number | null }; updatedAt: string }
export interface Invitee { address: string; username: string | null; joinedAt: string; played: boolean | null }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

/** One player's public counts. */
export function useInviteCounts(address: string | null) {
  return useQuery({
    queryKey: ["invite-counts", address?.toLowerCase()],
    queryFn: () => getJson<InviteCounts>(`/api/referrals?address=${address}`),
    enabled: !!address,
    refetchInterval: REFRESH_MS,
  });
}

export function useTopInviters() {
  return useQuery({ queryKey: ["invite-top"], queryFn: () => getJson<TopInviters>("/api/referrals"), refetchInterval: REFRESH_MS });
}

export type MyInviteesState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "loading" }
  | { status: "shown"; invitees: Invitee[] }
  | { status: "error"; message: string };

/**
 * The players this wallet invited. The server shows them only to the inviter, so `load` asks the
 * wallet to sign a message first (free: no transaction, no gas).
 */
export function useMyInvitees(address: string | null) {
  const { signer } = useSigner();
  const [state, setState] = useState<MyInviteesState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!address) return;
    if (!signer?.account) { setState({ status: "error", message: "Your wallet isn't ready yet. Try again in a moment." }); return; }
    const issuedAt = new Date().toISOString();
    setState({ status: "signing" });
    let signature: string;
    try {
      signature = await signer.signMessage({ account: signer.account, message: inviteListMessage(address, issuedAt) });
    } catch {
      setState({ status: "idle" }); // declined in the wallet: nothing to report
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, issuedAt, signature }),
      });
      const json = (await res.json().catch(() => ({}))) as { invitees?: Invitee[]; message?: string };
      if (!res.ok || !json.invitees) throw new Error(json.message ?? "Couldn't load your invited players. Please try again.");
      setState({ status: "shown", invitees: json.invitees });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Couldn't load your invited players. Please try again." });
    }
  }, [address, signer]);

  return { state, load, hide: () => setState({ status: "idle" }) };
}
