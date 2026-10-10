# Google Maps recycling discovery

**New drop-off → Use my location** requests device location, draws the user and accuracy circle on Google Maps, and searches Google Places for actual recycling listings. It works even when the LoopMint database has no registered centers. Users can change the search radius (5, 10, 25, or 50 km), select a numbered marker/result, and open Google Maps directions.

The browser Geolocation API supplies the position with user permission. Google recommends this for device positioning; the IP-based Google Geolocation web service is not used. Location accuracy depends on the device and is displayed rather than presented as exact GPS.

If device location is unavailable, enter an address, neighborhood, or postal code and choose **Search location**. Google Places returns up to five matches. Selecting a match searches for recycling centers around that area, labeled **Area** rather than **You**. This needs no device permission or additional Google API. Search text and results remain in page memory and are not saved to LoopMint.

For testing, open `http://localhost:3000` directly in Chrome or Safari and allow location in both browser and operating-system settings. An embedded VS Code preview may not provide device positioning. The app tries a lower-accuracy request for 10 seconds, then retries once with high accuracy for 20 seconds if the first attempt is unavailable, times out, or reports accuracy worse than 250 metres. Both requests require a fresh position (`maximumAge: 0`). If the retry is still too approximate, the app asks for an address instead of ranking centers from an unreliable position. Updating location clears the old position and ticket selection. Permission denial does not retry. A 40-second overall watchdog releases the form if the browser never responds. Address search remains available while GPS is pending and cancels that request's effect on the form.

## Configuration

Enable **Maps JavaScript API** and **Places API (New)** in a Google Cloud project with billing. Configure a browser key restricted to those APIs and your permitted HTTP referrers. For local testing, allow `http://localhost:3000/*` and `http://127.0.0.1:3000/*`; use your exact HTTPS domain in deployment.

Set these values in the ignored repository-root `.env`, then restart the backend:

```dotenv
GOOGLE_MAPS_BROWSER_KEY=YOUR_RESTRICTED_BROWSER_KEY
GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID
```

Use your own JavaScript map ID for deployment; `DEMO_MAP_ID` enables Advanced Markers during development. The authenticated `/api/maps/config` endpoint returns only this browser key and map ID. A browser key is necessarily visible to the client; never use a server-restricted key or database credential here. Google credentials are not committed to Git. No frontend rebuild is needed when the backend key changes.

## Search and ticket behavior

Places Text Search (New) searches `recycling center`, biased around the device position or selected address, with distance ranking and at most 20 results. Recycling centers are not a supported Places type, so this uses a text query rather than an invalid type filter. The browser filters results outside the chosen radius, removes permanently closed entries and duplicates, then sorts by straight-line distance. Registered centers within the radius are merged into the same list even if Google omits them or search fails. Exact Place ID matches are deduplicated; different branches with the same name remain separate. Known permanently closed Google Place IDs are excluded. When the two closest distances overlap within the reported device accuracy, the list warns that their order may vary. The closest returned result is highlighted; the listing is not a complete directory, and distance is not a travel route estimate. Check the facility's hours, accepted materials, and public access before visiting.

Google results are discovery information. They do not create LoopMint center records, staff accounts, claims, or rewards. An operator can associate a real participating center with its verified Google Place ID:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli configure-center \
  --id greenhill --name 'Greenhill Recycling Center' \
  --address 'ACTUAL_VERIFIED_ADDRESS' \
  --latitude ACTUAL_LATITUDE --longitude ACTUAL_LONGITUDE \
  --google-place-id VERIFIED_GOOGLE_PLACE_ID
```

Replace the example with your center's actual details, obtained independently from that center. The additive `center_google_places` table holds a unique Google Place ID per center. An exact ID match enables **Use for my ticket** in the Google result. Similar names or nearby coordinates never establish enrollment. Omitting `--google-place-id` when updating a center preserves its existing mapping. The API continues to accept only registered internal center IDs for tickets, and only assigned staff can verify them. The drop-off form uses the Google map/results for selection. Its duplicate ticket-center list has been removed. No center is selected automatically, and clearing or changing the search area clears the selected ticket center.

## Location data and failures

Before location is requested, the interface explains that coordinates go to Google Maps/Places. They remain in page memory and are not sent to the LoopMint backend or saved to browser storage. Only the selected internal center ID goes into the ticket. Google results remain in memory; no Google listing cache or server-side copy is created. Only operator-supplied Place IDs are persisted. Google and provider attribution are displayed with the map/results. Public [location privacy and map terms](/maps-information) explain the data flow and link Google's policies.

Location denial, unavailable GPS, missing/invalid keys, API failures, and empty results show appropriate feedback. Ticket creation stays disabled until a participating center is explicitly selected. Address search remains available when device location fails. Clearing location unmounts the map and invalidates pending callbacks, preventing stale results from restoring it. A refreshed location or radius triggers one search; routine dashboard polling and selecting a center do not call Places again.

## Testing without touching Tiger Data

Run an isolated local API and frontend in separate terminals:

```bash
PYTHONPATH=backend DATABASE_URL=sqlite:///.data/maps-test.db \
  DEMO_ACCOUNTS_ENABLED=true PUBLIC_ORIGIN=http://127.0.0.1:3001 \
  GOOGLE_MAPS_BROWSER_KEY='' \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001

PATH="$PWD/.tools/node_modules/node/bin:$PATH" \
  API_URL=http://127.0.0.1:8001 NEXT_DIST_DIR=.next-test \
  npm run dev --prefix frontend -- --port 3001

PATH="$PWD/.tools/node_modules/node/bin:$PATH" E2E_URL=http://127.0.0.1:3001 \
  npm run test:e2e --prefix frontend
```

Browser tests mock Google responses and device location, so they incur no Google usage and do not use your location. They cover discovery with no enrolled centers, sorting/filtering, exact Place ID ticket matching, missing-key/error/empty states, cancellation, address search without GPS, ignored late GPS callbacks, retry after a location timeout or an imprecise success, rejection of persistently inaccurate readings, and ticket creation for an enrolled center omitted by Google. A separate live smoke check verified the configured key against Google using a synthetic Brooklyn position and returned 20 real listings. A second live check searched for Greenpoint, Brooklyn by address, displayed 20 recycling listings and the selected area marker, and made zero device-location requests. Neither live check verifies the user’s actual device positioning or VS Code preview permissions. No Google results or test accounts were added to Tiger Data.

References: [Google device geolocation](https://developers.google.com/maps/documentation/javascript/geolocation), [Places Text Search](https://developers.google.com/maps/documentation/javascript/place-search), [Places types](https://developers.google.com/maps/documentation/places/web-service/place-types), [Places display and storage policies](https://developers.google.com/maps/documentation/places/web-service/policies).
