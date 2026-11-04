import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicBounty } from "../lib/bountyStandings";

const KEY = ["bounties"];

export async function fetchBounties(): Promise<PublicBounty[]> {
  const res = await fetch("/api/bounties");
  if (!res.ok) throw new Error(`Bounties API returned ${res.status}`);
  return ((await res.json()) as { bounties: PublicBounty[] }).bounties;
}

/**
 * Every bounty with its public standings (see /api/bounties). Refreshes every 30s while one is
 * live, and once more just after a live bounty's end time, so the page switches from live
 * standings to the five winners without a reload.
 */
export function useBounties() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: fetchBounties,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "live") ? 30_000 : false),
    staleTime: 15_000,
    retry: 1,
  });

  const nextBoundary = (query.data ?? [])
    .flatMap((b) => [b.status === "upcoming" ? b.startTime : null, b.status === "live" ? b.endTime : null])
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t))
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];

  useEffect(() => {
    if (!nextBoundary) return;
    // setTimeout can't take more than ~24.8 days; a later boundary is picked up by a later render.
    const wait = Math.min(nextBoundary - Date.now() + 2_000, 2 ** 31 - 1);
    const t = setTimeout(() => queryClient.invalidateQueries({ queryKey: KEY }), wait);
    return () => clearTimeout(t);
  }, [nextBoundary, queryClient]);

  return query;
}
