import { useState } from "react";

const SLIDES = [
  {
    title: "Controls",
    text: "Use arrow keys, WASD, or swipe on mobile to slide all tiles in one direction. When two tiles with the same number collide, they merge into one and their values combine.",
  },
  {
    title: "The Goal",
    text: "Keep merging tiles to build higher numbers and reach 2048. Every merge adds to your score. The game ends when the board is full and no moves remain.",
  },
  {
    title: "XP and Combos",
    text: "Every completed game earns XP equal to your score divided by 10. Chain 5 consecutive merging moves in a single game to earn 5 times the XP for that session.",
  },
  {
    title: "The Shop",
    text: "Spend G$ in the shop on Streak Shields, which save your daily play streak if you miss a day, and XP Boosts that multiply all XP you earn for the next 24 hours.",
  },
  {
    title: "Verification",
    text: "Complete GoodDollar face verification once to unlock on-chain score submission and G$ rewards. You can play in demo mode at any time without it.",
  },
];

interface Props {
  onClose: () => void;
}

export default function HowToPlay({ onClose }: Props) {
  const [index, setIndex]       = useState(0);
  const [direction, setDir]     = useState<"forward" | "back">("forward");
  const [animKey, setAnimKey]   = useState(0);

  const goTo = (next: number, dir: "forward" | "back") => {
    setDir(dir);
    setIndex(next);
    setAnimKey((k) => k + 1);
  };

  const prev = () => { if (index > 0) goTo(index - 1, "back"); };
  const next = () => {
    if (index < SLIDES.length - 1) goTo(index + 1, "forward");
    else onClose();
  };

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <div
      className="htp-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <div className="htp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="htp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <p className="htp-label">How to play</p>

        {/* Slide content */}
        <div
          key={animKey}
          className={`htp-slide htp-slide--${direction}`}
        >
          <h2 className="htp-slide__title">{slide.title}</h2>
          <p className="htp-slide__text">{slide.text}</p>
        </div>

        {/* Dot indicators */}
        <div className="htp-dots" role="tablist">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`htp-dot${i === index ? " htp-dot--active" : ""}`}
              onClick={() => goTo(i, i > index ? "forward" : "back")}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="htp-nav">
          <button
            className="btn htp-nav__btn htp-nav__btn--prev"
            onClick={prev}
            disabled={index === 0}
          >
            Back
          </button>
          <button
            className={`btn htp-nav__btn htp-nav__btn--next${isLast ? " btn--primary" : ""}`}
            onClick={next}
          >
            {isLast ? "Start playing" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
