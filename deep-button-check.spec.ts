import { test } from "@playwright/test";

test("deep dive into button state", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  const walletTab = await page.locator("text=Wallet").first();
  await walletTab.click();
  await page.waitForTimeout(500);

  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    const style = window.getComputedStyle(btn);

    // Get all properties
    return {
      tagName: btn.tagName,
      className: btn.className,
      innerHTML: btn.innerHTML.substring(0, 100),
      hasOnClickAttribute: !!btn.getAttribute("onclick"),
      onclickProperty: typeof (btn as any).onclick,
      computedCursor: style.cursor,
      computedDisplay: style.display,
      computedPosition: style.position,
      computedOpacity: style.opacity,
      computedPointerEvents: style.pointerEvents,
      disabled: btn.disabled,
      ariaDisabled: btn.getAttribute("aria-disabled"),
      role: btn.getAttribute("role"),
      type: btn.getAttribute("type"),

      // Check for event listeners by looking at React fiber
      reactFiber: Object.keys(btn)
        .filter((k) => k.startsWith("__react"))
        .map((k) => {
          const fiber = (btn as any)[k];
          return {
            key: k,
            hasMemoizedProps: !!fiber?.memoizedProps,
            propKeys: fiber?.memoizedProps
              ? Object.keys(fiber.memoizedProps)
              : [],
          };
        }),
    };
  });

  console.log("Detailed button info:");
  console.log(JSON.stringify(btnInfo, null, 2));

  // Now let's try clicking and see what happens
  console.log("\nAttempting click with Playwright...");
  const btn = page.locator(".wallet-option").first();

  // Add a listener for any events  fired
  await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option");
    (window as any).clickFired = false;
    btn?.addEventListener("click", () => {
      (window as any).clickFired = true;
      console.log("[NATIVE LISTENER] Click fired");
    });
  });

  await btn.click();
  await page.waitForTimeout(1000);

  const clickFired = await page.evaluate(() => {
    return (window as any).clickFired;
  });

  console.log(`Native click listener fired: ${clickFired}`);
});
