/**
 * How to Play (Figma frame 6): every rule the guide states is checked against the code that
 * enforces it, prices are never hard-coded, and every navigation item and link works.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMUNITY, GUIDE_SECTIONS, RULES } from "../config/howToPlay";
import { GuideContent, GuideNav, type GuidePrices } from "./HowToPlayGuide";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const contract = read("../../../contracts/Game2048.sol");
const gameLogic = read("../lib/gameLogic.ts");
const useGame = read("../hooks/useGame.ts");
const guide = read("HowToPlayGuide.tsx");
const page = read("../../app/how-to-play/page.tsx");
const modal = read("HowToPlay.tsx");
const shell = read("AppShell.tsx");

const PRICES: GuidePrices = { shield: "500 G$", boost2x: "1,500 G$", boost5x: "4,000 G$", undo: "100 G$" };
const render = (o: Partial<Parameters<typeof GuideContent>[0]> = {}) =>
  renderToStaticMarkup(createElement(GuideContent, { prices: PRICES, undoEnabled: true, bountyStatus: "ended", ...o }));

describe("The rules match the contract", () => {
  it("XP is score / 10, a 5-move combo multiplies it by 5, boosts last 5 hours, games expire after 2 hours", () => {
    expect(contract).toMatch(new RegExp(`uint256 earned = score / ${RULES.scorePerXp};`));
    expect(contract).toMatch(new RegExp(`COMBO_THRESHOLD\\s*= ${RULES.comboMoves};`));
    expect(contract).toMatch(new RegExp(`COMBO_XP_MULTIPLIER = ${RULES.comboMultiplier};`));
    expect(contract).toMatch(new RegExp(`BOOST_DURATION_V6\\s*= ${RULES.boostHours} hours;`));
    expect(contract).toMatch(new RegExp(`SESSION_TIMEOUT = ${RULES.sessionHours} hours;`));
    expect(contract).toContain("earned *= boost.multiplier;"); // the boost applies on top of the combo
  });

  it("milestone rewards, paid once per wallet and only to verified players", () => {
    for (const m of RULES.milestones) expect(contract).toMatch(new RegExp(`REWARD_${m.tile}\\s*= ${m.reward}e18;`));
    expect(contract).toContain("if (!identity.isWhitelisted(msg.sender)) return;");
    expect(contract).toMatch(/claimedMilestones\[msg\.sender\] \|= MILESTONE_256/);
  });

  it("streaks: 24-48 hours extends, longer uses a shield instead of resetting", () => {
    expect(contract).toContain("} else if (elapsed <= 48 hours) {");
    expect(contract).toMatch(/if \(shieldCount\[player\] > 0\) \{\s*\/\/ Burn one shield/);
    expect(guide).toContain("24 to 48 hours after your last game");
  });

  it("the board: new tiles are 2 (90%) or 4, 2048 wins and ends the game, swipes under 20px are ignored", () => {
    expect(gameLogic).toContain(`rng() < 0.${RULES.spawnTwoPercent / 10} ? 2 : 4`);
    expect(gameLogic).toContain(`const won = highestTile >= ${RULES.winTile};`);
    expect(gameLogic).toContain("if (state.over || state.won) return state;");
    expect(useGame).toContain(`< ${RULES.minSwipePx}) return; // ignore taps`);
  });

  it("controls: arrow keys, WASD and HJKL, plus swipe", () => {
    expect(useGame).toContain('ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",');
    expect(useGame).toContain('w: "up", s: "down", a: "left", d: "right",');
    expect(useGame).toContain('k: "up", j: "down", h: "left", l: "right",');
    expect(useGame).toContain('window.addEventListener("touchend", onTouchEnd');
    const html = render();
    for (const k of ["←", "↑", "↓", "→"]) expect(html).toContain(`>${k}</kbd>`);
    expect(html).toContain("Arrow keys, W A S D or H J K L on a keyboard. Swipe on mobile.");
  });

  it("no stale or invented figures: prices come from the chain, boosts are not '24 hours', combos are not consecutive games", () => {
    for (const s of [guide, modal]) {
      expect(s).not.toMatch(/24 hours|24-hour/);
      expect(s).not.toMatch(/consecutive games|within 2 hours to trigger/);
      expect(s).not.toMatch(/\b(25|50|125|40) G\$/);
    }
    expect(guide).not.toMatch(/or go higher/i);
    expect(page).toContain('const PRICE_FNS = ["shieldPrice", "boost2xPrice", "boost5xPrice", "undoPrice"] as const;');
    expect(page).toContain("priceLabel(toPriceRead(");
  });
});

describe("What players actually see", () => {
  const controls = read("GameControls.tsx");

  it("XP is stated as the full formula, with the combo that nearly every game gets (not just '10 points = 1 XP')", () => {
    const html = render();
    expect(html).toContain("XP = score ÷ 10 × combo × booster");
    expect(html).toContain("a typical game earns about 1 XP for every 2 points");
    expect(html).not.toMatch(/>10 score points = 1 XP</);
    // The combo counts consecutive merging moves anywhere in the game (maxCombo), reported at submit.
    expect(gameLogic).toContain("/** Highest combo streak reached in this game — reported to the contract. */");
    expect(contract).toContain("if (comboMoves >= COMBO_THRESHOLD) {");
  });

  it("combos and boosters are XP-only: G$ comes only from milestone tiles", () => {
    const html = render();
    expect(html).toContain("5× XP this game");
    expect(html).toContain("It adds XP only, not G$.");
    expect(html).toContain("Combos and boosters increase XP only. They never pay G$");
    expect(html).toContain("G$ is earned only by reaching these tiles in a single game");
    // The contract agrees: the combo lives in _awardXp; G$ is paid only by _payMilestoneRewards (by tile).
    const awardXp = contract.slice(contract.indexOf("function _awardXp"), contract.indexOf("function _updateStreak"));
    expect(awardXp).toContain("COMBO_XP_MULTIPLIER");
    expect(awardXp).not.toMatch(/gDollar|_sendReward|transfer/);
    expect(contract).toMatch(/_payMilestoneRewards\(highestTile\)/);
  });

  it("rewards: paid automatically on submit, once per wallet per tile, retried only on a later game reaching that tile", () => {
    const html = render();
    expect(html).toContain("Rewards are paid automatically, straight to your wallet, when you submit a game that reaches the tile.");
    expect(html).toContain("it is paid the next time you submit a game that reaches that tile");
    expect(html).not.toContain("it is paid on a later game instead");
    expect(html).toContain("pays every lower tile you haven&#x27;t been paid for too");
    // The contract: rewards are checked against this game's highestTile, unpaid ones stay unclaimed, all lower tiles are checked.
    expect(contract).toContain("_payMilestoneRewards(highestTile)");
    expect(contract).toContain("if (_sendReward(256, REWARD_256)) claimedMilestones[msg.sender] |= MILESTONE_256;");
    expect(contract).toMatch(/if \(bal >= amount\) \{/);
  });

  it("score: each merge adds the new tile's value, as gameLogic does", () => {
    expect(gameLogic).toMatch(/const val = filled\[i\] \* 2;[\s\S]{0,80}score \+= val;/);
    expect(render()).toContain("Each merge adds the new tile&#x27;s value to your score: 2 + 2 = 4 scores 4 points");
  });

  it("the first-visit tutorial makes the same corrected claims", () => {
    expect(modal).toContain("Every game you submit earns XP equal to your score divided by 10.");
    expect(modal).toContain("Combos add XP only, not G$.");
    expect(modal).toContain("when more than 48 hours pass between games");
    expect(modal).toContain("XP of games you submit in the next 5 hours");
    expect(modal).not.toMatch(/if you miss a day|Every completed game/);
  });

  it("verification is not described as one-off, and fees are mentioned", () => {
    const html = render();
    for (const s of [guide, modal]) expect(s).not.toMatch(/Verify once/);
    expect(html).toContain("GoodDollar asks you to re-verify every 180 days");
    expect(html).toContain("your wallet pays a small network fee for each");
  });

  it("streaks and shields are described exactly as the contract applies them", () => {
    const html = render();
    expect(html).toContain("more games the same day don&#x27;t");
    expect(html).toContain("If more than 48 hours pass, one Streak Shield is used and your streak continues; without one it restarts");
    expect(contract).toContain("if (elapsed < 24 hours) {");
    expect(contract).toMatch(/\/\/ No shield — streak resets\s*streakCount\[player\] = 1;/);
  });

  it("submitting is a button press, named as the game names it; boosters count at submission", () => {
    expect(controls).toContain('"Submit Score"');
    expect(render()).toContain("press <strong>Submit Score</strong>");
    expect(contract).toContain("if (boost.expiry > block.timestamp) {");
    expect(render()).toContain("of every game you submit in the next 5 hours");
  });
});

describe("Rendering", () => {
  it("all nine sections render in order with their numbers, and the prices passed in", () => {
    const html = render();
    let at = -1;
    GUIDE_SECTIONS.forEach((s, i) => {
      const pos = html.indexOf(`id="${s.id}"`);
      expect(pos, s.id).toBeGreaterThan(at);
      at = pos;
      expect(html).toContain(`>${String(i + 1).padStart(2, "0")}</span>`);
    });
    for (const p of Object.values(PRICES)) expect(html).toContain(p);
    for (const m of RULES.milestones) expect(html).toContain(`Tile ${m.tile}`);
    expect(html).toContain("5× combo × 5× booster = 25× XP");
  });

  it("an unavailable price says so rather than showing a number", () => {
    const html = render({ prices: { shield: "Unavailable", boost2x: "…", boost5x: "Unavailable", undo: "Unavailable" } });
    expect(html).toContain(">Unavailable</p>");
    expect(html).not.toMatch(/\d+ G\$<\/p><p class="htp2__fact-note">Saves/);
  });

  it("the Undo line appears only while Undo is enabled", () => {
    expect(render({ undoEnabled: true })).toContain("Undo</strong> (under the board)");
    expect(render({ undoEnabled: false })).not.toContain("Undo</strong> (under the board)");
  });

  it("the bounty line follows the bounty state", () => {
    expect(render({ bountyStatus: "live" })).toContain("A bounty is live right now.");
    expect(render({ bountyStatus: "upcoming" })).toContain("The next bounty is coming up.");
    expect(render({ bountyStatus: "ended" })).toContain("The current bounties have ended.");
  });
});

describe("Navigation and links", () => {
  it("the sidebar lists the nine sections, each pointing at its section, with the active one marked", () => {
    const html = renderToStaticMarkup(createElement(GuideNav, { activeId: "the-shop" }));
    for (const s of GUIDE_SECTIONS) expect(html).toContain(`href="#${s.id}"`);
    expect((html.match(/aria-current="location"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/htp2__nav-link--active" aria-current="location"><span class="htp2__nav-num">05<\/span>The Shop/);
    const content = render();
    for (const s of GUIDE_SECTIONS) expect(content).toContain(`id="${s.id}"`);
  });

  it("clicking a sidebar item navigates to it instead of jumping", () => {
    const onNavigate = vi.fn(); const preventDefault = vi.fn();
    const el = GuideNav({ activeId: "", onNavigate });
    const ol = (el.props.children as any[])[1];
    const thirdLink = ol.props.children[2].props.children;
    thirdLink.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("xp-and-rewards");
  });

  it("in-app links go to real routes; community links match the rest of the app and open safely", () => {
    const html = render();
    expect(html).toContain('href="/bounty"');
    expect(html).toContain('href="/?tab=shop"');
    expect(shell).toContain('href="https://t.me/blockslide_xyz"');
    expect(html).toContain('href="https://x.com/blockslide_app"'); // confirmed by the team, 3 Nov 2026
    expect(html).not.toMatch(/BlockSlideGame/);
    for (const c of COMMUNITY) {
      expect(html).toContain(`href="${c.href}"`);
      expect(c.href).toMatch(/^https:\/\//);
    }
    expect((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length).toBe(COMMUNITY.length);
    expect(shell).toContain('["How to Play", "/how-to-play", isHowToPlay]');
  });
});
