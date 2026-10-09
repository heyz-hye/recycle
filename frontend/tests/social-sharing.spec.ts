import { test, expect, Page } from "@playwright/test";
import type { Claim } from "../lib/api";
import { shareCaption, socialComposeLinks } from "../lib/sharing";

const first: Claim = {
  id: "private-claim-one",
  user_id: "recycler",
  username: "Private Recycler",
  center_name: "Private Center",
  status: "verified",
  ticket: "private-ticket-secret",
  ticket_expires_at: 2000000000,
  created_at: 1900000000,
  items: [
    { material: "bottles", submitted_quantity: 100, accepted_quantity: 2 },
    {
      material: "cardboard",
      submitted_quantity: 9000,
      accepted_quantity: 1250,
    },
  ],
  verification: { decision: "approved", reason: "Private staff note" },
  reward: {
    id: "reward-one",
    claim_id: "private-claim-one",
    amount_base_units: 3500,
    state: "confirmed",
    signature: "private-signature",
    created_at: 1900000000,
  },
};
const second: Claim = {
  ...first,
  id: "private-claim-two",
  ticket: "private-ticket-two",
  items: [{ material: "bottles", submitted_quantity: 3, accepted_quantity: 3 }],
  reward: {
    ...first.reward!,
    id: "reward-two",
    claim_id: "private-claim-two",
    amount_base_units: 1500,
  },
};

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
}

test("each rewarded ticket offers a standard post and safe X/Reddit composer links", async ({
  page,
  context,
}, info) => {
  await page.route("**/api/claims", (r) =>
    r.fulfill({ json: [first, second] }),
  );
  await page.route(`**/api/claims/${first.id}`, (r) =>
    r.fulfill({ json: first }),
  );
  await page.route(`**/api/claims/${second.id}`, (r) =>
    r.fulfill({ json: second }),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedCaption: string }).copiedCaption = text;
        },
      },
    }),
  );
  // Inspect navigation without posting anything or using real social sessions.
  await context.route("https://x.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<h1>X composer test</h1>" }),
  );
  await context.route("https://www.reddit.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<h1>Reddit composer test</h1>",
    }),
  );
  await signIn(page);
  await expect(page.locator(".share-prompt")).toContainText("35 LOOP");
  await expect(
    page
      .locator(".activity-row")
      .getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Share your impact", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share your impact" });
  const template = await dialog.getByLabel("Your caption").inputValue();
  expect(template).toContain("2 bottles and 1.25 kg cardboard");
  expect(template).toContain("35 LOOP");
  expect(template).toContain("no real monetary value");
  for (const privateText of [
    first.id,
    first.ticket,
    first.username,
    first.center_name,
    "Private staff note",
    "private-signature",
    "100 bottles",
    "9 kg",
  ])
    expect(template).not.toContain(privateText);
  expect(template.length).toBeLessThanOrEqual(280);
  const edited = template + " & a greener day 🌱";
  await dialog.getByLabel("Your caption").fill(edited);
  const xPopup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Share on X", exact: true }).click();
  const x = await xPopup;
  await x.waitForLoadState("domcontentloaded");
  expect(new URL(x.url()).searchParams.get("text")).toBe(edited);
  expect(await x.evaluate(() => window.opener === null)).toBe(true);
  await x.close();
  const redditPopup = page.waitForEvent("popup");
  await dialog
    .getByRole("link", { name: "Share on Reddit", exact: true })
    .click();
  const reddit = await redditPopup;
  await reddit.waitForLoadState("domcontentloaded");
  const url = new URL(reddit.url());
  expect(url.searchParams.get("title")).toContain("35 LOOP");
  expect(url.searchParams.get("text")).toBe(edited);
  expect(url.searchParams.get("type")).toBe("TEXT");
  await expect(dialog.getByRole("status")).toContainText("Caption copied");
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedCaption: string }).copiedCaption,
    ),
  ).toBe(edited);
  await reddit.close();
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Clipboard unavailable");
    };
  });
  const fallbackPopup = page.waitForEvent("popup");
  await dialog
    .getByRole("link", { name: "Share on Reddit", exact: true })
    .click();
  const fallback = await fallbackPopup;
  await expect(dialog.getByRole("status")).toContainText(
    "Copy the caption here",
  );
  await fallback.close();
  await dialog
    .getByRole("button", { name: "Reset to standard template" })
    .click();
  await expect(dialog.getByLabel("Your caption")).toHaveValue(template);
  await page.screenshot({
    path: info.outputPath("social-share-template.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".share-prompt")).toContainText("15 LOOP");
  await page
    .getByRole("button", { name: "Share your impact", exact: true })
    .click();
  await expect(dialog.getByLabel("Your caption")).toHaveValue(
    /3 bottles and received 15 LOOP/,
  );
  // Prior tickets remain shareable even after dismissing their prompt.
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".share-prompt")).toHaveCount(0);
  await expect(
    page
      .locator(".activity-row")
      .getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(2);
});

test("sharing appears only after the token reward confirms", async ({
  page,
}) => {
  let claim: Claim = {
    ...first,
    reward: { ...first.reward!, state: "queued" },
  };
  await page.route("**/api/claims", (r) => r.fulfill({ json: [claim] }));
  await signIn(page);
  await expect(page.locator(".activity-row")).toContainText(
    "Share once rewards arrive",
  );
  await expect(page.locator(".share-prompt")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(0);
  claim = first;
  await expect(page.locator(".share-prompt")).toContainText("35 LOOP", {
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
});

test("templates omit unreceived rewards and safely encode special characters", () => {
  expect(
    shareCaption(
      { ...first, reward: { ...first.reward!, state: "sent" } },
      true,
    ),
  ).toBe("");
  expect(shareCaption({ ...first, status: "rejected" }, true)).toBe("");
  expect(shareCaption(first, false)).toContain("Solana Devnet");
  const caption = "Recycled & received #LOOP + 🌱\nA second line";
  const links = socialComposeLinks("My recycling", caption);
  expect(new URL(links.x).searchParams.get("text")).toBe(caption);
  expect(new URL(links.reddit).searchParams.get("text")).toBe(caption);
});
