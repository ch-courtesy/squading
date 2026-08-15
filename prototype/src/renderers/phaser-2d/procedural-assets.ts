import type Phaser from 'phaser'

export const TEAM_TINTS = {
  teal: 0x4bc6bd,
  scarlet: 0xd45d52,
  enemy: 0x835146,
} as const

export const PROCEDURAL_TEXTURE_KEYS = ['cardboard-unit', 'cardboard-shadow', 'cardboard-marker', 'cardboard-effect'] as const

export function createProceduralAssets(scene: Phaser.Scene): void {
  createTexture(scene, 'cardboard-unit', 32, (context) => {
    context.fillStyle = '#e5cfa5'
    context.fillRect(5, 3, 22, 26)
    context.strokeStyle = '#35271d'
    context.lineWidth = 2
    context.strokeRect(5, 3, 22, 26)
    context.fillStyle = '#8b6f4b'
    context.fillRect(9, 7, 14, 5)
  })
  createTexture(scene, 'cardboard-shadow', 32, (context) => {
    context.fillStyle = '#000000'
    context.beginPath()
    context.ellipse(16, 16, 13, 6, 0, 0, Math.PI * 2)
    context.fill()
  })
  createTexture(scene, 'cardboard-marker', 20, (context) => {
    context.fillStyle = '#f0c765'
    context.beginPath()
    context.moveTo(10, 1)
    context.lineTo(18, 10)
    context.lineTo(10, 19)
    context.lineTo(2, 10)
    context.closePath()
    context.fill()
  })
  createTexture(scene, 'cardboard-effect', 18, (context) => {
    context.strokeStyle = '#f5dc79'
    context.lineWidth = 3
    context.beginPath()
    context.arc(9, 9, 6, 0, Math.PI * 2)
    context.stroke()
  })
}

function createTexture(scene: Phaser.Scene, key: string, size: number, draw: (context: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, size, size)
  if (!texture) throw new Error(`Could not create procedural texture: ${key}`)
  draw(texture.context)
  texture.refresh()
}
