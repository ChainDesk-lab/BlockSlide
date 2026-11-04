/**
 * Profile redesign (Figma frame 7): only values the app can read are shown, untracked ones say
 * so, run history is never reconstructed, and the referral link and its behaviour are unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InviteCard, ProfileHeader, ProfileStat, RunHistoryCard } from "./ProfilePanels";
import { SOLVE_TIME_STAT, countStat, rankStat, referralNote, shortLink } from "../lib/profileState";

const ADDR = "0xaa5e2b37666afca1b6aac7b108a9bdecaa44dfe8";
const view = readFileSync(join(__dirname, "../../app/profile/[identifier]/ProfileView.tsx"), "utf8");
const panels = readFileSync(join(__dirname, "ProfilePanels.tsx"), "utf8");
/** Find the first <button> in a returned element tree (the panels are hook-free, so this is their real tree). */
const findButton = (n: any, label?: string): any => {
  if (n?.type === "button" && (!label || [].concat(n.props.children).join("").includes(label))) return n;
  return [].concat(n?.props?.children ?? []).map((c) => findButton(c, label)).find(Boolean);
};

describe("Profile: stat values", () => {
  it("rank shows the real position, and never a number when it isn't known", () => {
    expect(rankStat({ loading: true, error: false, rank: null, pageSize: 50 })).toBeNull();
    expect(rankStat({ loading: false, error: false, rank: 3, pageSize: 50 })).toEqual({ value: "#3", note: "Global standing", tone: "default" });
    expect(rankStat({ loading: false, error: false, rank: null, pageSize: 50 })).toMatchObject({ value: "Outside top 50", tone: "empty" });
    expect(rankStat({ loading: false, error: true, rank: null, pageSize: 50 })).toMatchObject({ value: "Unavailable", tone: "empty" });
    // A rank already loaded still shows during a background refetch error.
    expect(rankStat({ loading: false, error: true, rank: 7, pageSize: 50 })?.value).toBe("#7");
  });

  it("counts format real values; unknown stays loading-or-unavailable, not 0", () => {
    expect(countStat(11480, "High score record")).toEqual({ value: "11,480", note: "High score record", tone: "accent" });
    expect(countStat(0, "Total career runs")?.value).toBe("0");
    expect(countStat(null, "x")).toBeNull();
  });

  it("best solve time is reported as not tracked", () => {
    expect(SOLVE_TIME_STAT).toMatchObject({ value: "Not tracked", tone: "empty" });
    expect(view).toContain('stat={SOLVE_TIME_STAT}');
  });

  it("referral line keeps the existing wording", () => {
    expect(referralNote(null)).toBe("Referral tracking coming soon");
    expect(referralNote(0)).toBe("No referrals yet");
    expect(referralNote(1)).toBe("1 player joined through you");
    expect(referralNote(4)).toBe("4 players joined through you");
  });
});

describe("Profile: rendering", () => {
  it("header shows name, verified badge and short wallet; Edit Profile only on your own profile", () => {
    const own = renderToStaticMarkup(createElement(ProfileHeader, { address: ADDR, username: "Tems", verified: true, isOwn: true, copied: false, onCopyAddress: () => {}, onEdit: () => {} }));
    expect(own).toContain("Tems");
    expect(own).toContain("✓ Verified");
    expect(own).toContain("0xaa5e...44dfe8");
    expect(own).toContain("Edit Profile");
    const other = renderToStaticMarkup(createElement(ProfileHeader, { address: ADDR, username: null, verified: false, isOwn: false, copied: false, onCopyAddress: () => {}, onEdit: () => {} }));
    expect(other).not.toContain("Edit Profile");
    expect(other).not.toContain("Verified");
    expect(other.match(/0xaa5e\.\.\.44dfe8/g)?.length).toBe(2); // no username: the address is the name
  });

  it("a stat card shows a skeleton while loading and the value with its caption after", () => {
    expect(renderToStaticMarkup(createElement(ProfileStat, { label: "Personal Best", stat: null }))).toContain("skeleton");
    const html = renderToStaticMarkup(createElement(ProfileStat, { label: "Personal Best", stat: countStat(11480, "High score record") }));
    expect(html).toContain("11,480");
    expect(html).toContain("High score record");
    expect(html).toContain("profile2__stat-value--accent");
  });

  it("run history has the designed columns and no rows: nothing is invented", () => {
    const html = renderToStaticMarkup(createElement(RunHistoryCard));
    for (const c of ["Date", "Result", "Score", "Time", "Moves"]) expect(html).toContain(`>${c}</th>`);
    expect(html).toContain("Run history isn&#x27;t recorded yet.");
    expect((html.match(/<tr>/g) ?? []).length).toBe(2); // the header row and the one empty-state row
    expect(html).not.toMatch(/VICTORY|COMPLETED|FAILED|DNC|\d{2}:\d{2}\.\d{2}/);
  });

  it("invite card shows the shortened link, copies the full one, and shares", () => {
    const link = `https://blockslide.app/?ref=${ADDR}`;
    const html = renderToStaticMarkup(createElement(InviteCard, { refLink: link, copied: false, referral: "No referrals yet", onCopy: () => {}, onShare: () => {} }));
    expect(html).toContain(shortLink(link));
    expect(html).toContain(`title="${link}"`);
    expect(html).toContain("Share Invite");
    expect(html).toContain("No referrals yet");
    expect(renderToStaticMarkup(createElement(InviteCard, { refLink: link, copied: true, referral: null, onCopy: () => {}, onShare: () => {} }))).toContain("Copied");
  });
});

describe("Profile: interactions", () => {
  it("Copy and Share run the handlers they are given", () => {
    const onCopy = vi.fn(), onShare = vi.fn();
    const el = InviteCard({ refLink: "x", copied: false, referral: null, onCopy, onShare });
    findButton(el, "Copy").props.onClick();
    findButton(el, "Share Invite").props.onClick();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("Edit Profile and the address Copy button run their handlers", () => {
    const onEdit = vi.fn(), onCopyAddress = vi.fn();
    const el = ProfileHeader({ address: ADDR, username: "Tems", verified: false, isOwn: true, copied: false, onCopyAddress, onEdit });
    findButton(el, "Edit Profile").props.onClick();
    findButton(el, "Copy").props.onClick();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCopyAddress).toHaveBeenCalledTimes(1);
  });
});

describe("Profile: guards", () => {
  it("the referral link and its copy/share behaviour are unchanged", () => {
    expect(view).toContain('const PRODUCTION_URL = "https://blockslide.app";');
    expect(view).toContain("const refLink = `${PRODUCTION_URL}/?ref=${profileAddress}`;");
    expect(view).toContain("navigator.clipboard.writeText(refLink)");
    expect(view).toContain("navigator.share(");
    expect(view).toMatch(/isOwnProfile && \(\s*<InviteCard/);
  });

  it("stats come from the existing sources only", () => {
    expect(view).toContain("useProfileData(profileAddress, SUBGRAPH_URL)");
    expect(view).toContain("useLeaderboardTop(profileAddress)");
    expect(view).toContain("countStat(coreError ? null : bestScore");
    expect(view).toContain("countStat(coreError ? null : gamesPlayed");
    // The figures the page already showed are kept.
    for (const l of ['label="XP"', 'label="Current Streak"', 'label="G$ Earned"', 'label="G$ Spent"']) expect(view).toContain(l);
    // The Season 5 card is held back until its backend API ships (it would only show an error without it).
    expect(view).not.toMatch(/Season5ProfileCard|components\/season5/);
  });

  it("no invented numbers or placeholder rows in the profile code", () => {
    for (const s of [view, panels]) {
      expect(s).not.toMatch(/0xNeroMaster|104,?200|0:38\.12|#142|\b156\b/);
      expect(s).not.toMatch(/writeContract|sendTransaction/);
    }
  });

  it("Edit Profile is the existing username editor, for your own profile only", () => {
    expect(view).toContain("{editing && isOwnProfile && <UsernameModal onClose={closeEditor} />}");
    expect(view).toContain('queryKey: ["profile-player-core", profileAddress]');
  });
});
