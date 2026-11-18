import { describe, expect, it } from 'vitest'
import { distanceM, fitProjection, scaleBar } from './mapProjection'

describe('site map projection', () => {
  const a = { latitude: 6.3, longitude: 0.05 }
  const b = { latitude: 6.301, longitude: 0.052 }

  it('distance is about right near the equator', () => {
    // 0.001° lat ≈ 111 m; 0.002° lng at 6.3° ≈ 221 m.
    expect(distanceM(a, b)).toBeGreaterThan(240)
    expect(distanceM(a, b)).toBeLessThan(255)
  })

  it('fits points inside the box with north up and true proportions', () => {
    const { project, mPerPx } = fitProjection([a, b], { width: 400, height: 300, pad: 20 })
    const pa = project(a)
    const pb = project(b)
    for (const p of [pa, pb]) {
      expect(p.x).toBeGreaterThanOrEqual(20 - 1e-9)
      expect(p.x).toBeLessThanOrEqual(380 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(20 - 1e-9)
      expect(p.y).toBeLessThanOrEqual(280 + 1e-9)
    }
    expect(pb.x).toBeGreaterThan(pa.x) // east is right
    expect(pb.y).toBeLessThan(pa.y) // north is up
    const px = Math.hypot(pb.x - pa.x, pb.y - pa.y)
    expect(px * mPerPx).toBeCloseTo(distanceM(a, b), -1)
  })

  it('centres a single point with a minimum span', () => {
    const { project, mPerPx } = fitProjection([a], { width: 200, height: 200, pad: 0, minSpanM: 200 })
    expect(project(a)).toEqual({ x: 100, y: 100 })
    expect(mPerPx).toBeCloseTo(1)
    expect(fitProjection([], { width: 1, height: 1 })).toBeNull()
  })

  it('scale bar picks a round length', () => {
    expect(scaleBar(1.3, 100)).toMatchObject({ meters: 100, label: '100 m' })
    expect(scaleBar(30, 100)).toMatchObject({ meters: 2000, label: '2 km' })
  })
})
