import { test, expect } from "@playwright/test";

// Champee_01: requested. Soso: earliest joiner with G$ history (2026-06-17,
// 6 days after deployment) — the long-history case.
const PROFILES = ["Champee_01", "Soso", "Tems"];

for (const name of PROFILES) {
  test(`profile ${name}`, async ({ page }) => {
    const fatal: string[] = [];
    let rpcRangeErrors = 0;
    page.on("pageerror", (e) => fatal.push(String(e.message)));
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error") {
        if (/Block range is too large|exceeds range/.test(t)) rpcRangeErrors++;
        if (/reading 'length'|Application error/.test(t)) fatal.push("console: " + t.slice(0, 140));
      }
    });

    await page.goto(`http://localhost:3000/profile/${name}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(9000);

    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const crashed = body.includes("Application error");

    // pull the G$ card values
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const grab = (label: string) => {
      const i = lines.findIndex((l) => l.toUpperCase() === label);
      return i >= 0 ? lines.slice(i + 1, i + 2).join(" ") : "(not found)";
    };
    console.log(`\n=== ${name} ===`);
    console.log(`  crashed: ${crashed}   pageerrors: ${fatal.length}   rpc-range-errors: ${rpcRangeErrors}`);
    console.log(`  XP=${grab("XP")}  G$ EARNED=${grab("G$ EARNED")}  G$ SPENT=${grab("G$ SPENT")}`);
    fatal.slice(0, 2).forEach((e) => console.log("    " + e.slice(0, 140)));

    expect(crashed, "no Application error").toBe(false);
    expect(fatal, "no fatal errors").toHaveLength(0);
    expect(rpcRangeErrors, "no unbounded-range RPC errors").toBe(0);
  });
}
