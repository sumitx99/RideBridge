# RideBridge

1. Google Cloud console: enable **Maps JavaScript API** and **Places API (New)**, create an API key (billing must be on).
2. `cp .env.example .env` and paste the key.
3. `npm install && npm run dev`
4. Open the "Network" URL Vite prints on your phone (same Wi-Fi) and select a drop-off point. Pick a pickup point on the map if browser location access is unavailable.

## Install RideBridge from the website

Deploy the site over HTTPS, then open the public URL. On Android Chrome, tap **Install** on RideBridge or use Chrome's **Add to Home screen / Install app** menu. On Mac Chrome, tap the same button or use the browser's install menu. On Mac Safari, use **File → Add to Dock**. The installed app uses this website and needs internet access for Google Maps and fare requests. This route does not require a Play Store listing or a Mac installer.

The app manifest and icons live in `public/`. If you change the logo, update `scripts/generate-pwa-icons.mjs` to match it and run `npm run icons` to regenerate the PNG icons. Redeploy the site after changing these files so the public install prompt uses them.

## Ride fare comparison

The Compare button stays in RideBridge. It sends the pickup and drop-off coordinates to `/api/compare` and shows available fare estimates, ride categories, and the lowest starting estimate. It never opens the ride apps. The API works in local Vite and as a Vercel serverless function. The browser can use its current location on HTTPS; on local network HTTP, choose the pickup by tapping the map.

The server returns unavailable for a provider until its authorized fare source is configured. It does not invent prices. Set server-only environment variables locally in `.env` or in Vercel project settings:

- `UBER_ACCESS_TOKEN`: an OAuth token with Uber-approved access to `GET /v1.2/estimates/price`.
- `UBER_COMPARISON_APPROVED=true`: set only with Uber's explicit permission for competitive price comparison. [Uber's fare endpoint documentation](https://developer.uber.com/docs/riders/references/api/v1.2/estimates-price-get) says the endpoint requires approval and its standard terms prohibit competitor comparisons.
- `RAPIDO_PARTNER_FARE_URL`: an HTTPS URL to your approved Rapido partner adapter. There is no undocumented Rapido endpoint hard-coded in RideBridge.
- `RAPIDO_PARTNER_TOKEN`: optional bearer token for that adapter.

The Rapido adapter receives `POST` JSON `{ "pickup": { "lat": 12.9, "lng": 77.5 }, "dropoff": { "lat": 13.3, "lng": 77.6 } }` and responds with `{ "quotes": [{ "name": "Bike", "category": "Bike", "low": 400, "high": 480, "currency": "INR" }] }`. This is RideBridge's adapter contract, not a claim about Rapido's API format. `UBER_ACCESS_TOKEN` and `RAPIDO_PARTNER_TOKEN` must never use the `VITE_` prefix because that would expose them to browsers.
