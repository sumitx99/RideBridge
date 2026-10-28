# RideBridge

1. Google Cloud console: enable **Maps JavaScript API** and **Places API (New)**, create an API key (billing must be on).
2. `cp .env.example .env` and paste the key.
3. `npm install && npm run dev`
4. Open the "Network" URL Vite prints on your phone (same Wi-Fi) and select a drop-off point.

## Install RideBridge from the website

Deploy the site over HTTPS, then open the public URL. On Android Chrome, tap **Install** on RideBridge or use Chrome's **Add to Home screen / Install app** menu. On Mac Chrome, tap the same button or use the browser's install menu. On Mac Safari, use **File → Add to Dock**. The installed app uses this website and needs internet access for Google Maps. This route does not require a Play Store listing or a Mac installer.

The app manifest and icons live in `public/`. If you change the logo, update `scripts/generate-pwa-icons.mjs` to match it and run `npm run icons` to regenerate the PNG icons. Redeploy the site after changing these files so the public install prompt uses them.
