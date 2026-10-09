import { test, expect, Page } from "@playwright/test";
import { mockGoogleMaps } from "./helpers/google-maps";

async function selectTicketCenter(page: Page) {
  await page
    .getByLabel("Or search by address, neighborhood, or postal code")
    .fill("Greenpoint, Brooklyn");
  await page
    .getByRole("button", { name: "Search location", exact: true })
    .click();
  await page.locator(".address-results button").click();
  await page
    .getByRole("button", { name: "Use for my ticket", exact: true })
    .and(page.locator(":enabled"))
    .click();
}
test.beforeEach(async ({ page }) => {
  await mockGoogleMaps(page, [
    {
      id: "greenpoint",
      name: "Greenpoint Recycling Center",
      address: "Test listing",
      latitude: 40.7405,
      longitude: -73.9544,
      is_demo: 0,
      google_place_id: "enrolled",
    },
  ]);
});

async function nav(page: Page, name: string) {
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator("nav").getByRole("button", { name, exact: true }).click();
  if (await menu.isVisible())
    await expect(page.locator(".sidebar")).not.toBeVisible();
}

test("complete center-confirmed reward and external sharing flow", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Small steps/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await expect(
    page.getByRole("heading", { name: /A little greener/ }),
  ).toBeVisible();
  await expect(
    page
      .locator(".sidebar nav")
      .getByRole("button", { name: "Center workspace" }),
  ).toHaveCount(0);
  await nav(page, "New drop-off");
  await selectTicketCenter(page);
  await page.getByLabel("Dry cardboard", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Your drop-off ticket" }),
  ).toBeVisible();
  const ticket = await dialog.locator("code").innerText();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Demo account").selectOption("verifier");
  await expect(
    page.getByRole("heading", { name: "Good work starts here." }),
  ).toBeVisible();
  await page.getByLabel("Ticket code", { exact: true }).fill(ticket);
  await page
    .getByRole("button", { name: "Open drop-off", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Confirm physical intake" }),
  ).toBeVisible();
  await dialog.getByLabel(/Accepted dry cardboard/).fill("2");
  await dialog.getByLabel(/I physically received/).check();
  await dialog
    .getByRole("button", { name: "Confirm accepted recycling" })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Demo account").selectOption("recycler");
  await expect(
    page
      .locator(".activity-row")
      .filter({ hasText: "Reward received" })
      .first(),
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(
      async () => {
        const data = await (await page.request.get("/api/claims")).json();
        return data.find((c: { ticket: string }) => c.ticket === ticket)?.reward
          ?.state;
      },
      { timeout: 15000 },
    )
    .toBe("confirmed");
  const response = await page.request.get("/api/claims");
  const all = await response.json();
  const claim = all.find((c: { ticket: string }) => c.ticket === ticket);
  expect(claim.reward.amount_base_units).toBe(4000);
  expect(claim.reward.state).toBe("confirmed");
  await page
    .locator(".activity-row")
    .filter({ hasText: "Dry cardboard" })
    .first()
    .getByRole("button", { name: "Share", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Share your impact" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Your caption")).toHaveValue(/2 kg cardboard/);
  await expect(dialog.getByLabel("Your caption")).toHaveValue(/40 LOOP/);
  await expect(dialog.getByLabel("Your caption")).not.toHaveValue(
    /simulated|demo|devnet|monetary value/i,
  );
  expect(await dialog.getByLabel("Your caption").inputValue()).not.toContain(
    ticket,
  );
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download card" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("my-recycling-impact.png");
  await download.saveAs(testInfo.outputPath("impact-card.png"));
  await expect(dialog.getByRole("status")).toContainText("Card downloaded");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await nav(page, "My wallet");
  await expect(
    page.getByRole("heading", { name: "Good things come around." }),
  ).toBeVisible();
  expect(await page.locator('a[href*="explorer.solana.com"]').count()).toBe(0);
  await page
    .getByRole("button", { name: "Simulate redemption", exact: true })
    .click();
  await dialog.getByLabel("Whole LOOP tokens to redeem").fill("1");
  await dialog
    .getByRole("button", { name: "Confirm simulated redemption" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Simulated redemptions" }),
  ).toBeVisible();
  await nav(page, "Our impact");
  await expect(
    page.getByRole("heading", { name: "Little actions. Lasting impact." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("impact-dashboard.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Demo account").selectOption("partner");
  await page.getByLabel("Demo funding amount (USD)").fill("25");
  await page.getByRole("button", { name: "Add demo funding" }).click();
  await expect(page.getByRole("status")).toContainText("Demo funding added");
  expect(errors).toEqual([]);
});

test("share unavailable fallback and canceled sharing do not change rewards", async ({
  page,
}) => {
  await page.request.post("/api/auth/demo", { data: { account: "recycler" } });
  const claim = await (
    await page.request.post("/api/claims", {
      data: {
        center_id: "greenpoint",
        items: [{ material: "cardboard", quantity: 1000, unit: "grams" }],
      },
    })
  ).json();
  await page.request.post("/api/auth/demo", { data: { account: "verifier" } });
  await page.request.post("/api/claims/ticket", {
    data: { ticket: claim.ticket },
  });
  await page.request.post(`/api/claims/${claim.id}/confirm`, {
    data: {
      decision: "approved",
      received: true,
      items: [{ material: "cardboard", quantity: 1000, unit: "grams" }],
    },
  });
  await page.request.post("/api/auth/demo", { data: { account: "recycler" } });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/claims/${claim.id}`)).json())
          .reward.state,
      { timeout: 15000 },
    )
    .toBe("confirmed");
  await page.goto("/");
  await expect(
    page
      .locator(".activity-row")
      .filter({ hasText: "Reward received" })
      .first(),
  ).toBeVisible();
  const before = await (await page.request.get("/api/wallet")).json();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page
    .locator(".activity-row")
    .filter({ hasText: "Reward received" })
    .first()
    .getByRole("button", { name: "Share", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Share to your platform" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Sharing is unavailable",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      value: async () => {
        throw new DOMException("Canceled", "AbortError");
      },
      configurable: true,
    }),
  );
  await dialog.getByRole("button", { name: "Share to your platform" }).click();
  await expect(dialog.getByRole("status")).toHaveText("");
  await dialog.getByRole("button", { name: "Not now" }).click();
  const after = await (await page.request.get("/api/wallet")).json();
  expect(after.balance_base_units).toBe(before.balance_base_units);
  expect(after.rewards.length).toBe(before.rewards.length);
});

test("ticket scan has manual fallback and rejection does not reward", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await nav(page, "New drop-off");
  await selectTicketCenter(page);
  await page.getByLabel("Plastic bottles", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  const dialog = page.getByRole("dialog");
  const ticket = await dialog.locator("code").innerText();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Demo account").selectOption("verifier");
  await page.evaluate(() =>
    Object.defineProperty(window, "BarcodeDetector", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Scan QR ticket" }).click();
  await expect(page.getByText(/Camera scanning is unavailable/)).toBeVisible();
  await page.getByLabel("Ticket code", { exact: true }).fill(ticket);
  await page
    .getByRole("button", { name: "Open drop-off", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Reject drop-off", exact: true })
    .click();
  await dialog
    .getByLabel("Reason for rejection")
    .fill("Materials were not received.");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).not.toBeVisible();
  const claim = (await (await page.request.get("/api/claims")).json()).find(
    (c: { ticket: string }) => c.ticket === ticket,
  );
  expect(claim.status).toBe("rejected");
  expect(claim.reward).toBeNull();
});
