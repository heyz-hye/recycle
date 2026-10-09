import { test, expect, Page } from "@playwright/test";

import { mockGoogleMaps } from "./helpers/google-maps";

async function setup(page: Page, centers: unknown[] = [], mode = "success") {
  await mockGoogleMaps(page, centers, mode);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the recycler demo" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("nav")
    .getByRole("button", { name: "New drop-off", exact: true })
    .click();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 40.7305,
    longitude: -73.9544,
    accuracy: 20,
  });
});

test("address search works without GPS and Enter never submits a ticket", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {
      throw new Error("GPS must not be requested");
    };
  });
  let claims = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/claims") && r.method() === "POST") claims++;
  });
  await setup(page);
  await page
    .getByLabel("Or search by address, neighborhood, or postal code")
    .fill("Greenpoint, Brooklyn");
  await page
    .getByLabel("Or search by address, neighborhood, or postal code")
    .press("Enter");
  await expect(page.locator(".address-results button")).toHaveCount(1);
  await expect(page.locator(".google-discovery")).toHaveCount(0);
  await page.locator(".address-results button").click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await expect(page.locator(".google-map-canvas")).toContainText("Area");
  await expect(page.locator(".google-map-canvas")).not.toContainText("You");
  await expect(page.locator(".google-discovery")).toContainText(
    "not a detected device location",
  );
  expect(claims).toBe(0);
  const queries = await page.evaluate(() =>
    (
      window as unknown as { googleSearches: { textQuery: string }[] }
    ).googleSearches.map((r) => r.textQuery),
  );
  expect(queries).toEqual(["Greenpoint, Brooklyn", "recycling center"]);
});

test("selected address cancels pending GPS and ignores its late response", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as unknown as { completeGPS: PositionCallback }).completeGPS =
        success;
    };
  });
  await setup(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await page
    .getByLabel("Or search by address, neighborhood, or postal code")
    .fill("Greenpoint, Brooklyn");
  await page
    .getByRole("button", { name: "Search location", exact: true })
    .click();
  await page.locator(".address-results button").click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await page.evaluate(() =>
    (window as unknown as { completeGPS: PositionCallback }).completeGPS({
      coords: { latitude: 0, longitude: 0, accuracy: 20 },
    } as GeolocationPosition),
  );
  await expect(page.locator(".google-map-canvas")).toContainText("Area");
  await expect(page.locator(".location-status")).toContainText(
    "Search area selected",
  );
  await expect(
    page.getByRole("button", { name: "Update my location", exact: true }),
  ).toBeEnabled();
});

for (const mode of ["failure", "empty"]) {
  test(`address search ${mode} leaves device location available`, async ({
    page,
  }) => {
    await setup(page, [], mode);
    await page
      .getByLabel("Or search by address, neighborhood, or postal code")
      .fill("Greenpoint, Brooklyn");
    await page
      .getByRole("button", { name: "Search location", exact: true })
      .click();
    await expect(page.locator(".address-status")).toContainText(
      mode === "empty"
        ? "No matching location found"
        : "Google address search is unavailable",
    );
    await expect(
      page.getByRole("button", { name: "Use my location", exact: true }),
    ).toBeEnabled();
  });
}

test("Google discovery works with no registered centers and excludes unavailable or distant results", async ({
  page,
}, info) => {
  await setup(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { googleSearches: unknown[] }).googleSearches
          .length,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Use my location", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await expect(page.locator(".google-place-list li").first()).toContainText(
    "Nearby public recycling",
  );
  await expect(page.locator(".google-place-list")).toContainText(
    "Not enrolled in LoopMint",
  );
  await expect(
    page.getByRole("button", { name: "Use for my ticket" }),
  ).toHaveCount(2);
  for (const button of await page
    .getByRole("button", { name: "Use for my ticket" })
    .all()) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(
      /center setup is required/,
    );
  }
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await expect(page.locator(".google-map-canvas")).toContainText("You");
  await expect(page.locator(".google-place-list a").first()).toHaveAttribute(
    "href",
    /destination_place_id=public/,
  );
  await page.screenshot({
    path: info.outputPath("nearby-google-results.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await expect(page.locator(".google-discovery")).toHaveCount(0);
});

test("only an exact registered Google Place ID enables a ticket", async ({
  page,
}) => {
  await setup(page, [
    {
      id: "greenpoint",
      name: "Registered recycling center",
      address: "Enrolled address",
      latitude: 40.7405,
      longitude: -73.9544,
      is_demo: 0,
      google_place_id: "enrolled",
    },
  ]);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".google-place-list li")).toHaveCount(2);
  await expect(
    page
      .locator(".google-place-list li")
      .first()
      .getByRole("button", { name: /ticket/ }),
  ).toBeDisabled();
  await page
    .locator(".google-place-list")
    .getByRole("button", { name: "Use for my ticket" })
    .and(page.locator(":enabled"))
    .click();
  await page.getByLabel("Dry cardboard", { exact: true }).fill("1");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/claims") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Create drop-off ticket" }).click();
  expect((await request).postDataJSON()).toEqual({
    center_id: "greenpoint",
    items: [{ material: "cardboard", quantity: 1000, unit: "grams" }],
  });
  await expect(
    page.getByRole("dialog", { name: "Your drop-off ticket" }),
  ).toBeVisible();
});

for (const mode of ["no-key", "failure", "empty"]) {
  test(`Google ${mode} gives useful feedback without selecting a hidden center`, async ({
    page,
  }) => {
    await setup(
      page,
      [
        {
          id: "greenpoint",
          name: "Manual Center",
          address: "Address",
          latitude: null,
          longitude: null,
          is_demo: 0,
        },
      ],
      mode,
    );
    await page
      .getByRole("button", { name: "Use my location", exact: true })
      .click();
    const area = page.locator(".google-discovery");
    if (mode === "empty")
      await expect(area).toContainText("No recycling listings were returned");
    else
      await expect(area.getByRole("alert")).toContainText(
        mode === "no-key" ? "not configured" : "unavailable",
      );
    await expect(
      page.getByRole("radio", { name: "Manual Center" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create drop-off ticket" }),
    ).toBeDisabled();
  });
}

test("late Google results cannot restore cleared location", async ({
  page,
}) => {
  await setup(page, [], "pending");
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { googleSearches: unknown[] }).googleSearches
            .length,
      ),
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { finishSearch: (value: unknown) => void }
    ).finishSearch({ places: [] }),
  );
  await expect(page.locator(".google-discovery")).toHaveCount(0);
});
