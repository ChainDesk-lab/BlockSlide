"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../src/auth/AuthContext";
import { useProfileData } from "../../../src/hooks/useProfileData";
import { useUbiContribution } from "../../../src/hooks/useUbiContribution";
import { ubiStat } from "../../../src/lib/ubiProfile";
import { useLeaderboardTop } from "../../../src/hooks/useLeaderboardTop";
import StatCard from "../../../src/components/StatCard";
import UsernameModal from "../../../src/components/UsernameModal";
import { InviteCard, ProfileHeader, ProfileLayout, ProfileStat, RunHistoryCard } from "../../../src/components/ProfilePanels";
import { SOLVE_TIME_STAT, countStat, rankStat, referralNote } from "../../../src/lib/profileState";
import { resolveIdentifier, isAddress } from "../../../src/lib/profileUtils";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
const PRODUCTION_URL = "https://blockslide.app";

export default function ProfileView({ identifier }: { identifier: string }) {
  // Get viewer's current address (safely, using try-catch for context errors)
  let viewerAddress: string | undefined;
  try {
    const auth = useAuth();
    viewerAddress = auth.address;
  } catch {
    viewerAddress = undefined;
  }

  const decodedIdentifier = decodeURIComponent(identifier);

  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [resolving, setResolving] = useState(true);

  const { player, streak, loading, coreLoading, streakLoading, gdollarLoading, ubi, error } = useProfileData(profileAddress, SUBGRAPH_URL);
  // The contract's own rate words the UBI caption; before the UBI upgrade it reads as unavailable.
  const ubiRate = useUbiContribution();
  // Rank: the same first leaderboard page the play and leaderboard screens use (no per-wallet lookup exists).
  const standing = useLeaderboardTop(profileAddress);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<"address" | "link" | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const flashCopied = useCallback((what: "address" | "link") => {
    setCopied(what);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  }, []);
  // A saved username changes the core profile row: read it again when the editor closes.
  const closeEditor = useCallback(() => {
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["profile-player-core", profileAddress] });
  }, [queryClient, profileAddress]);

  useEffect(() => {
    (async () => {
      setResolving(true);

      if (isAddress(decodedIdentifier)) {
        setProfileAddress(decodedIdentifier.toLowerCase());
        setNotFound(false);
      } else {
        const result = await resolveIdentifier(decodedIdentifier, SUBGRAPH_URL);
        if (result?.found && result.address) {
          setProfileAddress(result.address);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      }

      setResolving(false);
    })();
  }, [decodedIdentifier]);

  const isOwnProfile = viewerAddress && profileAddress && viewerAddress.toLowerCase() === profileAddress.toLowerCase();

  if (resolving) {
    return (
      <div className="profile-not-found">
        <div className="profile-not-found__title">Loading...</div>
      </div>
    );
  }

  if (notFound || !profileAddress) {
    return (
      <div className="profile-not-found">
        <div className="profile-not-found__title">Player not found</div>
        <p className="profile-not-found__desc">
          We couldn't find a player with the username or address "{decodedIdentifier}".
        </p>
      </div>
    );
  }

  // Page-level error: only if CORE query fails after we have an address to query.
  // Never shown if player loaded, even if secondary sources (G$, streak) fail.
  if (error && !player && !coreLoading) {
    return (
      <div className="profile-not-found">
        <div className="profile-not-found__title">Couldn't load profile</div>
        <p className="profile-not-found__desc">{error}</p>
      </div>
    );
  }

  // Player not found in subgraph (core query succeeded but returned no data)
  if (!loading && !player) {
    return (
      <div className="profile-not-found">
        <div className="profile-not-found__title">Player not found</div>
        <p className="profile-not-found__desc">This player hasn't joined BlockSlide yet.</p>
      </div>
    );
  }

  const username = player?.username || null;
  const isVerified = player?.isVerified ?? false;

  const xp = player?.xp ? parseInt(player.xp) : 0;
  const bestScore = player?.bestScore ? parseInt(player.bestScore) : 0;
  const gamesPlayed = player?.gamesPlayed ?? 0;
  const streakCount = streak ? Number(streak) : 0;

  const formatGDollar = (wei: string | undefined): string => {
    if (!wei) return "—";
    try {
      const value = BigInt(wei);
      const divisor = BigInt(10 ** 18);
      const wholeG = value / divisor;
      const remainderG = (value % divisor) / BigInt(10 ** 16);
      if (remainderG === 0n) {
        return wholeG.toString();
      }
      return `${wholeG}.${remainderG.toString().padStart(2, "0")}`;
    } catch {
      return "—";
    }
  };

  const gEarned = player?.totalGEarned ? formatGDollar(player.totalGEarned) : null;
  const gSpent = player?.totalGSpent ? formatGDollar(player.totalGSpent) : null;
  const referralCount = player?.referralCount ? parseInt(player.referralCount) : 0;

  const ubiCard = ubiStat({ rate: ubiRate, totals: ubi });

  const hasGFields = player && (player.totalGEarned !== undefined || player.totalGSpent !== undefined);
  const hasReferralFields = player && player.referralCount !== undefined;

  const refLink = `${PRODUCTION_URL}/?ref=${profileAddress}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(refLink);
      flashCopied("link");
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(profileAddress);
      flashCopied("address");
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${username ? `${username} on` : ""} BlockSlide`,
          text: "Join me in playing BlockSlide — 2048 onchain with G$ rewards!",
          url: refLink,
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      await handleCopyLink();
    }
  };

  const coreError = !!error && !player;
  const referral = hasReferralFields
    ? referralNote(referralCount)
    : !loading ? referralNote(null) : null;

  return (
    <ProfileLayout>
      <ProfileHeader
        address={profileAddress}
        username={username}
        verified={isVerified}
        isOwn={!!isOwnProfile}
        copied={copied === "address"}
        onCopyAddress={handleCopyAddress}
        onEdit={() => setEditing(true)}
      />

      <div className="profile2__stats">
        <ProfileStat label="Current Rank" stat={rankStat({ loading: standing.isLoading, error: standing.isError, rank: standing.rank, pageSize: standing.pageSize })} />
        <ProfileStat label="Personal Best" stat={coreLoading ? null : countStat(coreError ? null : bestScore, "High score record") ?? { value: "Unavailable", note: "Profile can't be read right now", tone: "empty" }} />
        <ProfileStat label="Best Solve Time" stat={SOLVE_TIME_STAT} />
        <ProfileStat label="Games Played" stat={coreLoading ? null : countStat(coreError ? null : gamesPlayed, "Total career runs") ?? { value: "Unavailable", note: "Profile can't be read right now", tone: "empty" }} />
      </div>

      {/* The other figures the profile has always shown, kept below the designed four. */}
      <div className="profile2__more stat-cards-grid">
        <StatCard label="XP" value={coreLoading ? null : xp.toLocaleString()} loading={coreLoading} error={coreError} />
        <StatCard label="Current Streak" value={streakLoading ? null : streakCount} loading={streakLoading} error={false} />
        <StatCard
          label="G$ Earned"
          value={gdollarLoading ? null : gEarned}
          loading={gdollarLoading}
          error={false}
          comingSoon={!hasGFields && !gdollarLoading && !!player}
        />
        <StatCard
          label="G$ Spent"
          value={gdollarLoading ? null : gSpent}
          loading={gdollarLoading}
          error={false}
          comingSoon={!hasGFields && !gdollarLoading && !!player}
        />
        <StatCard
          label="UBI contributed"
          value={ubiCard.state === "shown" ? ubiCard.value : null}
          loading={ubiCard.state === "loading"}
          note={ubiCard.state === "shown" ? ubiCard.note : undefined}
          muted={ubiCard.state === "shown" && ubiCard.muted}
          title={ubiCard.state === "shown" ? ubiCard.title : undefined}
        />
      </div>

      <div className={`profile2__body ${isOwnProfile ? "" : "profile2__body--single"}`}>
        <RunHistoryCard />
        {isOwnProfile && (
          <InviteCard
            refLink={refLink}
            copied={copied === "link"}
            referral={referral}
            onCopy={handleCopyLink}
            onShare={handleShareLink}
          />
        )}
      </div>

      {editing && isOwnProfile && <UsernameModal onClose={closeEditor} />}
    </ProfileLayout>
  );
}
