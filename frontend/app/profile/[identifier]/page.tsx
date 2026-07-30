"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/auth/AuthContext";
import { useProfileData } from "../../../src/hooks/useProfileData";
import StatCard from "../../../src/components/StatCard";
import {
  resolveIdentifier,
  formatAddress,
  getAddressInitial,
  getAvatarGradient,
  isAddress,
} from "../../../src/lib/profileUtils";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
const PRODUCTION_URL = "https://blockslide.app";

interface PageProps {
  params: {
    identifier: string;
  };
}

export default function ProfilePage({ params }: PageProps) {
  const { address: viewerAddress } = useAuth();
  const decodedIdentifier = decodeURIComponent(params.identifier);

  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [resolving, setResolving] = useState(true);

  const { player, streak, loading, error } = useProfileData(profileAddress, SUBGRAPH_URL);

  // Resolve identifier to address
  useEffect(() => {
    (async () => {
      setResolving(true);

      // If it's already an address, use it directly
      if (isAddress(decodedIdentifier)) {
        setProfileAddress(decodedIdentifier.toLowerCase());
        setNotFound(false);
      } else {
        // Query subgraph for username
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

  if (error && !player) {
    return (
      <div className="profile-not-found">
        <div className="profile-not-found__title">Couldn't load profile</div>
        <p className="profile-not-found__desc">{error}</p>
      </div>
    );
  }

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

  // Format stats
  const xp = player?.xp ? parseInt(player.xp) : 0;
  const bestScore = player?.bestScore ? parseInt(player.bestScore) : 0;
  const gamesPlayed = player?.gamesPlayed ?? 0;
  const streakCount = streak ? Number(streak) : 0;

  // Format G$ values (18 decimals)
  const formatGDollar = (wei: string | undefined): string => {
    if (!wei) return "—";
    try {
      const value = BigInt(wei);
      const divisor = BigInt(10 ** 18);
      const wholeG = value / divisor;
      const remainderG = (value % divisor) / BigInt(10 ** 16); // 2 decimal places
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

  // Feature detection: if fields don't exist, show "coming soon"
  const hasGFields = player && (player.totalGEarned !== undefined || player.totalGSpent !== undefined);

  // Generate invite link
  const refLink = `${PRODUCTION_URL}/?ref=${profileAddress}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(refLink);
      // Could show a toast here
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
      // Fallback: copy to clipboard
      await handleCopyLink();
    }
  };

  return (
    <div>
      {/* Identity header */}
      <div className="profile-header">
        <div
          className="profile-avatar"
          style={{ background: getAvatarGradient(profileAddress) }}
        >
          {getAddressInitial(profileAddress)}
        </div>

        <div className="profile-name">
          <h1 className="profile-title">
            {username ?? formatAddress(profileAddress)}
            {isVerified && <span className="profile-badge">✓ Verified</span>}
          </h1>
        </div>

        <div className="profile-address">
          <span>{formatAddress(profileAddress, 8)}</span>
          <button className="profile-address-copy" onClick={handleCopyLink}>
            Copy
          </button>
        </div>
      </div>

      {/* Stat cards grid */}
      <div className="stat-cards-grid">
        <StatCard
          label="XP"
          value={loading ? null : xp.toLocaleString()}
          loading={loading}
          error={!!error && !player}
        />
        <StatCard
          label="Best Score"
          value={loading ? null : bestScore.toLocaleString()}
          loading={loading}
          error={!!error && !player}
        />
        <StatCard
          label="Game Sessions"
          value={loading ? null : gamesPlayed}
          loading={loading}
          error={!!error && !player}
        />
        <StatCard
          label="Current Streak"
          value={loading ? null : streakCount}
          loading={loading}
          error={!!error && !streak}
        />
        <StatCard
          label="G$ Earned"
          value={loading ? null : gEarned}
          loading={loading}
          error={!!error && !player}
          comingSoon={!hasGFields && !loading && !!player}
        />
        <StatCard
          label="G$ Spent"
          value={loading ? null : gSpent}
          loading={loading}
          error={!!error && !player}
          comingSoon={!hasGFields && !loading && !!player}
        />
      </div>

      {/* Invite block - only show for own profile */}
      {isOwnProfile && (
        <div className="invite-block">
          <h2 className="invite-block__title">Invite friends</h2>
          <p className="invite-block__copy">
            Share your link and grow the BlockSlide community. Earn rewards when your friends join.
          </p>

          <div className="invite-link-group">
            <div className="invite-link-input">{refLink}</div>
            <button className="invite-link-copy-btn" onClick={handleCopyLink}>
              Copy
            </button>
          </div>

          <button className="invite-share-btn" onClick={handleShareLink}>
            Share invite
          </button>

          <div className="invite-referral-count">
            Referral tracking coming soon
          </div>
        </div>
      )}
    </div>
  );
}
