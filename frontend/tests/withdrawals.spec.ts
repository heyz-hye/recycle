import { test, expect } from "@playwright/test";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { getBase58Decoder } from "@solana/kit";

test("recycler links a wallet, converts LOOP, and withdraws LOOP, USDC and SOL", async ({
  page,
}, info) => {
  const email = `withdraw-${randomUUID()}@example.com`;
  const password = `test-password-${randomUUID()}`;
  let response = await page.request.post("/api/auth/register", {
    data: { email, password, username: "Withdrawal tester" },
  });
  expect(response.status()).toBe(201);
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  const wallet = getBase58Decoder().decode(raw);
  const challenge = await (
    await page.request.post("/api/auth/challenge", { data: { wallet } })
  ).json();
  response = await page.request.post("/api/auth/link-wallet", {
    data: {
      challenge_id: challenge.challenge_id,
      signature: getBase58Decoder().decode(
        sign(null, Buffer.from(challenge.message), pair.privateKey),
      ),
    },
  });
  expect(response.ok()).toBe(true);
  const claim = await (
    await page.request.post("/api/claims", {
      data: {
        center_id: "greenpoint",
        items: [{ material: "cardboard", quantity: 2000, unit: "grams" }],
      },
    })
  ).json();
  await page.request.post("/api/auth/demo", { data: { account: "verifier" } });
  await page.request.post("/api/claims/ticket", {
    data: { ticket: claim.ticket },
  });
  response = await page.request.post(`/api/claims/${claim.id}/confirm`, {
    data: {
      decision: "approved",
      received: true,
      items: [{ material: "cardboard", quantity: 2000, unit: "grams" }],
    },
  });
  expect(response.ok()).toBe(true);
  await page.request.post("/api/auth/login", { data: { email, password } });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/assets")).json()).balances.LOOP
          .available_base_units,
      { timeout: 15000 },
    )
    .toBe(4000);
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "My wallet", exact: true })
    .click();
  await expect(page.locator(".asset-summary")).toContainText(wallet);
  for (const asset of ["USDC", "SOL"] as const) {
    await page
      .getByRole("button", { name: "Convert LOOP", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("LOOP amount").fill("5");
    await dialog.getByLabel("Convert to").selectOption(asset);
    const quoteResponse = page.waitForResponse((r) =>
      r.url().endsWith("/api/assets/quotes"),
    );
    await dialog.getByRole("button", { name: "Preview conversion" }).click();
    const quote = await (await quoteResponse).json();
    await expect(dialog.locator(".quote-preview")).toContainText(
      "distributed, unredeemed LOOP",
    );
    await dialog.getByRole("button", { name: "Confirm conversion" }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole("button", {
        name: `Simulate ${asset} withdrawal`,
        exact: true,
      })
      .click();
    const digits = asset === "USDC" ? 6 : 9;
    const units = BigInt(quote.output_base_units);
    const divisor = 10n ** BigInt(digits);
    const amount = `${units / divisor}.${(units % divisor).toString().padStart(digits, "0")}`;
    await dialog.getByLabel(`${asset} amount`).fill(amount);
    await dialog.getByRole("button", { name: "Review withdrawal" }).click();
    await expect(dialog).toContainText(wallet);
    await dialog.getByRole("button", { name: "Confirm simulation" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page
    .getByRole("button", { name: "Simulate LOOP withdrawal", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("LOOP amount").fill("1.001");
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(dialog.getByRole("alert")).toContainText("2 decimal places");
  await dialog.getByLabel("LOOP amount").fill("1");
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  await dialog.getByRole("button", { name: "Confirm simulation" }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/assets")).json()
        ).withdrawals.filter((w: { state: string }) => w.state === "confirmed")
          .length,
      { timeout: 15000 },
    )
    .toBe(3);
  await page.getByRole("button", { name: "Refresh balances" }).click();
  await expect(
    page.getByText("Simulated completion", { exact: true }),
  ).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("wallet-withdrawals.png"),
    fullPage: true,
  });
  const balances = (await (await page.request.get("/api/assets")).json())
    .balances;
  expect(balances.LOOP.available_base_units).toBe(2900);
  expect(balances.USDC.available_base_units).toBe(0);
  expect(balances.SOL.available_base_units).toBe(0);
});

test("unlinked wallet cannot withdraw", async ({ page }) => {
  await page.request.post("/api/auth/demo", { data: { account: "recycler" } });
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "My wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Link Solana wallet" }),
  ).toBeVisible();
  for (const asset of ["LOOP", "USDC", "SOL"])
    await expect(
      page.getByRole("button", {
        name: `Simulate ${asset} withdrawal`,
        exact: true,
      }),
    ).toBeDisabled();
});
