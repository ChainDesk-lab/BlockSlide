/**
 * Post-reseed verification of a running site: /api/stats, /stats and /analytics. Read-only: GET
 * requests only, to the site you point it at; no Redis, no credentials. Works equally against the
 * local rehearsal (http://127.0.0.1:3103) and, afterwards, the live site.
 *
 * Run from frontend/ so the imports resolve:
 *   cd frontend
 *   npx vite-node ../scripts/analytics/verify-live-stats.ts -- --base https://blockslide.app \
 *       --expected <dry-run out dir>/expected-public.json [--strict] [--browser] [--playwright <path>]
 *
 * Options
 *   --base <url>          The site (default https://blockslide.app)
 *   --expected <path>     expected-public.json from the dry run (required)
 *   --strict              Same checkpoint, nothing new since: the whole response must equal the expected view.
 *                         Without it the live response may be ahead; history must still match and no total may fall.
 *   --browser             Also open /stats and /analytics in a browser (signed out, service worker blocked) and wait
 *                         until they show the numbers /api/stats reports. Needs Playwright.
 *   --playwright <path>   Where to import Playwright from (a path to its index.mjs) if it is not installed here
 *   --wait-minutes <n>    How long a page may take to show fresh numbers (default 8: the CDN may serve the old
 *                         response for 60 s plus up to 300 s while it revalidates)
 *
 * The API is read with a cache-busting query, so it shows what the app serves now. The pages read /api/stats
 * without one, so they can lag the API by a few minutes: that is what --wait-minutes is for.
 *
 * Exit code: 0 every check passed, 2 one failed, 1 an error.
 */
import { readFileSync } from "node:fs";
import { verifyStats, visibleNumbers } from "../../frontend/src/lib/stats/reseedVerify";
import type { StatsSnapshot } from "../../frontend/src/lib/stats/state";

interface Args { base: string; expected?: string; strict: boolean; browser: boolean; playwright?: string; waitMinutes: number; help: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { base: "https://blockslide.app", strict: false, browser: false, waitMinutes: 8, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === "--") continue;
    else if (k === "--help" || k === "-h") a.help = true;
    else if (k === "--base") a.base = v().replace(/\/$/, "");
    else if (k === "--expected") a.expected = v();
    else if (k === "--strict") a.strict = true;
    else if (k === "--browser") a.browser = true;
    else if (k === "--playwright") a.playwright = v();
    else if (k === "--wait-minutes") a.waitMinutes = Number(v());
    else throw new Error(`unknown option ${k} (try --help)`);
  }
  return a;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const line = (ok: boolean | null, text: string) => console.log(`  [${ok === null ? "SKIPPED" : ok ? "PASS   " : "FAIL   "}] ${text}`);

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*\n?/, "").replace(/^ \* ?/gm, "")); return 0; }
  if (!a.expected) throw new Error("--expected <dry-run out dir>/expected-public.json is required");
  const expected = JSON.parse(readFileSync(a.expected, "utf8")) as StatsSnapshot;
  console.log(`Verifying ${a.base} against ${a.expected}${a.strict ? " (strict)" : ""}. GET requests only.\n`);
  let failed = false;

  // 1. /api/stats, past any cached copy.
  console.log("/api/stats");
  const res = await fetch(`${a.base}/api/stats?cb=${Date.now()}`, { headers: { accept: "application/json" } });
  console.log(`  HTTP ${res.status}; x-vercel-cache: ${res.headers.get("x-vercel-cache") ?? "n/a"}; cache-control: ${res.headers.get("cache-control") ?? "n/a"}`);
  if (!res.ok) { line(false, `the API answered ${res.status}`); return 2; }
  const live = (await res.json()) as StatsSnapshot;
  console.log(`  checkpoint ${live.checkpointBlock}, updatedAt ${live.updatedAt}`);
  const v = verifyStats(live, expected, { strict: a.strict });
  for (const c of v.checks) line(c.ok, `${c.id}: ${c.detail}`);
  failed ||= !v.ok;

  // 2. The pages answer.
  console.log("\npages (HTTP)");
  for (const path of ["/stats", "/analytics"]) {
    const r = await fetch(`${a.base}${path}`, { headers: { accept: "text/html" } });
    line(r.ok, `${path} answers ${r.status}`);
    failed ||= !r.ok;
  }

  // 3. The numbers a visitor sees.
  const numbers = visibleNumbers(live);
  console.log(`\nwhat a visitor should see: ${numbers.map((n) => `${n.label} ${n.text}`).join(", ")}`);
  if (!a.browser) {
    console.log("browser check not requested. Open /stats and /analytics in a private window and compare those numbers, or re-run with --browser.");
  } else {
    type Pw = { chromium: { launch: () => Promise<any> } };
    let pw: Pw | null = null;
    try { pw = (await import(a.playwright ?? "playwright")) as unknown as Pw; } catch { /* reported below */ }
    if (!pw) {
      line(null, "browser check skipped: Playwright could not be imported (install it, or pass --playwright <path>). THE PAGES WERE NOT CHECKED IN A BROWSER.");
    } else {
      const browser = await pw.chromium.launch();
      try {
        for (const path of ["/stats", "/analytics"]) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
          const page = await ctx.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e: Error) => errors.push(e.message));
          const deadline = Date.now() + a.waitMinutes * 60_000;
          let missing: string[] = numbers.map((n) => n.text), alerts: string[] = [];
          for (let attempt = 0; ; attempt++) {
            await page.goto(`${a.base}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
            await page.waitForTimeout(1_000);
            const body: string = await page.evaluate(() => document.body.innerText);
            alerts = await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => (e as HTMLElement).innerText.slice(0, 120)));
            missing = numbers.filter((n) => !body.includes(n.text)).map((n) => `${n.label} ${n.text}`);
            if (missing.length === 0 || Date.now() > deadline) break;
            console.log(`  ${path}: still showing older numbers (missing ${missing.join(", ")}); retrying in 30 s`);
            await sleep(30_000);
          }
          const ok = missing.length === 0 && alerts.length === 0 && errors.length === 0;
          line(ok, `${path} in a browser: ${ok ? "shows every number above, no error panels, no page errors" : [missing.length ? `missing ${missing.join(", ")}` : "", alerts.length ? `error panels: ${alerts.join(" | ")}` : "", errors.length ? `page errors: ${errors.join(" | ")}` : ""].filter(Boolean).join("; ")}`);
          failed ||= !ok;
          await ctx.close();
        }
      } finally { await browser.close(); }
    }
  }

  console.log(failed ? "\nFAILED. Do not treat the reseed as verified." : "\nALL CHECKS PASSED." );
  return failed ? 2 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(`\nERROR: ${(err as Error).message}`); process.exit(1); });
