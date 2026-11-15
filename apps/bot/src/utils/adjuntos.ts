import { Attachment, AttachmentBuilder } from 'discord.js'

const tiposPermitidos = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])
const maximoBytes = 8 * 1024 * 1024

export async function cargarImagenDiscord(archivo: Attachment) {
  const tipo = archivo.contentType?.split(';')[0]?.toLowerCase()
  const extension = tipo ? tiposPermitidos.get(tipo) : undefined
  if (!extension) return { error: 'Adjunta una imagen PNG, JPG o WEBP.' } as const
  if (archivo.size > maximoBytes) return { error: 'La imagen no puede superar 8 MB.' } as const

  const url = new URL(archivo.url)
  if (url.hostname !== 'cdn.discordapp.com') return { error: 'El archivo no proviene del CDN de Discord.' } as const

  const respuesta = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!respuesta.ok) return { error: 'No pude descargar la imagen adjunta.' } as const
  const buffer = Buffer.from(await respuesta.arrayBuffer())
  if (buffer.byteLength > maximoBytes) return { error: 'La imagen no puede superar 8 MB.' } as const

  const nombre = `evidencia-${Date.now()}.${extension}`
  return { archivo: new AttachmentBuilder(buffer, { name: nombre }), nombre } as const
}