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

// Nearby categories (Places API (New) place types)
const CATEGORIES = [
  { id: 'restaurant', label: 'Restaurants', types: ['restaurant'] },
  { id: 'cafe', label: 'Cafes', types: ['cafe'] },
  { id: 'hotel', label: 'Hotels', types: ['lodging'] },
  { id: 'todo', label: 'Things to do', types: ['tourist_attraction', 'museum', 'park'] },
  { id: 'shopping', label: 'Shopping', types: ['shopping_mall'] },
  { id: 'hospital', label: 'Hospitals', types: ['hospital'] },
]
const NEARBY_FIELDS = ['id', 'displayName', 'location', 'formattedAddress', 'rating', 'userRatingCount']
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export default function App() {
  const mapEl = useRef(null)
  const speechRef = useRef(null)
  const placesRef = useRef(null) // Places library, for our own search box
  const placeRef = useRef(null) // puts the pin + fills the panel
  const tokenRef = useRef(null) // autocomplete session token
  const markerRef = useRef(null)
  const selectRef = useRef(null) // select a Google place by id (pin + details + photos)
  const poiRef = useRef([]) // numbered markers for nearby results
  const chipsRef = useRef(null) // category carousel
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
  const [category, setCategory] = useState(null) // active nearby category
  const [results, setResults] = useState([])
  const [loadingResults, setLoadingResults] = useState(false)
  const [chipEdges, setChipEdges] = useState({ prev: false, next: false })
  const [listening, setListening] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installHelp, setInstallHelp] = useState(false)
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)

  useEffect(() => {
    const onInstallReady = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallHelp(false)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onInstallReady)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallReady)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

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

      // Pin a Google place right away, then fill in its real name, address and photos
      const selectPlace = async (id, pos, name) => {
        place(pos, name)
        try {
          const p = new Place({ id })
          await p.fetchFields({ fields: FIELDS })
          place(p.location.toJSON(), p.displayName, p.formattedAddress, toPhotos(p))
        } catch {
          // keep the pin if details fail
        }
      }
      selectRef.current = selectPlace

      // Tap anywhere on the map to set the exact point (e.g. Gate No. 2)
      map.addListener('click', (e) => {
        if (!e.placeId) return place(e.latLng.toJSON())
        e.stop() // tapped a place icon: hide Google's default info popup
        selectPlace(e.placeId, e.latLng.toJSON())
      })

      // Drag pin to fine-tune
      marker.addListener('dragend', () => {
        const p = marker.position
        const pos = typeof p.lat === 'function' ? p.toJSON() : p
        setDest((d) => ({ ...d, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6) }))
      })

      // Center on user's location if allowed
      navigator.geolocation?.getCurrentPosition(
        ({ coords }) => {
          const pos = { lat: coords.latitude, lng: coords.longitude }
          map.setCenter(pos)
        },
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

  const toggleVoiceSearch = () => {
    if (listening) {
      speechRef.current?.stop()
      setListening(false)
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceMessage('Voice search is not supported in this browser. Try Chrome or type your destination.')
      return
    }
    setVoiceMessage('')
    const recognition = new SpeechRecognition()
    speechRef.current = recognition
    recognition.lang = navigator.language?.startsWith('hi') ? 'hi-IN' : 'en-IN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => { setListening(true); setSearchOpen(true) }
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript?.trim()
      if (spoken) {
        setQuery(spoken)
        setSearchOpen(true)
      }
    }
    recognition.onerror = (event) => {
      setListening(false)
      const messages = {
        'not-allowed': 'Allow microphone access in your browser to use voice search.',
        'service-not-allowed': 'Voice search is blocked by your browser settings.',
        'no-speech': 'I didn’t hear anything. Tap the mic and try again.',
        'network': 'Voice search needs an internet connection. Try again or type your destination.',
      }
      setVoiceMessage(messages[event.error] || 'Could not start voice search. Please try again.')
    }
    recognition.onend = () => setListening(false)
    try {
      recognition.start()
    } catch {
      setListening(false)
      setVoiceMessage('Could not start voice search. Please try again.')
    }
  }

  useEffect(() => () => speechRef.current?.abort(), [])

  // ---- Category carousel: show arrows only when there is more to scroll ----
  const updateChipEdges = () => {
    const el = chipsRef.current
    if (!el) return
    setChipEdges({
      prev: el.scrollLeft > 2,
      next: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    // Re-measure whenever the carousel's size changes (first layout, fonts, window resize)
    const ro = new ResizeObserver(updateChipEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const mobile = window.matchMedia('(max-width: 767px)')
    const alignFirstCategory = () => {
      if (!mobile.matches) return
      el.scrollLeft = 0
      updateChipEdges()
    }
    alignFirstCategory()
    mobile.addEventListener('change', alignFirstCategory)
    return () => mobile.removeEventListener('change', alignFirstCategory)
  }, [])
  const scrollChips = (dir) => {
    const el = chipsRef.current
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  // ---- Nearby categories ----
  const clearPoi = () => {
    poiRef.current.forEach((m) => { m.map = null })
    poiRef.current = []
  }

  const hidePin = () => {
    if (markerRef.current) markerRef.current.position = null
  }

  const pickResult = (r) => {
    mapRef.current.panTo(r.pos)
    selectRef.current(r.id, r.pos, r.name)
  }

  const showCategory = async (cat) => {
    const map = mapRef.current
    const lib = placesRef.current
    if (!map || !lib) return
    clearPoi()
    if (category === cat.id) return setCategory(null) // tap again to close

    setCategory(cat.id)
    setResults([])
    setDest(null)
    hidePin()
    setLoadingResults(true)
    try {
      const { places } = await lib.Place.searchNearby({
        fields: NEARBY_FIELDS,
        locationRestriction: { center: map.getCenter(), radius: 2000 },
        includedTypes: cat.types,
        maxResultCount: 10,
      })
      const list = places.map((p) => ({
        id: p.id,
        name: p.displayName,
        address: p.formattedAddress,
        rating: p.rating,
        count: p.userRatingCount,
        pos: p.location.toJSON(),
      }))
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker')
      const bounds = new google.maps.LatLngBounds()
      poiRef.current = list.map((r, i) => {
        const el = document.createElement('div')
        el.className = 'poi-marker'
        el.textContent = i + 1
        const m = new AdvancedMarkerElement({ map, position: r.pos, content: el, title: r.name })
        m.addListener('click', () => pickResult(r))
        bounds.extend(r.pos)
        return m
      })
      if (list.length) {
        const desktop = window.matchMedia('(min-width: 768px)').matches
        map.fitBounds(bounds, desktop
          ? { top: 120, right: 420, bottom: 40, left: 40 }
          : { top: 140, right: 30, bottom: 320, left: 30 })
      }
      setResults(list)
    } catch {
      setResults([])
    } finally {
      setLoadingResults(false)
    }
  }

  const backToResults = () => {
    setDest(null)
    hidePin()
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

  const installApp = async () => {
    if (!installPrompt) return setInstallHelp(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      if (choice.outcome !== 'accepted') setInstallHelp(true)
    } catch {
      setInstallHelp(true)
    }
  }

  const installInstructions = !window.isSecureContext
    ? 'Open the deployed HTTPS RideBridge website in Chrome or Safari, then install it from there.'
    : /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
      ? 'In Safari, choose File → Add to Dock. RideBridge will appear in your Applications and Dock.'
      : /Android/.test(navigator.userAgent)
        ? 'In Chrome, tap ⋮ → Add to Home screen → Install app.'
        : 'Use your browser menu → Install RideBridge. On Mac Safari, choose File → Add to Dock.'

  return (
    <div className="app">
      <div className="brand" aria-label="RideBridge home">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-name">ride<span>bridge</span></span>
        <span className="brand-tagline">YOUR RIDE, RIGHT THERE</span>
        {!installed && <button className="brand-install" type="button" onClick={installApp} aria-label="Install RideBridge app">↓ <span>Install</span></button>}
      </div>
      <div className="map-wash" aria-hidden="true" />
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
          placeholder={listening ? 'Listening… say your destination' : 'Where do you want to go?'}
          aria-label="Search destination"
          autoComplete="off"
          spellCheck="false"
        />
        {query && (
          <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setSuggestions([]) }}>
            ×
          </button>
        )}
        <button
          className={listening ? 'voice-button listening' : 'voice-button'}
          type="button"
          aria-label={listening ? 'Stop voice search' : 'Search by voice'}
          aria-pressed={listening}
          title={listening ? 'Stop listening' : 'Search by voice'}
          onClick={toggleVoiceSearch}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" />
          </svg>
        </button>
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
      {voiceMessage && <div className="voice-status" role="status">{voiceMessage}<button type="button" aria-label="Dismiss message" onClick={() => setVoiceMessage('')}>×</button></div>}
      <div className="map" ref={mapEl} />

      <div className="chips-wrap">
        {chipEdges.prev && (
          <button className="chip-arrow glass" aria-label="Previous categories" onClick={() => scrollChips(-1)}>‹</button>
        )}
        <div className="chips" role="toolbar" aria-label="Nearby places" ref={chipsRef} onScroll={updateChipEdges}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? 'chip active' : 'chip'}
              aria-pressed={category === c.id}
              onClick={() => showCategory(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {chipEdges.next && (
          <button className="chip-arrow glass" aria-label="More categories" onClick={() => scrollChips(1)}>›</button>
        )}
      </div>

      <div className="maptype glass" role="group" aria-label="Map style">
        <button aria-pressed={mapType === 'roadmap'} onClick={() => switchMapType('roadmap')}>Map</button>
        <button aria-pressed={mapType === 'hybrid'} onClick={() => switchMapType('hybrid')}>Satellite</button>
      </div>

      <aside className="panel glass">
        {error ? (
          <p className="error">{error}</p>
        ) : !dest && category ? (
          <div className="results">
            <h3>{CATEGORIES.find((c) => c.id === category).label} nearby</h3>
            {loadingResults ? (
              <p className="hint">Searching nearby…</p>
            ) : results.length === 0 ? (
              <p className="hint">Nothing found around here. Move the map and tap the category again.</p>
            ) : (
              <ol>
                {results.map((r, i) => (
                  <li key={r.id}>
                    <button onClick={() => pickResult(r)}>
                      <span className="num">{i + 1}</span>
                      <span className="info">
                        <strong>{r.name}</strong>
                        {r.rating && <em>{r.rating.toFixed(1)} ★ ({compact(r.count || 0)})</em>}
                        {r.address && <span>{r.address}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : !dest ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">↗</span>
            <p className="eyebrow">THE LAST MILE, MADE EASY</p>
            <h2>Choose your drop-off</h2>
            <p className="hint">Search a place or tap the map to set the exact entrance. You can fine-tune the pin anytime.</p>
            <div className="how-it-works"><span>1 <b>Pin your spot</b></span><i /><span>2 <b>Choose a ride</b></span></div>
          </div>
        ) : (
          <>
            {category && (
              <button className="back" onClick={backToResults}>← Back to results</button>
            )}
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
              <code><span className="coordinate-dot" /> Drop-off point · {dest.lat}, {dest.lng}</code>
            </div>
            <div className="actions">
              <a className="btn uber" href={uberLink(dest)} target="_blank" rel="noreferrer"><span className="ride-icon">U</span><span>
                Open Uber<small>View available rides and fares</small></span><b>↗</b>
              </a>
              <button className="btn rapido" onClick={openRapido}>
                <span className="ride-icon">R</span><span>
                {copied ? 'Coordinates copied' : 'Open Rapido'}<small>{copied ? 'Paste coordinates in Rapido' : 'View available rides and fares'}</small></span><b>↗</b>
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

            <div className="landing-brand"><span className="brand-mark"><span /><span /><span /></span> ride<span>bridge</span></div>
            <h1 id="landing-title" className="rise" style={{ '--d': '0.15s' }}>Your ride. Your exact spot.</h1>
            <p className="rise" style={{ '--d': '0.3s' }}>
              Pick your destination on the map, down to the right gate, and book it on Uber or Rapido.
            </p>
            <button className="btn start rise" style={{ '--d': '0.45s' }} onClick={start} autoFocus>
              Book a ride
            </button>
            {!installed && <button className="landing-install rise" style={{ '--d': '0.55s' }} type="button" onClick={installApp}>
              ↓ Install RideBridge app
            </button>}
          </div>
        </div>
      )}
      {installHelp && <div className="install-help-backdrop" onClick={() => setInstallHelp(false)}>
        <section className="install-help" role="dialog" aria-modal="true" aria-labelledby="install-help-title" onClick={(event) => event.stopPropagation()}>
          <img src="/ridebridge-192.png" width="52" height="52" alt="" />
          <h2 id="install-help-title">Install RideBridge</h2>
          <p>{installInstructions}</p>
          {!window.isSecureContext && <a href="https://ride-bridge-phi.vercel.app/">Open RideBridge website</a>}
          <button type="button" onClick={() => setInstallHelp(false)}>Got it</button>
        </section>
      </div>}
    </div>
  )
}
