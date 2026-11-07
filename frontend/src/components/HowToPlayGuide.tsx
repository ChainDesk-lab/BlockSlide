import Link from "next/link";
import type { ReactNode } from "react";
import { COMMUNITY, CONTROLS, GUIDE_SECTIONS, RULES } from "../config/howToPlay";

/**
 * How to Play (Figma frame 6). Presentational: the page passes live prices and the bounty
 * state. Every rule stated here comes from RULES (see config/howToPlay.ts for its source).
 */

export interface GuidePrices { shield: string; boost2x: string; boost5x: string; undo: string }

const num = (i: number) => String(i + 1).padStart(2, "0");

/** GoodDollar's identity contract (game.identity(), 0xC361…2F42): authenticationPeriod() = 180 days. Set by GoodDollar, not by us. */
const GD_REVERIFY_DAYS = 180;

function Section({ index, children, lede }: { index: number; children: ReactNode; lede?: ReactNode }) {
  const s = GUIDE_SECTIONS[index];
  return (
    <section id={s.id} className="htp2__section card" aria-labelledby={`${s.id}-title`}>
      <h2 id={`${s.id}-title`} className="htp2__section-title">
        <span className="htp2__num" aria-hidden="true">{num(index)}</span>
        {s.title}
      </h2>
      {lede && <p className="htp2__lede">{lede}</p>}
      {children}
    </section>
  );
}

function Fact({ label, value, note, tone = "brand" }: { label: string; value: ReactNode; note?: ReactNode; tone?: "brand" | "green" }) {
  return (
    <div className="htp2__fact">
      <p className="kicker">{label}</p>
      <p className={`htp2__fact-value htp2__fact-value--${tone}`}>{value}</p>
      {note && <p className="htp2__fact-note">{note}</p>}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="htp2__note">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function Tile({ v }: { v: number | null }) {
  if (v === null) return <span className="htp2__cell" />;
  return <span className="htp2__cell htp2__cell--tile" style={{ background: `var(--t${v})`, color: `var(--t${v}-fg)` }}>{v}</span>;
}

/** Decorative: an example position, not a real game. */
const EXAMPLE_BOARD: (number | null)[] = [2, null, null, null, 2, 4, null, null, 4, 8, 2, null, 8, 16, 4, 2];

export function GuideNav({ activeId, onNavigate }: { activeId: string; onNavigate?: (id: string) => void }) {
  return (
    <nav className="htp2__nav card" aria-label="Quick navigation">
      <p className="kicker htp2__nav-title">Quick navigation</p>
      <ol>
        {GUIDE_SECTIONS.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={`htp2__nav-link ${activeId === s.id ? "htp2__nav-link--active" : ""}`}
              aria-current={activeId === s.id ? "location" : undefined}
              onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(s.id); } : undefined}
            >
              <span className="htp2__nav-num">{num(i)}</span>
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function GuideContent({ prices, undoEnabled, bountyStatus }: {
  prices: GuidePrices;
  undoEnabled: boolean;
  /** "live" | "upcoming" | "ended": the state of the current bounty, from the bounty config. */
  bountyStatus: "live" | "upcoming" | "ended";
}) {
  const [m256, m512, m1024, m2048] = RULES.milestones;
  return (
    <div className="htp2__content">
      <Section index={0} lede={<>BlockSlide is a 2048 puzzle game on the Celo blockchain. Merge tiles, build your score and compete with players around the world. Every game you submit is recorded on-chain.</>}>
        <div className="htp2__grid htp2__grid--3">
          <Fact label="Play" value="2048 on Celo" note="A classic merging puzzle with your results recorded on-chain." />
          <Fact label="Progress" value="Earn XP" note="Every submitted game adds XP and counts toward your daily streak." />
          <Fact label="Rewards" value="Earn G$" note="Verified players earn GoodDollar for reaching milestone tiles." />
        </div>
      </Section>

      <Section index={1}>
        <div className="htp2__split">
          <div>
            <p className="htp2__lede">
              Slide every tile in one direction. When two tiles with the same number touch, they merge into one tile worth
              their sum. After each move a new tile appears: a 2 ({RULES.spawnTwoPercent}% of the time) or a 4. Reach the {RULES.winTile} tile
              to win, or keep going until the board is full and no move is left.
            </p>
            <div className="htp2__keys" aria-label="Controls">
              {CONTROLS.arrows.map((k) => <kbd key={k} className="htp2__key">{k}</kbd>)}
              <span className="htp2__keys-note">Arrow keys, {CONTROLS.letters} or {CONTROLS.vim} on a keyboard. Swipe on mobile.</span>
            </div>
            <p className="htp2__lede">
              When a game ends, press <strong>Submit Score</strong> to record it on-chain: your score, your highest tile and any
              rewards. Submit within {RULES.sessionHours} hours of starting the game, or it expires and earns nothing. Starting a game
              and submitting it are each a blockchain transaction, so your wallet pays a small network fee for each.
            </p>
          </div>
          <figure className="htp2__board-fig" aria-hidden="true">
            <div className="htp2__board">{EXAMPLE_BOARD.map((v, i) => <Tile key={i} v={v} />)}</div>
            <figcaption>Example board · merge equal tiles</figcaption>
          </figure>
        </div>
        <div className="htp2__merge">
          <div className="htp2__merge-tiles" aria-hidden="true">
            <Tile v={2} /><span className="htp2__op">+</span><Tile v={2} /><span className="htp2__op">→</span><Tile v={4} />
          </div>
          <div>
            <p className="htp2__merge-title">Two matching tiles. One bigger tile.</p>
            <p className="htp2__fact-note">Each merge adds the new tile&apos;s value to your score: 2 + 2 = 4 scores 4 points, 4 + 4 = 8 scores 8. Keep merging to reach {RULES.winTile}.</p>
          </div>
        </div>
        {undoEnabled && (
          <p className="htp2__lede htp2__lede--small">Made a mistake? <strong>Undo</strong> (under the board) takes back your last move. Each undo uses one Undo credit from the Shop, charged when you submit the score, like a boost. You can undo once per move, and not after a win.</p>
        )}
        <Note>Sign in with your email, or connect a wallet such as MiniPay, to play. GoodDollar verification is only needed to receive G$ rewards.</Note>
      </Section>

      <Section index={2}>
        <div className="htp2__headline">
          <p className="htp2__big">XP = score ÷ {RULES.scorePerXp} × combo × booster</p>
          <p className="htp2__fact-note">
            A game&apos;s base XP is its score divided by {RULES.scorePerXp}. Almost every game also gets the {RULES.comboMultiplier}× combo XP
            bonus (see below), so a typical game earns about 1 XP for every 2 points, and more with a booster.
          </p>
        </div>
        <p className="htp2__fact-note htp2__sub">XP keeps adding up across games. G$ is earned only by reaching these tiles in a single game:</p>
        <div className="htp2__grid htp2__grid--4">
          {[m256, m512, m1024, m2048].map((m) => (
            <Fact key={m.tile} label={`Tile ${m.tile}`} value={`${m.reward} G$`} tone="green" />
          ))}
        </div>
        <Note>Rewards are paid automatically, straight to your wallet, when you submit a game that reaches the tile. Each tile pays once per wallet, and only if the wallet is GoodDollar-verified at that moment. If it wasn&apos;t verified yet, or the reward pool was short, the reward isn&apos;t lost: it is paid the next time you submit a game that reaches that tile. A first game that reaches a high tile pays every lower tile you haven&apos;t been paid for too.</Note>
      </Section>

      <Section index={3}>
        <div className="htp2__grid htp2__grid--2">
          <Fact label="In-game combo" value={`${RULES.comboMultiplier}× XP this game`} note={`Make ${RULES.comboMoves} merging moves in a row at any point in a game and that whole game's XP is multiplied by ${RULES.comboMultiplier}. Most games reach it. It adds XP only, not G$.`} />
          <Fact label="Shop boosters" value={`${RULES.boostHours} hours`} note={`A 2× or 5× XP Boost multiplies the XP of every game you submit for ${RULES.boostHours} hours.`} />
        </div>
        <p className="htp2__formula"><span aria-hidden="true">✦</span> {RULES.comboMultiplier}× combo × 5× booster = {RULES.comboMultiplier * 5}× XP</p>
        <p className="htp2__fact-note">The combo applies to the game you earn it in. A booster applies to every game submitted while it is active; buying another replaces it.</p>
        <Note>Combos and boosters increase XP only. They never pay G$: G$ rewards come only from reaching milestone tiles (see XP and Rewards).</Note>
      </Section>

      <Section index={4} lede="Spend G$ on XP boosters and on protection for your daily streak. Prices are read live from the game contract.">
        <div className="htp2__grid htp2__grid--3">
          <Fact label="Streak Shield" value={prices.shield} note="Used up instead of losing your streak when more than 48 hours pass between games." />
          <Fact label="2× XP Booster" value={prices.boost2x} note={`Doubles the XP of every game you submit in the next ${RULES.boostHours} hours.`} />
          <Fact label="5× XP Booster" value={prices.boost5x} note={`Multiplies by 5 the XP of every game you submit in the next ${RULES.boostHours} hours.`} />
        </div>
        <Note>
          Your streak grows by one when you play again 24 to 48 hours after your last game; more games the same day don&apos;t
          change it. If more than 48 hours pass, one Streak Shield is used and your streak continues; without one it restarts
          at 1. Shields stack. {undoEnabled ? <>The Shop also sells Undo Step credits ({prices.undo} each) and cosmetics.</> : <>The Shop also sells cosmetics.</>}{" "}
          <Link href="/?tab=shop" className="htp2__inline-link">Open the Shop</Link>
        </Note>
      </Section>

      <Section index={5} lede="GoodDollar (G$) is a cryptocurrency that funds a universal basic income. G$ you earn in BlockSlide can be spent in the Shop or sent to other wallets.">
        <div className="htp2__grid htp2__grid--2">
          <div className="htp2__fact">
            <p className="htp2__card-title">Without verification</p>
            <p className="htp2__fact-note">You can play, submit scores and earn XP, but milestone G$ rewards are not paid.</p>
          </div>
          <div className="htp2__fact htp2__fact--highlight">
            <p className="htp2__card-title">One face, one wallet</p>
            <p className="htp2__fact-note">Verify with GoodDollar&apos;s face check to receive milestone rewards on that wallet. Each person can verify one wallet, and GoodDollar asks you to re-verify every {GD_REVERIFY_DAYS} days; rewards are only paid while your verification is current.</p>
          </div>
        </div>
      </Section>

      <Section index={6} lede="Bounties are limited-time competitions ranked by the XP you earn during the bounty, separate from the all-time leaderboard. When a bounty ends, its top five players are the winners.">
        <div className="htp2__cta-row">
          <p className="htp2__fact-note">
            {bountyStatus === "live" ? "A bounty is live right now." : bountyStatus === "upcoming" ? "The next bounty is coming up." : "The current bounties have ended. See their winners."}
          </p>
          <Link href="/bounty" className="htp2__btn">View Bounties</Link>
        </div>
      </Section>

      <Section index={7} lede="Your profile is public and shareable. It brings your progress together in one place.">
        <ul className="htp2__chips">
          {["Total XP", "Best single-game score", "Games played", "Current streak", "Custom username", "G$ earned and spent"].map((c) => (
            <li key={c} className="htp2__chip"><span aria-hidden="true">✓</span> {c}</li>
          ))}
        </ul>
      </Section>

      <Section index={8} lede="Stay connected for game updates, tips and bounty announcements.">
        <div className="htp2__grid htp2__grid--3">
          {COMMUNITY.map((c) => (
            <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer" className="htp2__fact htp2__fact--link">
              <p className="kicker">{c.label}</p>
              <p className="htp2__link-value">{c.value} <span aria-hidden="true">↗</span></p>
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
