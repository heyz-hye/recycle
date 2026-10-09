import Link from "next/link";

export default function MapsInformation() {
  return (
    <main className="maps-information">
      <Link href="/">← Back to LoopMint</Link>
      <h1>Maps and location</h1>
      <section id="privacy">
        <h2>Location privacy</h2>
        <p>
          LoopMint requests your device location when you choose “Use my
          location” and grant browser permission. Your device may use GPS,
          Wi-Fi, or other location sources. Accuracy varies and is shown with
          the distance estimates.
        </p>
        <p>
          You can also search an address, neighborhood, or postal code without
          sharing device location. Google receives the search text and returns
          matching places. After you choose a result, the map searches around
          that area; it is not a detected device location. Your search stays in
          page memory and is not saved to your LoopMint account or database.
        </p>
        <p>
          Google Maps and Places receive your coordinates to display the map and
          search for nearby recycling locations. Google also receives the
          connection and browser information required to provide its services.
          Google handles that information under the{" "}
          <a href="https://policies.google.com/privacy">
            Google Privacy Policy
          </a>
          , which applies to the Google services used here.
        </p>
        <p>
          LoopMint keeps your GPS coordinates and Google search results in the
          open page, without saving them to your account, tickets, database, or
          browser storage. Clearing location or leaving the form removes this
          page’s location state. Clearing location does not undo information
          already sent to Google. No background location tracking is used.
        </p>
        <p>
          A ticket saves your chosen participating center. Your account,
          submissions, staff confirmations, and reward records are stored
          separately to operate the recycling service. A directions link opens
          Google Maps with the center destination; Google Maps may request your
          location independently.
        </p>
      </section>
      <section id="terms">
        <h2>Map terms of use</h2>
        <p>
          By using the Google Maps features in LoopMint, you agree to the{" "}
          <a href="https://maps.google.com/help/terms_maps/">
            Google Maps/Google Earth Additional Terms of Service
          </a>
          , which apply to those features.
        </p>
        <p>
          Nearby listings and map data are supplied by Google Maps and its data
          providers. Listings may be incomplete or outdated. Check the
          facility’s hours, public access, and accepted materials before
          visiting. Distances shown in LoopMint are approximate straight-line
          distances, not travel routes.
        </p>
        <p>
          A Google listing does not establish that a facility participates in
          LoopMint. Only registered centers can receive LoopMint tickets, and
          authorized staff must confirm physical recycling intake before any
          reward is issued. Current prototype rewards have no real monetary
          value.
        </p>
      </section>
    </main>
  );
}
