/**
 * Every notification draws through one component (Notice) in the Season 5 style: line icons,
 * never emoji; semantic tones that stay distinguishable and readable in both themes; and the
 * same roles, labels, timings and callbacks each notification had before.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Notice, { type NoticeTone } from "./Notice";
import FeatureNotification from "./FeatureNotification";

const toasts = [
  { id: "a", type: "success", message: "Score submitted!" },
  { id: "b", type: "error", message: "Transaction failed" },
  { id: "c", type: "warning", message: "Seed backup to server failed." },
  { id: "d", type: "info", message: "Heads up" },
];
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ toasts, removeToast: () => {} }) }));

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const css = read("../index.css");
/** Emoji, but not plain arrows such as the ↗ on external links. */
const EMOJI = /(?![\u2190-\u21FF])\p{Extended_Pictographic}/u;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** The <svg> a notice draws as its icon. */
const iconOf = (markup: string) => markup.match(/<span class="notice__icon">(<svg[\s\S]*?<\/svg>)<\/span>/)?.[1];

describe("Notice", () => {
  const tones: NoticeTone[] = ["success", "error", "warning", "info", "feature"];

  it("draws a line icon for every tone, and the semantic tones each get their own", () => {
    const icons = tones.map((tone) => iconOf(html(createElement(Notice, { tone, children: "msg" }))));
    for (const icon of icons) {
      expect(icon).toMatch(/stroke="currentColor"/);
      expect(icon).toMatch(/aria-hidden="true"/);
    }
    expect(new Set(icons.slice(0, 4)).size).toBe(4); // success, error, warning, info differ
  });

  it("adds a close button only when dismissible, with the caller's label", () => {
    expect(html(createElement(Notice, { tone: "info", children: "x" }))).not.toContain("notice__close");
    const m = html(createElement(Notice, { tone: "info", onDismiss: () => {}, dismissLabel: "Close", children: "x" }));
    expect(m).toContain('aria-label="Close"');
    expect(m).toMatch(/<button type="button" class="notice__close"[^>]*><svg/); // an icon, not a ✕ glyph
  });

  it("keeps the caller's role, live region and heading level", () => {
    const m = html(createElement(Notice, { tone: "feature", title: "T", titleAs: "h3", role: "status", "aria-live": "polite", "aria-atomic": true, children: "x" }));
    expect(m).toContain('role="status"');
    expect(m).toContain('aria-live="polite"');
    expect(m).toContain('aria-atomic="true"');
    expect(m).toContain('<h3 class="notice__title">T</h3>');
  });
});

describe("Toasts", () => {
  it("render each type with its tone, the same alert role and close label, and the message as given", async () => {
    const { default: ToastContainer } = await import("./ToastContainer");
    const m = html(createElement(ToastContainer));
    for (const t of toasts) {
      expect(m).toContain(`notice--${t.type === "info" ? "info" : t.type}`);
      expect(m).toContain(`<p class="toast__message">${t.message}</p>`);
    }
    expect(m.match(/role="alert"/g)).toHaveLength(4);
    expect(m.match(/aria-label="Close"/g)).toHaveLength(4);
  });

  it("keep their timing: 4 s by default, removed by id", () => {
    const ctx = read("../contexts/ToastContext.tsx");
    expect(ctx).toContain("duration: number = 4000");
    expect(ctx).toContain("setTimeout(() => removeToast(id), duration)");
  });

  it("no toast message in the app starts or ends with an emoji", () => {
    const files = ["../hooks/useGameSession.ts", "ClaimUBI.tsx", "../hooks/useShop.ts"];
    for (const f of files) {
      for (const call of read(f).match(/showToast\([\s\S]*?\);/g) ?? []) expect(call, `${f}: ${call}`).not.toMatch(EMOJI);
    }
  });
});

describe("Feature notifications", () => {
  const types = ["undoStep", "cosmetics", "flowStateVoting", "bountyWinner"] as const;
  const render = (type: (typeof types)[number], actionLabel?: string) =>
    html(createElement(FeatureNotification, { type, title: "Title", message: "Message", actionLabel, onDismiss: () => {} }));

  it("keep their polite status role, dismiss label and action button", () => {
    const m = render("undoStep", "Check it out");
    expect(m).toContain('role="status"');
    expect(m).toContain('aria-live="polite"');
    expect(m).toContain('aria-label="Dismiss notification"');
    expect(m).toContain(">Check it out</button>");
    expect(render("cosmetics")).not.toContain("feature-notification__action");
  });

  it("each feature has its own icon; the bounty win reads as a success", () => {
    const icons = types.map((t) => iconOf(render(t)));
    expect(new Set(icons).size).toBe(4);
    expect(render("bountyWinner")).toContain("notice--success");
    expect(render("undoStep")).toContain("notice--feature");
  });

  it("keep their timing and callback order: auto-hide after 7 s, fade 300 ms, action then dismiss", () => {
    const src = read("FeatureNotification.tsx");
    expect(src).toContain("autoHideDuration = 7000");
    expect(src.match(/setTimeout\(onDismiss, 300\)/g)).toHaveLength(2);
    expect(src).toMatch(/onAction\?\.\(\);\s*handleDismiss\(\);/);
  });
});

describe("No emoji as notification icons", () => {
  it.each([
    "Notice.tsx", "ToastContainer.tsx", "FeatureNotification.tsx", "NetworkGuardBanner.tsx",
    "SignInModal.tsx", "GasNeededModal.tsx", "FlowstateVotingModal.tsx", "../App.tsx",
  ])("%s", (f) => {
    const lines = read(f).split("\n").filter((l) => EMOJI.test(l) && !/^\s*(\/\/|\*|console\.)/.test(l));
    expect(lines).toEqual([]);
  });
});

describe("Tone colours", () => {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = (h: string) => {
    const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const section = css.slice(css.indexOf("Notifications. One look"));
  const tokens = (selector: string) => {
    const block = section.slice(section.indexOf(selector)).split("}")[0];
    return Object.fromEntries([...block.matchAll(/--tone-(\w+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  };
  const light = tokens(":root {");
  const dark = tokens("html.dark-mode {");

  it("define all five tones in light and dark, the same in both dark selectors", () => {
    for (const t of [light, dark]) expect(Object.keys(t).sort()).toEqual(["error", "feature", "info", "success", "warning"]);
    expect(tokens(":root:not(.light-mode) {")).toEqual(dark);
  });

  it("reach 4.5:1 on the notice surface in both themes (light #FFFFFF / #F3F4F6, dark #181B26 / #171A24)", () => {
    for (const c of Object.values(light)) for (const bg of ["#FFFFFF", "#F3F4F6"]) expect(ratio(c, bg)).toBeGreaterThanOrEqual(4.5);
    for (const c of Object.values(dark)) for (const bg of ["#181B26", "#171A24"]) expect(ratio(c, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("sit before the light-mode layer, so that layer stays last", () => {
    expect(css.indexOf("Notifications. One look")).toBeLessThan(css.indexOf("Light mode (reference frames"));
    expect(css.indexOf("Notifications. One look")).toBeGreaterThan(css.indexOf("Season 5 redesign"));
  });
});
