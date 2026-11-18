/**
 * Static site-map projection (no map library). Farm sites span a few
 * kilometres at most, so an equirectangular projection scaled by cos(lat)
 * is accurate enough and keeps north up with true distances.
 */

const R = 6371008.8 // mean Earth radius, m

/** Metres between two points (haversine). */
export function distanceM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Fit points into a width × height box with `pad` px margin. Returns a
 * `project(point) → {x, y}` and the metres per pixel. A single point (or
 * points closer than `minSpanM`) is centred with a minimum span.
 */
export function fitProjection(points, { width, height, pad = 24, minSpanM = 200 } = {}) {
  if (!points.length) return null
  const lat0 = points.reduce((s, p) => s + p.latitude, 0) / points.length
  const kx = Math.cos((lat0 * Math.PI) / 180) * ((Math.PI * R) / 180) // m per degree lng
  const ky = (Math.PI * R) / 180 // m per degree lat
  const xs = points.map((p) => p.longitude * kx)
  const ys = points.map((p) => p.latitude * ky)
  let minX = Math.min(...xs)
  let maxX = Math.max(...xs)
  let minY = Math.min(...ys)
  let maxY = Math.max(...ys)
  const grow = (lo, hi) => {
    const span = hi - lo
    if (span >= minSpanM) return [lo, hi]
    const mid = (lo + hi) / 2
    return [mid - minSpanM / 2, mid + minSpanM / 2]
  }
  ;[minX, maxX] = grow(minX, maxX)
  ;[minY, maxY] = grow(minY, maxY)
  const innerW = Math.max(1, width - 2 * pad)
  const innerH = Math.max(1, height - 2 * pad)
  const mPerPx = Math.max((maxX - minX) / innerW, (maxY - minY) / innerH)
  const offX = pad + (innerW - (maxX - minX) / mPerPx) / 2
  const offY = pad + (innerH - (maxY - minY) / mPerPx) / 2
  return {
    mPerPx,
    project: (p) => ({
      x: offX + (p.longitude * kx - minX) / mPerPx,
      // SVG y grows downwards; north is up.
      y: offY + (maxY - p.latitude * ky) / mPerPx,
    }),
  }
}

/** A round scale-bar length (m) close to `targetPx` pixels. */
export function scaleBar(mPerPx, targetPx = 100) {
  const raw = mPerPx * targetPx
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= raw).pop() || pow
  return { meters: step, px: step / mPerPx, label: step >= 1000 ? `${step / 1000} km` : `${step} m` }
}
