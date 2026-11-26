import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSigner } from "./useSigner";
import { inviteListMessage, payoutRequestMessage, type PayoutStatus } from "../lib/referrals";

/** Invite counts change when someone signs in or starts a game; a minute keeps them current. */
const REFRESH_MS = 60_000;

export interface PayoutSummary {
  rewardPerReferralG: number;
  minReferrals: number;
  minAmountG: number;
  /** Referrals that have played, are verified and aren't in a pending or paid request. */
  available: number;
  availableAmountG: number;
  pending: { id: string; count: number; amountG: number; createdAt: number } | null;
  paid: { count: number; amountG: number };
  lastDecision: { status: PayoutStatus; count: number; amountG: number; decidedAt: number | null } | null;
}
export interface InviteCounts {
  address: string;
  joined: number;
  played: number | null;
  verified: number | null;
  /** Played AND verified. */
  eligible: number | null;
  payout: PayoutSummary;
}
export interface TopInviter { address: string; username: string | null; joined: number; played: number | null; verified: number | null }
export interface TopInviters {
  top: TopInviter[];
  totals: { inviters: number; joined: number; played: number | null; verified: number | null };
  updatedAt: string;
}
/** Private to the inviter (signed): details of their latest decided payment request. */
export interface PayoutDetails { status: PayoutStatus; payTo: string; txHash: string | null; note: string | null; decidedAt: number | null }
export interface Invitee {
  address: string; username: string | null; joinedAt: string;
  played: boolean | null; verified: boolean | null; payout: PayoutStatus | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

const countsKey = (address: string | null) => ["invite-counts", address?.toLowerCase()];

/** One player's public counts and payment status. */
export function useInviteCounts(address: string | null) {
  return useQuery({
    queryKey: countsKey(address),
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
  | { status: "shown"; invitees: Invitee[]; lastDecision: PayoutDetails | null }
  | { status: "error"; message: string };

/** A wallet's "no" (the player cancelled) as opposed to a wallet or connection problem. */
export function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; name?: string; message?: string; cause?: { code?: number } } | null;
  return err?.code === 4001 || err?.cause?.code === 4001 || err?.name === "UserRejectedRequestError"
    || /user (rejected|denied|cancel)|rejected the request|request rejected|cancelled|canceled/i.test(err?.message ?? "");
}
const SIGN_FAILED = "Your wallet couldn't sign. Check it's unlocked and connected, then try again.";

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
    } catch (e) {
      setState(isUserRejection(e) ? { status: "idle" } : { status: "error", message: SIGN_FAILED });
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, issuedAt, signature }),
      });
      const json = (await res.json().catch(() => ({}))) as { invitees?: Invitee[]; lastDecision?: PayoutDetails | null; message?: string };
      if (!res.ok || !json.invitees) throw new Error(json.message ?? "Couldn't load your invited players. Please try again.");
      setState({ status: "shown", invitees: json.invitees, lastDecision: json.lastDecision ?? null });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Couldn't load your invited players. Please try again." });
    }
  }, [address, signer]);

  return { state, load, hide: () => setState({ status: "idle" }) };
}

export type PayoutRequestState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "sending" }
  | { status: "sent"; amountG: number; count: number; payTo: string }
  | { status: "error"; message: string };

/**
 * Requests payment for the player's referrals. The wallet signs a message naming the payout wallet
 * (free: no transaction, no gas); the server decides the amount and tells the owner.
 */
export function useRequestPayout(address: string | null) {
  const { signer } = useSigner();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PayoutRequestState>({ status: "idle" });

  const request = useCallback(async (payTo: string) => {
    if (!address) return;
    if (!signer?.account) { setState({ status: "error", message: "Your wallet isn't ready yet. Try again in a moment." }); return; }
    const issuedAt = new Date().toISOString();
    setState({ status: "signing" });
    let signature: string;
    try {
      signature = await signer.signMessage({ account: signer.account, message: payoutRequestMessage(address, payTo, issuedAt) });
    } catch (e) {
      setState(isUserRejection(e) ? { status: "idle" } : { status: "error", message: SIGN_FAILED });
      return;
    }
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/referrals/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, payTo, issuedAt, signature }),
      });
      const json = (await res.json().catch(() => ({}))) as { request?: { amountG: number; count: number; payTo: string }; message?: string };
      if (!res.ok || !json.request) throw new Error(json.message ?? "Couldn't send your request. Please try again.");
      setState({ status: "sent", amountG: json.request.amountG, count: json.request.count, payTo: json.request.payTo });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Couldn't send your request. Please try again." });
    } finally {
      queryClient.invalidateQueries({ queryKey: countsKey(address) });
    }
  }, [address, signer, queryClient]);

  return { state, request, reset: () => setState({ status: "idle" }) };
}
