import { test, expect, Page } from "@playwright/test";
import {
  distanceKm,
  rankCenters,
  validCoordinates,
  directionsUrl,
} from "../lib/location";
import type { Center } from "../lib/api";
import { mockGoogleMaps } from "./helpers/google-maps";

async function dropoff(page: Page) {
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

test("test centers and duplicate search are absent and never silently selected", async ({
  page,
}, info) => {
  await dropoff(page);
  await expect(
    page.getByRole("heading", { name: "LoopMint ticket centers" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Search centers", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator(".center-options, .location-demo, .selected-center"),
  ).toHaveCount(0);
  await page.getByLabel("Dry cardboard", { exact: true }).fill("2");
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Or search by address, neighborhood, or postal code"),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("clean-center-picker.png"),
    fullPage: true,
  });
});

for (const [code, message] of [
  [1, "permission was declined"],
  [3, "took too long"],
] as const) {
  test(`location error ${code} keeps address search available without a default ticket center`, async ({
    page,
  }) => {
    await page.addInitScript((code) => {
      navigator.geolocation.getCurrentPosition = (_success, error) =>
        error!({ code } as GeolocationPositionError);
    }, code);
    await dropoff(page);
    await page
      .getByRole("button", { name: "Use my location", exact: true })
      .click();
    await expect(page.locator(".location-status")).toContainText(message);
    await expect(
      page.getByLabel("Or search by address, neighborhood, or postal code"),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Create drop-off ticket" }),
    ).toBeDisabled();
  });
}

test("explicit Google selection binds the ticket, and clearing location clears the selection", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 40.7305,
    longitude: -73.9544,
    accuracy: 20,
  });
  await mockGoogleMaps(page, [
    {
      id: "greenpoint",
      name: "Registered recycling center",
      address: "Test listing",
      latitude: 40.7405,
      longitude: -73.9544,
      is_demo: 0,
      google_place_id: "enrolled",
    },
  ]);
  await dropoff(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { googleSearches: unknown[] }).googleSearches
          .length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Use for my ticket", exact: true })
      .and(page.locator(":enabled")),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use for my ticket", exact: true })
    .and(page.locator(":enabled"))
    .click();
  await expect(page.locator(".selected-center")).toContainText(
    "Registered recycling center",
  );
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeEnabled();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("40.7305");
  await page
    .getByRole("button", { name: "Clear location", exact: true })
    .click();
  await expect(page.locator(".selected-center, .google-discovery")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
});

test("a timed-out coarse position retries once with high accuracy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const options: PositionOptions[] = [];
    (
      window as unknown as { positionOptions: PositionOptions[] }
    ).positionOptions = options;
    navigator.geolocation.getCurrentPosition = (success, error, option) => {
      options.push(option!);
      if (options.length === 1) error!({ code: 3 } as GeolocationPositionError);
      else
        success({
          coords: { latitude: 40.71451, longitude: -73.96141, accuracy: 20 },
        } as GeolocationPosition);
    };
  });
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText(
    "Location found",
  );
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { positionOptions: PositionOptions[] })
          .positionOptions,
    ),
  ).toEqual([
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 },
  ]);
});

test("distance ranking handles zero, dateline, unknown positions, and safe directions", () => {
  expect(
    distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }),
  ).toBe(0);
  expect(
    distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
  ).toBeCloseTo(111.195, 2);
  expect(
    distanceKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    ),
  ).toBeCloseTo(22.239, 2);
  expect(validCoordinates({ latitude: NaN, longitude: 0 })).toBe(false);
  const real: Center = {
    id: "real",
    name: "Real Center",
    address: "Registered address",
    latitude: 0,
    longitude: 0,
    is_demo: 0,
  };
  const unknown: Center = {
    ...real,
    id: "unknown",
    name: "A no-location center",
    latitude: null,
    longitude: null,
  };
  expect(
    rankCenters([unknown, real], { latitude: 0, longitude: 0 })[0].id,
  ).toBe("real");
  const url = new URL(directionsUrl(real)!);
  expect(url.searchParams.get("destination")).toBe("0,0");
  expect(url.searchParams.has("origin")).toBe(false);
  expect(directionsUrl({ ...real, is_demo: 1 })).toBeNull();
});
