import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/core/gameplay/constants'
import { DECAL_EDGE_MARGIN, ParticlePool, planSurfaceDecals, surfaceDecalExtent } from '../src/renderers/three-hybrid/combat-fx'

/**
 * The pooled particle system is the only piece of the action feedback that can be
 * exercised without a GPU: it is a fixed array driven by the renderer's snapshot clock.
 * These tests pin the properties the frame budget and the pause behaviour depend on —
 * a constant allocation, a hard capacity, and an animation that is a pure function of
 * the clock rather than of how often `update` happens to be called.
 */
function pool(capacity = 8, tumbling = false): ParticlePool {
  return new ParticlePool({ name: 'test-pool', capacity, texture: new THREE.Texture(), tumbling, seed: 0x1234 })
}

const BURST = { x: 1, y: 1, z: 1, vx: 0.1, vy: 0.1, vz: 0, life: 10, startSize: 0.2, endSize: 1 }

function matrixAt(instances: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4()
  instances.getMatrixAt(index, matrix)
  return matrix
}

describe('ParticlePool', () => {
  it('allocates once and never grows past its capacity', () => {
    const particles = pool(4)
    expect(particles.capacity).toBe(4)
    // An idle pool submits no instances at all, so a quiet board pays nothing for it.
    expect(particles.mesh.count).toBe(0)
    for (let index = 0; index < 40; index += 1) particles.spawn(0, BURST)
    particles.update(1, new THREE.Quaternion())
    // Twelve times more spawns than slots: the oldest are recycled, nothing is added.
    expect(particles.mesh.count).toBe(4)
    expect(particles.live).toBe(4)
    particles.dispose()
  })

  it('ages particles out on the snapshot clock instead of per update call', () => {
    const particles = pool()
    particles.spawn(100, BURST)
    particles.update(100, new THREE.Quaternion())
    expect(particles.live).toBe(1)
    // A single long frame is identical to many short ones: position is integrated from
    // the birth time, so a stalled or hidden tab cannot desynchronise the burst.
    particles.update(105, new THREE.Quaternion())
    const long = matrixAt(particles.mesh, 0).elements.slice(12, 15)
    particles.spawn(100, BURST)
    for (let tick = 100; tick <= 105; tick += 0.5) particles.update(tick, new THREE.Quaternion())
    const stepped = matrixAt(particles.mesh, 1).elements.slice(12, 15)
    expect(stepped[0]).toBeCloseTo(long[0], 10)
    expect(stepped[1]).toBeCloseTo(long[1], 10)
    expect(stepped[2]).toBeCloseTo(long[2], 10)

    particles.update(111, new THREE.Quaternion())
    expect(particles.live).toBe(0)
    particles.dispose()
  })

  it('holds a burst scheduled ahead of the clock at zero scale until it is born', () => {
    const particles = pool()
    particles.spawn(20, BURST)
    particles.update(10, new THREE.Quaternion())
    // Death bursts are scheduled for the middle of the topple, so an unborn slot must
    // stay reserved and invisible rather than being reclaimed as free.
    expect(particles.live).toBe(0)
    expect(matrixAt(particles.mesh, 0).elements[0]).toBe(0)
    particles.update(21, new THREE.Quaternion())
    expect(particles.live).toBe(1)
    expect(matrixAt(particles.mesh, 0).elements[0]).not.toBe(0)
    particles.dispose()
  })

  it('honours a reduced quality budget by claiming fewer slots', () => {
    const particles = pool(8)
    particles.setBudget(0.5)
    for (let index = 0; index < 8; index += 1) particles.spawn(0, BURST)
    particles.update(1, new THREE.Quaternion())
    expect(particles.live).toBe(4)
    particles.dispose()
  })

  it('billboards puffs to the camera and tumbles scraps about their own axis', () => {
    const camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.3, 0))
    const puffs = pool(2, false)
    puffs.spawn(0, BURST)
    puffs.update(1, camera)
    const puffRotation = new THREE.Quaternion()
    matrixAt(puffs.mesh, 0).decompose(new THREE.Vector3(), puffRotation, new THREE.Vector3())
    expect(puffRotation.angleTo(camera)).toBeLessThan(1e-4)

    const scraps = pool(2, true)
    scraps.spawn(0, { ...BURST, spin: 0.3 })
    scraps.update(1, camera)
    const early = new THREE.Quaternion()
    matrixAt(scraps.mesh, 0).decompose(new THREE.Vector3(), early, new THREE.Vector3())
    scraps.update(4, camera)
    const later = new THREE.Quaternion()
    matrixAt(scraps.mesh, 0).decompose(new THREE.Vector3(), later, new THREE.Vector3())
    expect(early.angleTo(camera)).toBeGreaterThan(0.01)
    expect(later.angleTo(early)).toBeGreaterThan(0.01)
    puffs.dispose()
    scraps.dispose()
  })

  it('clears and disposes without leaving instances on the board', () => {
    const particles = pool(3)
    particles.spawn(0, BURST)
    particles.update(1, new THREE.Quaternion())
    expect(particles.live).toBe(1)
    particles.clear()
    expect(particles.live).toBe(0)
    expect(particles.mesh.count).toBe(0)
    expect(matrixAt(particles.mesh, 0).elements[0]).toBe(0)
    particles.dispose()
  })
})

/**
 * The board decals are paint, not scenery: the planner is pure, so the property that
 * matters — no mark ever reaches past the play area, and nothing about the layout comes
 * from an authority PRNG — can be asserted directly.
 */
describe('planSurfaceDecals', () => {
  const bounds = { centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2, worldWidth: ARENA_WIDTH, worldHeight: ARENA_HEIGHT }

  it('keeps every decal footprint inside the play area', () => {
    const decals = planSurfaceDecals(bounds)
    expect(decals.length).toBeGreaterThan(30)
    for (const decal of decals) {
      // The rotated footprint, not the unrotated one: a turned quad covers more board.
      const extent = surfaceDecalExtent(decal)
      expect(Math.abs(decal.x - bounds.centerX) + extent.halfX).toBeLessThanOrEqual(bounds.worldWidth / 2 + 1e-9)
      expect(Math.abs(decal.z - bounds.centerY) + extent.halfZ).toBeLessThanOrEqual(bounds.worldHeight / 2 + 1e-9)
    }
  })

  it('leaves the rail a clear margin of bare board', () => {
    // Scattered marks respect the margin; the deliberate chalk staging spans the mat.
    const scattered = planSurfaceDecals(bounds).filter((decal) => decal.kind === 'scorch' || decal.kind === 'wear' || decal.kind === 'streak')
    expect(scattered.length).toBeGreaterThan(20)
    for (const decal of scattered) {
      const extent = surfaceDecalExtent(decal)
      expect(Math.abs(decal.x - bounds.centerX) + extent.halfX).toBeLessThanOrEqual(bounds.worldWidth / 2 - DECAL_EDGE_MARGIN + 1e-9)
      expect(Math.abs(decal.z - bounds.centerY) + extent.halfZ).toBeLessThanOrEqual(bounds.worldHeight / 2 - DECAL_EDGE_MARGIN + 1e-9)
    }
  })

  it('is reproducible from its cosmetic seed and changes with a different one', () => {
    const first = planSurfaceDecals(bounds)
    expect(planSurfaceDecals(bounds)).toEqual(first)
    expect(planSurfaceDecals(bounds, 0x1234abcd)).not.toEqual(first)
  })

  it('fields the chalk staging as well as the wear and the burns', () => {
    const kinds = new Set(planSurfaceDecals(bounds).map((decal) => decal.kind))
    expect([...kinds].sort()).toEqual(['chalk-box', 'chalk-line', 'scorch', 'streak', 'ticks', 'wear'])
  })

  it('covers a fraction of the board rather than blanketing it', () => {
    // The frame-budget reason the decals are discrete quads: a play-area-sized blended
    // sheet was the most expensive surface in the frame.
    const area = planSurfaceDecals(bounds).reduce((sum, decal) => sum + decal.width * decal.depth, 0)
    expect(area).toBeLessThan(bounds.worldWidth * bounds.worldHeight * 0.5)
  })
})
