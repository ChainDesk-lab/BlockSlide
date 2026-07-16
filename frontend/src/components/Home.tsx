import ClaimUBI from "./ClaimUBI";
import { FlameIcon, GamepadIcon, TrophyIcon } from "./icons";
import { IconBadge } from "./IconBadge";

interface HomeProps {
  onPlay: () => void;
  onLeaderboard: () => void;
}

const FEATURES = [
  {
    Icon: GamepadIcon,
    title: "Classic Puzzle",
    text: "The 2048 you know. Slide tiles, merge numbers, reach 2048.",
  },
  {
    Icon: TrophyIcon,
    title: "On-Chain Leaderboard",
    text: "Your scores live forever on Celo. Climb the ranks.",
  },
  {
    Icon: FlameIcon,
    title: "Daily Streaks & Boosts",
    text: "Build streaks, protect them with shields, multiply XP with boosts.",
  },
];

export default function Home({ onPlay, onLeaderboard }: HomeProps) {
  return (
    <div className="home">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__inner">
          <span className="hero__badge">BlockSlide</span>
          <h1 className="hero__title">The 2048 of Tomorrow</h1>
          <p className="hero__tagline">
            Classic puzzle game, on-chain forever. Slide tiles, build streaks,
            compete on the leaderboard.
          </p>

          {/* ── CTAs ──────────────────────────────────────────────────────── */}
          <div className="hero__cta">
            <button className="btn btn--primary" onClick={onPlay}>
              Play Now
            </button>
            <button className="btn btn--ghost" onClick={onLeaderboard}>
              View Leaderboard
            </button>
          </div>

          {/* ── Daily Claim (compact, inline) ───────────────────────────── */}
          <div className="hero__claim">
            <ClaimUBI />
          </div>
        </div>
      </section>

      {/* ── Spacer ─────────────────────────────────────────────────────────── */}
      <div className="hero__spacer" />

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="features">
        <h2 className="features__title">Why BlockSlide?</h2>
        <div className="features__grid">
          {FEATURES.map(({ Icon, title, text }) => (
            <div className="feature-card" key={title}>
              <IconBadge icon={<Icon size={24} />} size="md" />
              <h3 className="feature-card__title">{title}</h3>
              <p className="feature-card__text">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
