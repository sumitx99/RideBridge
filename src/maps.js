// Loads the Google Maps JS API once and resolves when it's ready.
let loading
export function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    window.__pin2rideInit = resolve
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=__pin2rideInit`
    s.async = true
    s.onerror = () => reject(new Error('Google Maps script failed to load'))
    document.head.appendChild(s)
  })
  return loading
}
