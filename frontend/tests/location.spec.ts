import { test, expect, Page } from "@playwright/test";
import {
  distanceKm,
  rankCenters,
  validCoordinates,
  directionsUrl,
} from "../lib/location";
import { mergeRegisteredPlaces } from "../lib/google-maps";
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
    { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
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

test("imprecise success retries instead of showing incorrect nearby centers", async ({
  page,
}) => {
  await mockGoogleMaps(page);
  await page.addInitScript(() => {
    let calls = 0;
    navigator.geolocation.getCurrentPosition = (success) => {
      calls++;
      success({
        coords:
          calls === 1
            ? { latitude: 40.8, longitude: -73.7, accuracy: 5000 }
            : { latitude: 40.7305, longitude: -73.9544, accuracy: 20 },
      } as GeolocationPosition);
    };
  });
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".google-place-list li").first()).toContainText(
    "Nearby public recycling",
  );
  const searches = await page.evaluate(
    () =>
      (
        window as unknown as {
          googleSearches: {
            locationBias: { center: { lat: number; lng: number } };
          }[];
        }
      ).googleSearches,
  );
  expect(searches).toHaveLength(1);
  expect(searches[0].locationBias.center).toEqual({
    lat: 40.7305,
    lng: -73.9544,
  });
});

test("persistently inaccurate GPS leaves address search available and never searches the wrong area", async ({
  page,
}) => {
  await mockGoogleMaps(page);
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) =>
      success({
        coords: { latitude: 40.8, longitude: -73.7, accuracy: 5000 },
      } as GeolocationPosition);
  });
  await dropoff(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.locator(".location-status")).toContainText(
    "too approximate",
  );
  await expect(page.locator(".google-discovery")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create drop-off ticket" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Or search by address, neighborhood, or postal code"),
  ).toBeEnabled();
});

test("enrollment requires the exact branch and closed places are not reintroduced", () => {
  const origin = { latitude: 40.72946, longitude: -73.815485 };
  const center: Center = {
    id: "ecoatm-kissena-blvd",
    name: "ecoATM",
    address: "71-04 Kissena Blvd",
    ...origin,
    is_demo: 0,
    google_place_id: "kissena-place",
  };
  const other = {
    id: "different-branch",
    name: "ecoATM",
    address: "Another street",
    location: origin,
    distance: 0,
    attributions: [],
  };
  const results = mergeRegisteredPlaces([other], [center], origin, 10000);
  expect(results).toHaveLength(2);
  expect(
    results.find((p) => p.id === "different-branch")?.registeredCenterId,
  ).toBeUndefined();
  expect(
    results.find((p) => p.id === "kissena-place")?.registeredCenterId,
  ).toBe("ecoatm-kissena-blvd");
  expect(
    mergeRegisteredPlaces([], [center], origin, 10000, ["kissena-place"]),
  ).toHaveLength(0);
  expect(
    mergeRegisteredPlaces(
      [{ ...other, id: "kissena-place" }],
      [center],
      origin,
      10000,
    ),
  ).toHaveLength(1);
});
