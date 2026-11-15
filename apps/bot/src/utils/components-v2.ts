import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js'
import { coloresEmbed } from './embeds'

type Payload = Record<string, any>

const maximoTexto = 3900

export function comoComponentsV2(payload: string | Payload, incluirFlags = true): Payload {
  const original: Payload = typeof payload === 'string' ? { content: payload } : { ...payload }
  const flags = numeroFlags(original.flags)
  if ((flags & MessageFlags.IsComponentsV2) !== 0 && Array.isArray(original.components)) return original

  const container = new ContainerBuilder().setAccentColor(coloresEmbed.principal)
  let tieneContenido = false
  const agregarTexto = (texto: string) => {
    for (const parte of dividirTexto(texto)) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(parte))
      tieneContenido = true
    }
  }

  if (typeof original.content === 'string' && original.content.length) agregarTexto(original.content)

  const imagenes = new Set<string>()
  for (const bruto of (original.embeds ?? []) as Payload[]) {
    const embed = typeof bruto?.toJSON === 'function' ? bruto.toJSON() as Payload : bruto
    const secciones: string[] = []
    if (embed.author?.name) secciones.push(`**${embed.author.name}**`)
    if (embed.title) secciones.push(`## ${embed.title}`)
    if (embed.description) secciones.push(embed.description)
    for (const campo of embed.fields ?? []) {
      if (campo.name || campo.value) secciones.push(`**${campo.name ?? ''}**\n${campo.value ?? ''}`)
    }
    if (embed.footer?.text) secciones.push(`-# ${embed.footer.text}`)
    const texto = secciones.join('\n\n')
    if (texto) agregarTexto(texto)
    if (typeof embed.image?.url === 'string') imagenes.add(embed.image.url)
    if (typeof embed.thumbnail?.url === 'string') imagenes.add(embed.thumbnail.url)
  }

  for (const archivo of original.files ?? []) {
    const nombre = typeof archivo?.name === 'string' ? archivo.name : undefined
    if (nombre && /\.(png|jpe?g|webp|gif)$/i.test(nombre)) imagenes.add(`attachment://${nombre}`)
  }

  if (imagenes.size) {
    const galeria = new MediaGalleryBuilder().addItems(
      ...[...imagenes].slice(0, 10).map((url) => new MediaGalleryItemBuilder().setURL(url)),
    )
    container.addMediaGalleryComponents(galeria)
    tieneContenido = true
  }

  if (Array.isArray(original.components)) {
    for (const componente of original.components) {
      if (componente instanceof ContainerBuilder) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Contenido interactivo'))
      } else {
        container.addActionRowComponents(componente)
      }
      tieneContenido = true
    }
  }

  if (!tieneContenido) container.addTextDisplayComponents(new TextDisplayBuilder().setContent('\u200b'))

  const { content: _content, embeds: _embeds, components: _components, flags: _flags, ...rest } = original
  return {
    ...rest,
    components: [container],
    ...(incluirFlags && { flags: flags | MessageFlags.IsComponentsV2 }),
  }
}

export function adaptarInteraccionAComponentsV2(interaccion: object) {
  const destino = interaccion as Record<string, (...args: any[]) => any>
  let flagsRespuesta = 0
  for (const nombre of ['reply', 'editReply', 'followUp', 'update']) {
    const metodo = destino[nombre]
    if (typeof metodo !== 'function') continue
    destino[nombre] = (payload: string | Payload, ...resto: any[]) => {
      const convertido = comoComponentsV2(payload)
      if (nombre === 'editReply') convertido.flags = numeroFlags(convertido.flags) | flagsRespuesta | MessageFlags.IsComponentsV2
      else if (nombre === 'reply') flagsRespuesta = numeroFlags(convertido.flags)
      return metodo.call(interaccion, convertido, ...resto)
    }
  }

  const deferReply = destino.deferReply
  if (typeof deferReply === 'function') {
    destino.deferReply = (opciones: Payload = {}, ...resto: any[]) => {
      const flags = numeroFlags(opciones.flags)
      flagsRespuesta = flags | MessageFlags.IsComponentsV2
      return deferReply.call(interaccion, {
        ...opciones,
        flags: flagsRespuesta,
      }, ...resto)
    }
  }
}

export function enviarComponentsV2(destino: { send: (payload: Payload) => Promise<unknown> }, payload: string | Payload) {
  return destino.send(comoComponentsV2(payload))
}

export function editarComponentsV2(destino: { edit: (payload: Payload) => Promise<unknown> }, payload: string | Payload) {
  return destino.edit(comoComponentsV2(payload))
}

function numeroFlags(flags: unknown) {
  if (typeof flags === 'number') return flags
  if (typeof flags === 'object' && flags !== null && 'bitfield' in flags && typeof flags.bitfield === 'number') {
    return flags.bitfield
  }
  return 0
}

function dividirTexto(texto: string) {
  const partes: string[] = []
  let restante = texto
  while (restante.length > maximoTexto && partes.length < 9) {
    let corte = restante.lastIndexOf('\n', maximoTexto)
    if (corte < maximoTexto / 2) corte = maximoTexto
    partes.push(restante.slice(0, corte))
    restante = restante.slice(corte).trimStart()
  }
  if (restante) partes.push(restante.slice(0, maximoTexto))
  return partes.length ? partes : ['\u200b']
}