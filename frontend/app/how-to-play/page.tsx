"use client";

import Link from "next/link";
import { howToPlaySections } from "../../src/config/howToPlay";
import "../../src/styles/how-to-play.css";

export default function HowToPlayPage() {
  return (
    <div className="how-to-play">
      <div className="how-to-play__header">
        <h1 className="how-to-play__title">How to Play BlockSlide</h1>
        <p className="how-to-play__subtitle">
          Master the game, earn rewards, climb the leaderboard
        </p>
      </div>

      {/* Table of contents */}
      <nav className="how-to-play__toc">
        <h2 className="how-to-play__toc-title">Quick Navigation</h2>
        <ul className="how-to-play__toc-list">
          {howToPlaySections.map((section) => (
            <li key={section.id} className="how-to-play__toc-item">
              <a href={`#${section.id}`} className="how-to-play__toc-link">
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content sections */}
      <div className="how-to-play__content">
        {howToPlaySections.map((section) => (
          <section key={section.id} id={section.id} className="how-to-play__section">
            <h2 className="how-to-play__section-title">{section.title}</h2>
            <div className="how-to-play__section-body">
              {section.body.split("\n\n").map((paragraph, idx) => (
                <p key={idx} className="how-to-play__text">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Bounties link */}
      <div className="how-to-play__cta">
        <Link href="/bounty" className="how-to-play__cta-link">
          View Active Bounties →
        </Link>
      </div>
    </div>
  );
}
