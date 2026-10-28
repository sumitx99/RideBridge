const MAX_BODY_BYTES = 4096

const validPoint = (point) => {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null
}

const categoryOf = (name = '') => {
  if (/bike|scooter|motorcycle/i.test(name)) return 'Bike'
  if (/auto|rickshaw|tuk.?tuk/i.test(name)) return 'Auto'
  return 'Cab'
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY_BYTES) throw new Error('Request is too large.')
  }
  return JSON.parse(body || '{}')
}

async function fetchJson(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) throw new Error(`Fare service returned ${response.status}.`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function uberQuotes(pickup, dropoff, config) {
  if (config.UBER_COMPARISON_APPROVED !== 'true' || !config.UBER_ACCESS_TOKEN) {
    return { quotes: [], status: 'Uber fare access is not configured.' }
  }
  const url = new URL('https://api.uber.com/v1.2/estimates/price')
  url.searchParams.set('start_latitude', pickup.lat)
  url.searchParams.set('start_longitude', pickup.lng)
  url.searchParams.set('end_latitude', dropoff.lat)
  url.searchParams.set('end_longitude', dropoff.lng)
  try {
    const result = await fetchJson(url, {
      headers: { Authorization: `Bearer ${config.UBER_ACCESS_TOKEN}`, 'Accept-Language': 'en_IN' },
    })
    const quotes = (Array.isArray(result.prices) ? result.prices : []).flatMap((price) => {
      const low = numberOrNull(price.low_estimate)
      const high = numberOrNull(price.high_estimate)
      if (low === null && high === null) return []
      const name = String(price.localized_display_name || price.display_name || 'Uber ride')
      return [{ provider: 'Uber', name, category: categoryOf(name), low, high,
        display: String(price.estimate || ''), currency: String(price.currency_code || 'INR') }]
    })
    return { quotes, status: quotes.length ? 'ok' : 'No priced Uber rides found for this route.' }
  } catch (error) {
    return { quotes: [], status: error.name === 'AbortError' ? 'Uber fare request timed out.' : error.message }
  }
}

async function rapidoQuotes(pickup, dropoff, config) {
  if (!config.RAPIDO_PARTNER_FARE_URL) {
    return { quotes: [], status: 'Rapido fare access is not configured.' }
  }
  try {
    const endpoint = new URL(config.RAPIDO_PARTNER_FARE_URL)
    if (endpoint.protocol !== 'https:') throw new Error('Rapido partner endpoint must use HTTPS.')
    const result = await fetchJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.RAPIDO_PARTNER_TOKEN ? { Authorization: `Bearer ${config.RAPIDO_PARTNER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ pickup, dropoff }),
    })
    // This is RideBridge's partner-adapter contract, not an undocumented Rapido API schema.
    const quotes = (Array.isArray(result.quotes) ? result.quotes : []).flatMap((quote) => {
      const low = numberOrNull(quote.low)
      const high = numberOrNull(quote.high)
      if (low === null && high === null) return []
      const name = String(quote.name || 'Rapido ride')
      return [{ provider: 'Rapido', name, category: String(quote.category || categoryOf(name)),
        low, high, display: String(quote.display || ''), currency: String(quote.currency || 'INR') }]
    })
    return { quotes, status: quotes.length ? 'ok' : 'No priced Rapido rides found for this route.' }
  } catch (error) {
    return { quotes: [], status: error.name === 'AbortError' ? 'Rapido fare request timed out.' : error.message }
  }
}

export async function handleCompare(req, res, config = process.env) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end(JSON.stringify({ error: 'Use POST for fare comparison.' }))
  }
  try {
    const input = await readJson(req)
    const pickup = validPoint(input.pickup)
    const dropoff = validPoint(input.dropoff)
    if (!pickup || !dropoff) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: 'Select valid pickup and drop-off points.' }))
    }
    const [uber, rapido] = await Promise.all([
      uberQuotes(pickup, dropoff, config), rapidoQuotes(pickup, dropoff, config),
    ])
    res.statusCode = 200
    return res.end(JSON.stringify({
      pickup, dropoff,
      quotes: [...uber.quotes, ...rapido.quotes],
      status: { Uber: uber.status, Rapido: rapido.status },
      fetchedAt: new Date().toISOString(),
    }))
  } catch {
    res.statusCode = 400
    return res.end(JSON.stringify({ error: 'Could not read comparison request.' }))
  }
}

export default function handler(req, res) {
  return handleCompare(req, res)
}
