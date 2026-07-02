import { test } from "@playwright/test";

test("what is the native onclick function", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.locator("text=Wallet").first().click();
  await page.waitForTimeout(500);

  const onclickInfo = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;
    const onclick = (btn as any).onclick;

    return {
      hasNativeOnclick: !!onclick,
      onclickString: onclick ? onclick.toString().substring(0, 500) : "none",
      onclickType: typeof onclick,
      onclickIsNull: onclick === null,
    };
  });

  console.log("Native onclick analysis:");
  console.log(JSON.stringify(onclickInfo, null, 2));

  // Check React's synthetic event system
  const reactEventInfo = await page.evaluate(() => {
    const btn = document.querySelector(".wallet-option") as HTMLButtonElement;

    // React stores event delegated listeners on the root
    const root = document.querySelector("body") || document.documentElement;

    return {
      buttonHasReactFiber: Object.keys(btn).some(k => k.startsWith("__react")),
      rootHasReactFiber: Object.keys(root).some(k => k.startsWith("__react")),
    };
  });

  console.log("React event system info:");
  console.log(JSON.stringify(reactEventInfo, null, 2));
});
