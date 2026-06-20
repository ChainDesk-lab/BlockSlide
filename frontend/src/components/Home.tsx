import DailyClaim from "./DailyClaim";
import { BoltIcon, FlameIcon, GamepadIcon, TrophyIcon } from "./icons";

interface HomeProps {
  onPlay: () => void;
  onLeaderboard: () => void;
}

const FEATURES = [
  {
    Icon: TrophyIcon,
    title: "Climb the leaderboard",
    text: "Your best scores are recorded on-chain for everyone to chase.",
  },
  {
    Icon: GamepadIcon,
    title: "On-chain play",
    text: "Start a verified session and submit your score straight to the chain.",
  },
  {
    Icon: FlameIcon,
    title: "Daily streaks",
    text: "Play every day to build a streak — protect it with a shield from the shop.",
  },
  {
    Icon: BoltIcon,
    title: "XP & boosts",
    text: "Earn XP from every game and multiply it with 2× / 5× boosts.",
  },
];

export default function Home({ onPlay, onLeaderboard }: HomeProps) {
  return (
    <div className="home">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="hero">
        <span className="hero__badge">2048 · on-chain · Celo</span>
        <h1 className="hero__title">BlockSlide</h1>
        <p className="hero__tagline">
          The classic 2048, reimagined on Celo. Slide tiles, build your streak,
          and climb the on-chain leaderboard.
        </p>
        <div className="hero__cta">
          <button className="btn btn--primary" onClick={onPlay}>
            Play Now
          </button>
          <button className="btn btn--ghost" onClick={onLeaderboard}>
            View Leaderboard
          </button>
        </div>
      </section>

      {/* ── Daily G$ claim ────────────────────────────────────────────────── */}
      <DailyClaim />

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="features">
        {FEATURES.map(({ Icon, title, text }) => (
          <div className="feature-card" key={title}>
            <span className="feature-card__icon">
              <Icon size={22} />
            </span>
            <h3 className="feature-card__title">{title}</h3>
            <p className="feature-card__text">{text}</p>
          </div>
        ))}
      </section>

    </div>
  );
}
