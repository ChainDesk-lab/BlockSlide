/**
 * Shared shell polish: the debug readout stays out of production unless asked for, the header
 * never lays links over the brand or wallet controls, and the profile copies what it labels.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnosticsEnabled, diagnosticsPreference } from "../lib/diagnostics";

const shell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../index.css"), "utf8");
const profile = readFileSync(join(__dirname, "../../app/profile/[identifier]/ProfileView.tsx"), "utf8");

describe("Debug readout", () => {
  it("is off in production and on in development by default", () => {
    expect(diagnosticsEnabled("production", "", null)).toBe(false);
    expect(diagnosticsEnabled("development", "", null)).toBe(true);
    expect(diagnosticsEnabled("test", "", null)).toBe(true);
  });

  it("can be turned on in production with ?debug=1 or the remembered flag, and off with ?debug=0", () => {
    expect(diagnosticsEnabled("production", "?debug=1", null)).toBe(true);
    expect(diagnosticsEnabled("production", "?tab=game&debug=1", null)).toBe(true);
    expect(diagnosticsEnabled("production", "", "1")).toBe(true);
    expect(diagnosticsEnabled("production", "?debug=0", "1")).toBe(false);
    expect(diagnosticsEnabled("development", "?debug=0", null)).toBe(false);
    expect(diagnosticsEnabled("production", "?debug=yes", null)).toBe(false);
  });

  it("remembers only explicit 1/0", () => {
    expect(diagnosticsPreference("?debug=1")).toBe("1");
    expect(diagnosticsPreference("?debug=0")).toBe("0");
    expect(diagnosticsPreference("?debug=true")).toBeNull();
    expect(diagnosticsPreference("")).toBeNull();
  });

  it("the footer renders nothing unless enabled, and is still mounted for support use", () => {
    expect(shell).toContain("<DiagnosticFooter />");
    expect(shell).toContain("if (!enabled) return null;");
    expect(shell).toContain("diagnosticsEnabled(process.env.NODE_ENV, window.location.search, stored)");
  });
});

describe("Shared header", () => {
  it("keeps every link and the wallet controls (nothing removed to make room)", () => {
    for (const l of ["Home", "Play", "Leaderboard", "Bounties", "Shop", "Stats", "How to Play", "Profile"]) expect(shell).toContain(l);
    // Season 5 is not a player-facing destination: no header link to a /season page.
    expect(shell).not.toContain('"/season"');
    expect(shell).not.toContain("Season 5");
    expect(shell).toContain("<WalletButton />");
    expect(shell).toContain("header__username");
  });

  it("moves the nav to its own row below 1400px and tightens gaps up to 1700px (14px up to 1520px)", () => {
    expect(css).toMatch(/@media \(max-width: 1400px\) \{\s*\.app \.header \{ grid-template-columns: minmax\(0, 1fr\) auto;[^}]*\}\s*\.header__nav \{ grid-column: 1 \/ -1; grid-row: 2;/);
    expect(css).toMatch(/@media \(max-width: 1700px\) \{\s*\.app \.header \{ column-gap: 16px; \}\s*\.header__nav \{ gap: 18px; \}\s*\}\s*@media \(max-width: 1520px\) \{\s*\.header__nav \{ gap: 14px; \}/);
    // The old 1100px break let the nav overlap at 1101-1400px.
    expect(css).not.toMatch(/@media \(max-width: 1100px\) \{\s*\.app \.header/);
  });

  it("a nav that still doesn't fit scrolls instead of overlapping, and long usernames truncate with the full name on hover", () => {
    expect(css).toContain(".header__nav { overflow-x: auto; scrollbar-width: none; }");
    expect(css).toContain("@media (min-width: 1401px) { .header__username { max-width: 110px; } }");
    expect(css).toContain("@media (min-width: 1601px) { .header__username { max-width: 150px; } }");
    expect(shell).toContain("title={`Your username: ${username}`}");
  });
});

describe("Profile copy and share targets", () => {
  it("wallet Copy copies the address; invite Copy and Share use the referral URL", () => {
    expect(profile).toMatch(/const handleCopyAddress = async \(\) => \{\s*try \{\s*await navigator\.clipboard\.writeText\(profileAddress\);/);
    expect(profile).toMatch(/const handleCopyLink = async \(\) => \{\s*try \{\s*await navigator\.clipboard\.writeText\(refLink\);/);
    expect(profile).toMatch(/navigator\.share\(\{[\s\S]*?url: refLink,/);
    expect(profile).toContain("onCopyAddress={handleCopyAddress}");
    expect(profile).toContain("onCopy={handleCopyLink}");
    expect(profile).toContain("onShare={handleShareLink}");
    // Share falls back to copying the same link where the Web Share API is missing.
    expect(profile).toMatch(/\} else \{\s*await handleCopyLink\(\);/);
  });
});

describe("Header consistency", () => {
  const toggle = readFileSync(join(__dirname, "ThemeToggle.tsx"), "utf8");

  it("the active link comes straight from the URL, so the first render is already right", () => {
    expect(shell).toContain('const tab = searchParams.get("tab") || "home";');
    expect(shell).not.toMatch(/useState<string>\("home"\)/);
  });

  it("every nav item, Profile included, marks the current page for assistive tech", () => {
    expect(shell).toMatch(/aria-current=\{isProfile \? "page" : undefined\}/);
    // Every other nav link comes from one mapped list whose <Link> carries aria-current.
    const list = shell.slice(shell.indexOf('<nav className="header__nav"'), shell.indexOf("] as const).map("));
    for (const l of ["Home", "Play", "Leaderboard", "Bounties", "Shop", "Stats", "How to Play"]) expect(list).toContain(`["${l}",`);
    expect(shell).toContain('<Link key={label} href={href} className={`nav-link ${active ? "nav-link--active" : ""}`} aria-current={active ? "page" : undefined}>');
  });

  it("signed out, the header offers Connect Wallet into the existing sign-in; never while a sign-in is completing", () => {
    expect(shell).toContain('{!isConnected && !address && (');
    expect(shell).toContain('<Link href="/?tab=game" className="header__connect" aria-label="Connect Wallet">Connect<span className="header__connect-more">&nbsp;Wallet</span></Link>');
    expect(shell).not.toMatch(/header__connect[\s\S]{0,200}onClick/); // a link, not a second login() caller
  });

  it("the theme toggle uses the same line icons as the sound control and holds its space before mounting", () => {
    expect(toggle).toContain("{isDark ? <MoonIcon /> : <SunIcon />}");
    expect(toggle).not.toMatch(/🌙|☀️/);
    expect(toggle).toContain('if (!isMounted) return <span className="theme-toggle theme-toggle--placeholder" aria-hidden="true" />;');
    expect(css).toContain(".theme-toggle--placeholder { display: inline-block; visibility: hidden; }");
  });
});
