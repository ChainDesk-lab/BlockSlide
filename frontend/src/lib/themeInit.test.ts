/**
 * Light mode: the pre-paint theme script, and guards on the light CSS layer
 * (light-only scoping, the two light token blocks in step, readable contrast).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./themeInit";
import { getDeviceKey } from "./unifiedStorage";

/** Runs the init script against a fake document and returns the <html> classes. */
function run(stored: string | null, systemDark: boolean, start: string[] = [], storageThrows = false): string[] {
  const classes = new Set(start);
  const env = {
    localStorage: { getItem: (k: string) => { if (storageThrows) throw new Error("blocked"); return k === THEME_STORAGE_KEY ? stored : null; } },
    window: { matchMedia: (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && systemDark }) },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } },
  };
  new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(env.localStorage, env.window, env.document);
  return [...classes].sort();
}

describe("theme init script", () => {
  it("uses the key ThemeToggle writes", () => {
    expect(THEME_STORAGE_KEY).toBe(getDeviceKey("theme"));
  });

  it("a saved choice wins over the system preference", () => {
    expect(run("light", true)).toEqual(["light-mode"]);
    expect(run("dark", false)).toEqual(["dark-mode"]);
  });

  it("with no saved choice it follows the system preference", () => {
    expect(run(null, true)).toEqual(["dark-mode"]);
    expect(run(null, false)).toEqual(["light-mode"]);
  });

  it("replaces the other theme class instead of adding a second", () => {
    expect(run("light", false, ["dark-mode"])).toEqual(["light-mode"]);
    expect(run("dark", false, ["light-mode"])).toEqual(["dark-mode"]);
  });

  it("does nothing, and doesn't throw, when storage is blocked", () => {
    expect(run(null, false, [], true)).toEqual([]);
  });

  it("runs in <head> before the app, with hydration warnings suppressed on <html>", () => {
    const layout = readFileSync(join(__dirname, "../../app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<html lang="en" suppressHydrationWarning>\s*<head>\s*<script dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\} \/>/);
  });
});

const css = readFileSync(join(__dirname, "../index.css"), "utf8");
const LAYER = "Light mode (reference frames";
const light = css.slice(css.lastIndexOf("/*", css.indexOf(LAYER)));

/** The custom properties declared in the first `{...}` after `marker` within `src`. */
function tokens(src: string, marker: string): Record<string, string> {
  const start = src.indexOf("{", src.indexOf(marker)) + 1;
  const body = src.slice(start, src.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("light mode CSS layer", () => {
  it("is the last layer in the stylesheet, so it overrides the light defaults above it", () => {
    expect(css.indexOf(LAYER)).toBeGreaterThan(css.lastIndexOf("Season 5 redesign"));
  });

  it("scopes every rule to light mode, so dark mode can't change", () => {
    const rules = light.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media \(prefers-color-scheme: light\) \{\s*:root:not\(\.dark-mode\) \{[^}]*\}\s*\}/, "");
    const selectors = [...rules.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(20);
    for (const s of selectors) expect(s).toMatch(/^html\.light-mode\b/);
  });

  it("keeps the no-JS system-light palette identical to the html.light-mode palette", () => {
    const cls = tokens(light, "html.light-mode {");
    const media = tokens(light, ":root:not(.dark-mode) {");
    expect(Object.keys(cls).length).toBeGreaterThan(30);
    expect(media).toEqual(cls);
  });

  it("gives text at least 4.5:1 on the page, white surfaces and grey cards", () => {
    const t = tokens(light, "html.light-mode {");
    for (const fg of ["--text", "--text-muted", "--accent-green", "--accent-cyan", "--danger-text", "--error", "--brand"]) {
      for (const bg of ["--bg", "--surface", "--card"]) {
        expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps tile numbers readable (at least 4.5:1 on every light tile)", () => {
    const t = tokens(light, "html.light-mode {");
    for (const n of [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
      expect(contrast(t[`--t${n}`], t[`--t${n}-fg`]), `tile ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** The bodies of every `@media (prefers-color-scheme: dark)` block in `src`, braces balanced. */
function systemDarkBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /@media \(prefers-color-scheme: dark\)\s*\{/g;
  for (let m; (m = re.exec(src)); ) {
    let depth = 1, i = m.index + m[0].length;
    for (; depth > 0 && i < src.length; i++) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

describe("sign-in popup in light mode", () => {
  it("a device dark preference never overrides a chosen light theme", () => {
    // Inside system-dark blocks, only the base :root token block may be unguarded: html.light-mode
    // redefines those tokens with higher specificity. Anything else must exclude .light-mode.
    const selectors = systemDarkBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ""))
      .flatMap((body) => [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim())));
    expect(selectors).toContain(":root:not(.light-mode) .signin-modal-card");
    for (const sel of selectors) expect(sel === ":root" || sel.startsWith(":root:not(.light-mode)"), sel).toBe(true);
  });

  it("keeps the dark sign-in card colour for dark mode on a dark device", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light-mode\) \.signin-modal-card \{\s*background: #1a1a1a;\s*\}\s*\}/);
  });

  it("shows the email icon in light mode at 3:1 or better on the field, idle and focused", () => {
    expect(light).toMatch(/html\.light-mode \.signin-input-icon \{ color: var\(--text-muted\); \}/);
    const t = tokens(light, "html.light-mode {");
    expect(contrast(t["--text-muted"], t["--surface-2"])).toBeGreaterThanOrEqual(3); // idle field
    expect(contrast(t["--text-muted"], t["--surface"])).toBeGreaterThanOrEqual(3); // focused field
  });

  it("uses an error red of at least 4.5:1 on white in light mode only", () => {
    const t = tokens(light, "html.light-mode {");
    expect(t["--error"]).toBe("#C81E4A");
    expect(contrast(t["--error"], "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Dark mode keeps its own error colour, explicit and system.
    expect(tokens(css, "html.dark-mode {")["--error"]).toBe("#F87171");
    expect(tokens(css, "@media (prefers-color-scheme: dark) {\n  :root {")["--error"]).toBe("#F87171");
  });
});

