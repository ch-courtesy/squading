import Phaser from 'phaser'

import type { RenderEffect, RenderSnapshot, RenderUnit } from '../../core/types'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { PROCEDURAL_TEXTURE_KEYS, TEAM_TINTS, createProceduralAssets } from './procedural-assets'

type UnitVisual = {
  readonly shadow: Phaser.GameObjects.Image
  readonly body: Phaser.GameObjects.Image
  readonly marker: Phaser.GameObjects.Image
}

type EffectVisual = Phaser.GameObjects.Image

export type PhaserRendererDiagnostics = {
  readonly rendererType: 'canvas' | 'webgl'
  readonly objectCount: number
  readonly actualChildCount: number
  readonly visualUnitCount: number
  readonly generatedTextureCount: number
  readonly unitDepthOrder: readonly { readonly id: number; readonly depth: number }[]
  readonly snapshotUnitIds: readonly number[]
  readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]
  readonly teamTints: Readonly<Record<'teal' | 'scarlet' | 'enemy', number>>
  readonly markers: { readonly commander: number; readonly downed: number; readonly enemyCommander: number }
  readonly yOrdered: boolean
  readonly visualFrame: { readonly viewportWidth: number; readonly viewportHeight: number; readonly unitCssX: number; readonly unitCssY: number; readonly unitCssSize: number }
  readonly quality: { readonly particleCount: number; readonly dpr: number }
  readonly metrics: RendererMetrics
  isYOrdered(order: readonly { readonly id: number; readonly depth: number }[]): boolean
}

export interface PhaserGameRenderer extends GameRenderer {
  getDiagnostics(): PhaserRendererDiagnostics
}

export type PhaserRendererCapabilities = {
  readonly webglSupported?: boolean
}

const PARTICLE_COUNT = 12

export function createPhaserRenderer(capabilities: PhaserRendererCapabilities = readCapabilities()): PhaserGameRenderer {
  return new PhaserCardboardRenderer(capabilities)
}

class PhaserCardboardRenderer implements PhaserGameRenderer {
  constructor(private readonly capabilities: PhaserRendererCapabilities) {}

  private host: HTMLElement | null = null
  private game: Phaser.Game | null = null
  private scene: Phaser.Scene | null = null
  private snapshot: RenderSnapshot | null = null
  private readonly units = new Map<number, UnitVisual>()
  private readonly effects = new Map<number, EffectVisual>()
  private particles: Phaser.GameObjects.Image[] = []
  private disposed = false
  private requestedDpr = 1
  private dpr = 1
  private particleScale = 1
  private qualityLevel: QualityLevel = 'full'
  private viewportWidth = 1
  private viewportHeight = 1
  private mountToken = 0
  private settleMount: (() => void) | null = null
  private mountPromise: Promise<void> | null = null

  async mount(host: HTMLElement): Promise<void> {
    if (this.game || this.mountPromise) return this.mountPromise ?? Promise.resolve()
    this.host = host
    this.disposed = false
    this.requestedDpr = window.devicePixelRatio || 1
    this.dpr = this.requestedDpr
    this.viewportWidth = Math.max(1, host.clientWidth || 960)
    this.viewportHeight = Math.max(1, host.clientHeight || 540)
    const forceCanvas = new URLSearchParams(window.location.search).get('forceCanvas') === '1'
    const renderer = this
    const token = ++this.mountToken

    this.mountPromise = new Promise<void>((resolve, reject) => {
      const settle = () => {
        if (renderer.settleMount !== settle) return
        renderer.settleMount = null
        renderer.mountPromise = null
        resolve()
      }
      renderer.settleMount = settle
      try {
        this.game = new Phaser.Game({
          type: forceCanvas || this.capabilities.webglSupported === false ? Phaser.CANVAS : Phaser.AUTO,
          width: this.viewportWidth,
          height: this.viewportHeight,
          parent: host,
          backgroundColor: '#201d16',
          banner: false,
          scene: {
            create(this: Phaser.Scene) {
              if (renderer.disposed || token !== renderer.mountToken) {
                settle()
                return
              }
              renderer.scene = this
              createProceduralAssets(this)
              renderer.createParticles()
              renderer.applyResolution()
              settle()
            },
          },
        })
      } catch (error) {
        renderer.settleMount = null
        renderer.mountPromise = null
        reject(error)
      }
    })
    return this.mountPromise
  }

  render(snapshot: RenderSnapshot, _alpha: number): void {
    if (this.disposed || !this.scene) return
    this.snapshot = snapshot
    const visibleUnitIds = new Set(snapshot.units.map((unit) => unit.id))
    for (const unit of snapshot.units) this.renderUnit(unit, snapshot)
    for (const [id, visual] of this.units) {
      if (!visibleUnitIds.has(id)) {
        visual.shadow.destroy()
        visual.body.destroy()
        visual.marker.destroy()
        this.units.delete(id)
      }
    }

    const visibleEffectIds = new Set(snapshot.effects.map((effect) => effect.id))
    for (const effect of snapshot.effects) this.renderEffect(effect, snapshot)
    for (const [id, visual] of this.effects) {
      if (!visibleEffectIds.has(id)) {
        visual.destroy()
        this.effects.delete(id)
      }
    }
    this.scene.children.depthSort()
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed || !this.game) return
    this.requestedDpr = Math.max(1, dpr)
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    this.dpr = this.qualityLevel === 'low-dpr' ? 1 : this.requestedDpr
    this.applyResolution()
  }

  applyQuality(level: QualityLevel): void {
    if (this.disposed) return
    this.qualityLevel = level
    this.particleScale = level === 'full' ? 1 : 0.5
    this.dpr = level === 'low-dpr' ? 1 : this.requestedDpr
    const visibleCount = Math.ceil(PARTICLE_COUNT * this.particleScale)
    this.particles.forEach((particle, index) => particle.setVisible(index < visibleCount))
    this.applyResolution()
  }

  collectMetrics(): RendererMetrics {
    const diagnostic = this.getDiagnostics()
    return diagnostic.metrics
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mountToken += 1
    this.settleMount?.()
    this.units.clear()
    this.effects.clear()
    this.particles = []
    this.game?.destroy(true)
    this.game = null
    this.scene = null
    this.snapshot = null
    this.host = null
  }

  getDiagnostics(): PhaserRendererDiagnostics {
    const snapshot = this.snapshot
    const units = snapshot?.units ?? []
    const markers = {
      commander: units.filter((unit) => unit.kind === 'commander').length,
      downed: units.filter((unit) => unit.state === 'downed').length,
      enemyCommander: units.filter((unit) => unit.kind === 'enemy-commander').length,
    }
    const children = this.scene?.children.list ?? []
    const unitDepthOrder = children
      .filter((child) => child.name.startsWith('unit-body:'))
      .map((child) => ({ id: Number(child.name.slice('unit-body:'.length)), depth: (child as Phaser.GameObjects.Image).depth }))
    const generatedTextureCount = this.scene
      ? this.scene.textures.getTextureKeys().filter((key) => (PROCEDURAL_TEXTURE_KEYS as readonly string[]).includes(key)).length
      : 0
    const firstUnit = this.units.values().next().value as UnitVisual | undefined
    const logicalWidth = this.scene?.scale.width ?? this.viewportWidth
    const logicalHeight = this.scene?.scale.height ?? this.viewportHeight
    const canvasBounds = this.game?.canvas.getBoundingClientRect()
    return {
      rendererType: this.game?.config.renderType === Phaser.CANVAS ? 'canvas' : 'webgl',
      objectCount: children.length,
      actualChildCount: children.length,
      visualUnitCount: this.units.size,
      generatedTextureCount,
      unitDepthOrder,
      snapshotUnitIds: units.map((unit) => unit.id),
      snapshotUnits: units.flatMap((unit) => {
        const visual = this.units.get(unit.id)
        return visual ? [{ id: unit.id, x: unit.x, y: unit.y, tint: visual.body.tintTopLeft }] : []
      }),
      teamTints: TEAM_TINTS,
      markers,
      yOrdered: this.isYOrdered(unitDepthOrder),
      visualFrame: {
        viewportWidth: logicalWidth,
        viewportHeight: logicalHeight,
        unitCssX: firstUnit && canvasBounds ? firstUnit.body.x * (canvasBounds.width / logicalWidth) : 0,
        unitCssY: firstUnit && canvasBounds ? firstUnit.body.y * (canvasBounds.height / logicalHeight) : 0,
        unitCssSize: firstUnit && canvasBounds ? firstUnit.body.displayWidth * (canvasBounds.width / logicalWidth) : 0,
      },
      quality: { particleCount: children.filter((child) => child.name === 'effect-particle' && (child as Phaser.GameObjects.Image).visible).length, dpr: this.dpr },
      metrics: {
        drawCalls: null,
        textures: generatedTextureCount,
        geometries: null,
      },
      isYOrdered: (order) => this.isYOrdered(order),
    }
  }

  isYOrdered(order: readonly { readonly id: number; readonly depth: number }[]): boolean {
    return order.every((entry, index) => index === 0 || entry.depth >= order[index - 1].depth)
  }

  private renderUnit(unit: RenderUnit, snapshot: RenderSnapshot): void {
    if (!this.scene) return
    const point = toScreen(unit.x, unit.y, snapshot, this.scene.scale.width, this.scene.scale.height)
    let visual = this.units.get(unit.id)
    if (!visual) {
      visual = {
        shadow: this.scene.add.image(point.x, point.y, 'cardboard-shadow').setAlpha(0.26),
        body: this.scene.add.image(point.x, point.y, 'cardboard-unit'),
        marker: this.scene.add.image(point.x, point.y, 'cardboard-marker'),
      }
      visual.body.name = `unit-body:${unit.id}`
      this.units.set(unit.id, visual)
    }
    const tint = TEAM_TINTS[unit.team]
    const size = unit.kind === 'commander' || unit.kind === 'enemy-commander' ? 1.25 : unit.state === 'downed' ? 0.85 : 1
    const depth = point.y
    visual.shadow.setPosition(point.x + 3, point.y + 8).setScale(size, size * 0.55).setDepth(depth - 0.25)
    visual.body.setPosition(point.x, point.y).setScale(size).setDepth(depth).setTint(tint)
    visual.body.setRotation(unit.state === 'downed' ? Math.PI / 2 : 0)
    const showMarker = unit.kind === 'commander' || unit.kind === 'enemy-commander' || unit.state === 'downed'
    visual.marker.setVisible(showMarker).setPosition(point.x, point.y - 22 * size).setDepth(depth + 0.25)
    visual.marker.setTint(unit.state === 'downed' ? 0xf4d66c : unit.kind === 'enemy-commander' ? 0xf08a6b : 0xf2d580)
  }

  private renderEffect(effect: RenderEffect, snapshot: RenderSnapshot): void {
    if (!this.scene) return
    const point = toScreen(effect.x, effect.y, snapshot, this.scene.scale.width, this.scene.scale.height)
    const visual = this.effects.get(effect.id) ?? this.scene.add.image(point.x, point.y, 'cardboard-effect')
    visual.setPosition(point.x, point.y - 15).setDepth(point.y + 1).setTint(effect.team ? TEAM_TINTS[effect.team] : 0xf5dc79)
    this.effects.set(effect.id, visual)
  }

  private createParticles(): void {
    if (!this.scene) return
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) =>
      this.scene!.add.image(18 + (index % 6) * 14, 18 + Math.floor(index / 6) * 14, 'cardboard-effect').setAlpha(0.25).setScale(0.4).setName('effect-particle'),
    )
  }

  private applyResolution(): void {
    if (this.disposed || !this.game) return
    const backingWidth = Math.max(1, Math.round(this.viewportWidth * this.dpr))
    const backingHeight = Math.max(1, Math.round(this.viewportHeight * this.dpr))
    this.game.scale.resize(this.viewportWidth, this.viewportHeight)
    this.game.canvas.width = backingWidth
    this.game.canvas.height = backingHeight
    this.game.canvas.style.width = `${this.viewportWidth}px`
    this.game.canvas.style.height = `${this.viewportHeight}px`
    this.game.renderer.resize(backingWidth, backingHeight)
    this.scene?.cameras.main.setViewport(0, 0, backingWidth, backingHeight).setOrigin(0, 0).setZoom(this.dpr)
  }
}

function readCapabilities(): PhaserRendererCapabilities {
  return (window as Window & { __TABLETOP_RENDERER_CAPABILITIES__?: PhaserRendererCapabilities }).__TABLETOP_RENDERER_CAPABILITIES__ ?? {}
}

function toScreen(x: number, y: number, snapshot: RenderSnapshot, width: number, height: number): { x: number; y: number } {
  return {
    x: ((x - snapshot.camera.centerX) / snapshot.camera.worldWidth + 0.5) * width,
    y: ((y - snapshot.camera.centerY) / snapshot.camera.worldHeight + 0.5) * height,
  }
}
