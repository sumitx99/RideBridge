// Uber: officially documented universal link. Opens the app if installed, else m.uber.com.
// client_id is public (not a secret): it tells Uber the ride came from RideBridge.
const UBER_CLIENT_ID = 'G8kB5ne5VC0JDrQctMPCTJqIXn_Iu293'

export function uberLink({ lat, lng, name, address }) {
  const p = new URLSearchParams({
    action: 'setPickup',
    client_id: UBER_CLIENT_ID,
    pickup: 'my_location',
    'dropoff[latitude]': lat,
    'dropoff[longitude]': lng,
    'dropoff[nickname]': name || 'Destination',
  })
  if (address) p.set('dropoff[formatted_address]', address)
  return `https://m.uber.com/ul/?${p.toString()}`
}

// Rapido (Android only): its manifest registers SplashActivity for `geo:` links,
// so we send a geo intent straight to the Rapido package.
// Unofficial: found in the app's manifest, not documented by Rapido.
const RAPIDO_PKG = 'com.rapido.passenger'
const PLAY_STORE = `https://play.google.com/store/apps/details?id=${RAPIDO_PKG}`

export function rapidoLink({ lat, lng, name }) {
  if (!/Android/i.test(navigator.userAgent)) return null
  const label = encodeURIComponent(name || 'Destination')
  return (
    `intent:${lat},${lng}?q=${lat},${lng}(${label})` +
    `#Intent;scheme=geo;package=${RAPIDO_PKG};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`
  )
}