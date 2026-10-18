import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from './maps'
import { uberLink, rapidoLink } from './rideLinks'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 }

// Up to 4 photos with author credit (Google requires showing it)
const FIELDS = ['displayName', 'formattedAddress', 'location', 'photos']
const toPhotos = (p) =>
  (p.photos || []).slice(0, 4).map((ph) => ({
    url: ph.getURI({ maxWidth: 800 }),
    author: ph.authorAttributions?.[0]?.displayName || '',
    authorUri: ph.authorAttributions?.[0]?.uri || '',
  }))

export default function App() {
  const mapEl = useRef(null)
  const placesRef = useRef(null) // Places library, for our own search box
  const placeRef = useRef(null) // puts the pin + fills the panel
  const tokenRef = useRef(null) // autocomplete session token
  const markerRef = useRef(null)
  const mapRef = useRef(null)
  const [dest, setDest] = useState(null) // { lat, lng, name, address }
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [active, setActive] = useState(0) // selected photo in the panel
  const [started, setStarted] = useState(false) // welcome screen shown until "Book a ride"
  const [leaving, setLeaving] = useState(false) // welcome screen exit animation
  const [mapType, setMapType] = useState('roadmap')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)

  // New place selected: show its first photo
  useEffect(() => setActive(0), [dest?.name, dest?.address])

  useEffect(() => {
    if (!API_KEY) {
      setError('Add VITE_GOOGLE_MAPS_API_KEY to .env and restart the dev server.')
      return
    }
    let cancelled = false

    ;(async () => {
      await loadGoogleMaps(API_KEY)
      const { Map } = await google.maps.importLibrary('maps')
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker')
      const places = await google.maps.importLibrary('places')
      const { Place } = places
      placesRef.current = places
      if (cancelled) return

      const map = new Map(mapEl.current, {
        center: DEFAULT_CENTER,
        zoom: 15,
        mapId: 'DEMO_MAP_ID', // required for AdvancedMarker; replace with your own Map ID later
        clickableIcons: true,
        disableDefaultUI: true, // our own glass Map/Satellite toggle replaces Google's controls
      })
      mapRef.current = map

      const marker = new AdvancedMarkerElement({ map, gmpDraggable: true })
      markerRef.current = marker

      const place = (pos, name = 'Dropped pin', address = '', photos = []) => {
        marker.position = pos
        setDest({ lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), name, address, photos })
      }
      placeRef.current = place

      // Tap anywhere on the map to set the exact point (e.g. Gate No. 2)
      map.addListener('click', async (e) => {
        if (!e.placeId) return place(e.latLng.toJSON())
        // Tapped a place icon: use its real name and address
        e.stop() // hide Google's default info popup
        place(e.latLng.toJSON())
        try {
          const p = new Place({ id: e.placeId })
          await p.fetchFields({ fields: FIELDS })
          place(p.location.toJSON(), p.displayName, p.formattedAddress, toPhotos(p))
        } catch {
          // keep the dropped pin if details fail
        }
      })

      // Drag pin to fine-tune
      marker.addListener('dragend', () => {
        const p = marker.position
        const pos = typeof p.lat === 'function' ? p.toJSON() : p
        setDest((d) => ({ ...d, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6) }))
      })

      // Center on user's location if allowed
      navigator.geolocation?.getCurrentPosition(
        ({ coords }) => map.setCenter({ lat: coords.latitude, lng: coords.longitude }),
        () => {}
      )
    })().catch((e) => setError(e.message))

    return () => { cancelled = true }
  }, [])

  // Our own search box: fetch suggestions from Places API (New) as the user types
  useEffect(() => {
    const lib = placesRef.current
    if (!lib || query.trim().length < 2) return setSuggestions([])
    let stale = false
    const t = setTimeout(async () => {
      tokenRef.current ??= new lib.AutocompleteSessionToken()
      try {
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: tokenRef.current,
          includedRegionCodes: ['in'],
        })
        if (stale) return
        setSuggestions(
          suggestions
            .filter((s) => s.placePrediction)
            .slice(0, 5)
            .map(({ placePrediction: pp }) => ({
              id: pp.placeId,
              main: pp.mainText?.toString() || pp.text.toString(),
              secondary: pp.secondaryText?.toString() || '',
              prediction: pp,
            }))
        )
      } catch {
        if (!stale) setSuggestions([])
      }
    }, 250) // wait for a pause in typing
    return () => { stale = true; clearTimeout(t) }
  }, [query])

  const pickSuggestion = async (s) => {
    setQuery(s.main)
    setSuggestions([])
    setSearchOpen(false)
    try {
      const p = s.prediction.toPlace()
      await p.fetchFields({ fields: FIELDS })
      tokenRef.current = null // session ends once details are fetched
      const pos = p.location.toJSON()
      mapRef.current.panTo(pos)
      mapRef.current.setZoom(18)
      placeRef.current(pos, p.displayName, p.formattedAddress, toPhotos(p))
    } catch {
      setError('Could not load that place. Try another result.')
    }
  }

  const onSearchKey = (e) => {
    if (e.key === 'Enter' && suggestions[0]) pickSuggestion(suggestions[0])
    if (e.key === 'Escape') setSearchOpen(false)
  }

  const openRapido = async () => {
    const link = rapidoLink(dest)
    if (link) return (window.location.href = link)
    await navigator.clipboard?.writeText(`${dest.lat},${dest.lng}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const switchMapType = (type) => {
    setMapType(type)
    mapRef.current?.setMapTypeId(type)
  }

  const start = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setStarted(true)
    setLeaving(true)
    setTimeout(() => setStarted(true), 450)
  }

  return (
    <div className="app">
      <div className="search">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearchOpen(true) }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
          onKeyDown={onSearchKey}
          placeholder="Search location to drop"
          aria-label="Search location to drop"
          autoComplete="off"
          spellCheck="false"
        />
        {query && (
          <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setSuggestions([]) }}>
            ×
          </button>
        )}
        {searchOpen && suggestions.length > 0 && (
          <ul className="suggestions glass" role="listbox">
            {suggestions.map((s) => (
              <li key={s.id}>
                {/* onMouseDown so the click lands before the input's blur closes the list */}
                <button onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s) }}>
                  <strong>{s.main}</strong>
                  {s.secondary && <span>{s.secondary}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="map" ref={mapEl} />

      <div className="maptype glass" role="group" aria-label="Map style">
        <button aria-pressed={mapType === 'roadmap'} onClick={() => switchMapType('roadmap')}>Map</button>
        <button aria-pressed={mapType === 'hybrid'} onClick={() => switchMapType('hybrid')}>Satellite</button>
      </div>

      <aside className="panel glass">
        {error ? (
          <p className="error">{error}</p>
        ) : !dest ? (
          <p className="hint">Search a place, then tap the exact spot on the map. Drag the pin to adjust.</p>
        ) : (
          <>
            {dest.photos?.length > 0 && (() => {
              const photo = dest.photos[Math.min(active, dest.photos.length - 1)]
              return (
                <div className="gallery">
                  <img className="hero" src={photo.url} alt={dest.name} />
                  {photo.author && (
                    <p className="credit">
                      Photo by {photo.authorUri
                        ? <a href={photo.authorUri} target="_blank" rel="noreferrer">{photo.author}</a>
                        : photo.author}
                    </p>
                  )}
                  {dest.photos.length > 1 && (
                    <div className="thumbs">
                      {dest.photos.map((ph, i) => (
                        <button
                          key={ph.url}
                          className={i === active ? 'thumb active' : 'thumb'}
                          onClick={() => setActive(i)}
                          aria-label={`Show photo ${i + 1}`}
                        >
                          <img src={ph.url} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="dest">
              <h2>{dest.name}</h2>
              {dest.address && <p>{dest.address}</p>}
              <code>{dest.lat}, {dest.lng}</code>
            </div>
            <div className="actions">
              <a className="btn uber" href={uberLink(dest)}>Book with Uber</a>
              <button className="btn rapido" onClick={openRapido}>
                {copied ? 'Coordinates copied' : 'Book with Rapido'}
              </button>
            </div>
          </>
        )}
      </aside>

      {!started && (
        <div
          className={leaving ? 'landing leaving' : 'landing'}
          role="dialog"
          aria-modal="true"
          aria-labelledby="landing-title"
        >
          <span className="orb orb-a" aria-hidden="true" />
          <span className="orb orb-b" aria-hidden="true" />
          <span className="orb orb-c" aria-hidden="true" />

          <div className="landing-card glass">
            {/* You → exact spot: the route draws, then the pin drops */}
            <svg className="route" viewBox="0 0 240 130" aria-hidden="true">
              <path className="route-line" pathLength="1" d="M34 104 C 84 104, 86 50, 136 60 S 186 92, 196 88" />
              <circle className="route-ring" cx="34" cy="104" r="7" />
              <circle className="route-start" cx="34" cy="104" r="6" />
              <ellipse className="route-ripple" cx="196" cy="90" rx="9" ry="3" />
              <g transform="translate(181.6 50.8) scale(0.6)">
                <g className="route-pin">
                  <path d="M24 2C12.4 2 3 11.2 3 22.6 3 38.4 24 62 24 62s21-23.6 21-39.4C45 11.2 35.6 2 24 2z" />
                  <circle cx="24" cy="23" r="8" />
                </g>
              </g>
            </svg>

            <h1 id="landing-title" className="rise" style={{ '--d': '0.15s' }}>Ride to the exact spot.</h1>
            <p className="rise" style={{ '--d': '0.3s' }}>
              Pick your destination on the map, down to the right gate, and book it on Uber or Rapido.
            </p>
            <button className="btn start rise" style={{ '--d': '0.45s' }} onClick={start} autoFocus>
              Book a ride
            </button>
          </div>
        </div>
      )}
    </div>
  )
}