import {
  AuditLogEvent,
  Client,
  Events,
  Guild,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js'
import { config } from '../config'
import { crearEmbed } from '../utils/embeds'
import { enviarComponentsV2 } from '../utils/components-v2'

const ventanaMs = 10_000
const retencionEventosMs = 60_000
const umbralEventos = 3
const avisoSinAuditoriaMs = 60_000

type AccionAuditada =
  | AuditLogEvent.ChannelCreate
  | AuditLogEvent.ChannelDelete
  | AuditLogEvent.RoleCreate
  | AuditLogEvent.RoleDelete

interface EventoEstructural {
  guild: Guild
  accionAuditada: AccionAuditada
  accion: string
  objetivoId: string
  objetivoNombre: string
}

interface AccionReciente {
  fecha: number
  detalle: string
}

const actividadPorActor = new Map<string, AccionReciente[]>()
const entradasAuditadas = new Map<string, number>()
const baneosEnProceso = new Map<string, number>()
const avisosFalloAuditoria = new Map<string, number>()
const colasPorServidor = new Map<string, Promise<void>>()

export function instalarProteccionAntiRaid(client: Client) {
  client.on(Events.ChannelCreate, (canal) => {
    if (canal.isDMBased()) return
    encolar({
      guild: canal.guild,
      accionAuditada: AuditLogEvent.ChannelCreate,
      accion: 'creación de canal',
      objetivoId: canal.id,
      objetivoNombre: canal.name,
    })
  })
  client.on(Events.ChannelDelete, (canal) => {
    if (canal.isDMBased()) return
    encolar({
      guild: canal.guild,
      accionAuditada: AuditLogEvent.ChannelDelete,
      accion: 'borrado de canal',
      objetivoId: canal.id,
      objetivoNombre: canal.name,
    })
  })
  client.on(Events.GuildRoleCreate, (rol) => encolar({
    guild: rol.guild,
    accionAuditada: AuditLogEvent.RoleCreate,
    accion: 'creación de rol',
    objetivoId: rol.id,
    objetivoNombre: rol.name,
  }))
  client.on(Events.GuildRoleDelete, (rol) => encolar({
    guild: rol.guild,
    accionAuditada: AuditLogEvent.RoleDelete,
    accion: 'borrado de rol',
    objetivoId: rol.id,
    objetivoNombre: rol.name,
  }))
}

function encolar(evento: EventoEstructural) {
  const anterior = colasPorServidor.get(evento.guild.id) ?? Promise.resolve()
  const siguiente = anterior
    .then(() => procesarEvento(evento))
    .catch(async (error) => {
      console.error(`[Anti-raid] Error al procesar ${evento.accion} en ${evento.guild.id}:`, error)
      await avisarFalloAuditoria(evento.guild, 'No se pudo analizar una acción de canales o roles. Revisa que el bot tenga **Ver registro de auditoría**.')
    })
  colasPorServidor.set(evento.guild.id, siguiente)
  void siguiente.finally(() => {
    if (colasPorServidor.get(evento.guild.id) === siguiente) colasPorServidor.delete(evento.guild.id)
  })
}

async function procesarEvento(evento: EventoEstructural) {
  const bot = evento.guild.members.me ?? await evento.guild.members.fetchMe()
  if (!bot.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    await avisarFalloAuditoria(evento.guild, 'El anti-raid no puede identificar quién hizo el cambio: al bot le falta **Ver registro de auditoría**.')
    return
  }

  const entrada = await buscarEntradaAuditoria(evento)
  if (!entrada) {
    await avisarFalloAuditoria(evento.guild, `No pude identificar al autor de la ${evento.accion} de **${evento.objetivoNombre}**. No se aplicó ningún veto.`)
    return
  }

  limpiarRegistros()
  if (entradasAuditadas.has(entrada.id)) return
  entradasAuditadas.set(entrada.id, Date.now())

  const actorId = entrada.executorId
  if (!actorId || actorId === bot.id || actorId === evento.guild.ownerId) return

  const claveActor = `${evento.guild.id}:${actorId}`
  const ahora = Date.now()
  const historial = (actividadPorActor.get(claveActor) ?? [])
    .filter((accion) => ahora - accion.fecha <= retencionEventosMs)
  const nuevaAccion = { fecha: entrada.createdTimestamp, detalle: `${evento.accion}: ${evento.objetivoNombre}` }
  historial.push(nuevaAccion)
  actividadPorActor.set(claveActor, historial)

  const accionesRecientes = historial.filter((accion) =>
    nuevaAccion.fecha >= accion.fecha && nuevaAccion.fecha - accion.fecha <= ventanaMs,
  )
  if (accionesRecientes.length < umbralEventos) return

  const claveBaneo = claveActor
  if ((baneosEnProceso.get(claveBaneo) ?? 0) > ahora) return
  baneosEnProceso.set(claveBaneo, ahora + retencionEventosMs)
  actividadPorActor.delete(claveActor)
  await banearActor(evento.guild, actorId, accionesRecientes)
}

async function buscarEntradaAuditoria(evento: EventoEstructural) {
  for (let intento = 0; intento < 5; intento++) {
    const auditoria = await evento.guild.fetchAuditLogs({
      type: evento.accionAuditada,
      limit: 50,
    })
    const entrada = auditoria.entries.find((registro) =>
      registro.targetId === evento.objetivoId &&
      Math.abs(Date.now() - registro.createdTimestamp) <= 30_000,
    )
    if (entrada) return entrada
    if (intento < 4) await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return undefined
}

async function banearActor(guild: Guild, actorId: string, acciones: AccionReciente[]) {
  const resumen = acciones.map((accion) => `• ${accion.detalle}`).join('\n')
  let actor: GuildMember
  try {
    actor = await guild.members.fetch(actorId)
  } catch (error) {
    console.error(`[Anti-raid] No se pudo obtener al actor ${actorId}:`, error)
    await enviarAlerta(guild, 'Anti-raid detectado', `Se detectaron ${acciones.length} cambios de canales o roles en 10 segundos, pero no pude obtener al actor <@${actorId}> para vetarlo.\n\n${resumen}`)
    return
  }

  if (!actor.bannable) {
    await enviarAlerta(guild, 'Anti-raid detectado · veto fallido', `Se detectaron ${acciones.length} cambios de canales o roles en 10 segundos. No pude vetar a <@${actorId}> por permisos o jerarquía del bot.\n\n${resumen}`)
    return
  }

  try {
    await actor.ban({ reason: `Anti-raid: ${acciones.length} cambios de canales o roles en ${ventanaMs / 1000} segundos.` })
    await enviarAlerta(guild, 'Anti-raid · actor vetado', `Se vetó a <@${actorId}> tras ${acciones.length} cambios de canales o roles en 10 segundos.\n\n${resumen}`)
  } catch (error) {
    console.error(`[Anti-raid] No se pudo vetar al actor ${actorId}:`, error)
    await enviarAlerta(guild, 'Anti-raid detectado · veto fallido', `Se detectó una posible raid, pero Discord no permitió vetar a <@${actorId}>. Revisa los permisos y la jerarquía del bot.\n\n${resumen}`)
  }
}

async function avisarFalloAuditoria(guild: Guild, detalle: string) {
  const ahora = Date.now()
  if ((avisosFalloAuditoria.get(guild.id) ?? 0) > ahora) return
  avisosFalloAuditoria.set(guild.id, ahora + avisoSinAuditoriaMs)
  await enviarAlerta(guild, 'Anti-raid · protección limitada', detalle)
}

async function enviarAlerta(guild: Guild, titulo: string, detalle: string) {
  try {
    const canal = await guild.channels.fetch(config.canales.logAdministracion)
    if (!canal?.isSendable()) throw new Error('El canal de registros administrativos no está disponible.')
    await enviarComponentsV2(canal, {
      embeds: [crearEmbed(titulo, detalle, 0xed4245)],
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Anti-raid] No se pudo publicar la alerta en ${config.canales.logAdministracion}:`, error)
  }
}

function limpiarRegistros() {
  const ahora = Date.now()
  for (const [id, fecha] of entradasAuditadas) {
    if (ahora - fecha > retencionEventosMs) entradasAuditadas.delete(id)
  }
  for (const [id, venceEn] of baneosEnProceso) {
    if (venceEn <= ahora) baneosEnProceso.delete(id)
  }
  for (const [id, venceEn] of avisosFalloAuditoria) {
    if (venceEn <= ahora) avisosFalloAuditoria.delete(id)
  }
  for (const [id, acciones] of actividadPorActor) {
    const recientes = acciones.filter((accion) => ahora - accion.fecha <= retencionEventosMs)
    if (recientes.length) actividadPorActor.set(id, recientes)
    else actividadPorActor.delete(id)
  }
}
