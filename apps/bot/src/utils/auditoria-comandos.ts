import {
  ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js'
import { config } from '../config'
import { coloresEmbed } from './embeds'
import { comoComponentsV2 } from './components-v2'

const comandosSiempre = new Set([
  'ban', 'unban', 'kick', 'timeout', 'clear',
  'sancionar', 'eliminar-sancion', 'advertir', 'quitar-advertencia', 'sanciones', 'advertencias',
  'multar', 'arrestar', 'liberar', 'antecedente',
  'config', 'seguridad', 'staff', 'ticket-panel', 'panel-verificacion', 'verificacion', 'bienvenida',
  'apertura', 'abrir', 'cerrar', 'cierre', 'entorno', 'alerta', 'alerta-reglas', 'embed',
  'item', 'sueldo', 'institucion', 'contratar', 'database', 'agregar-presupuesto', 'soporte',
  'iniciar-servicio-staff',
  'ck', 'auto-reaccionar', 'emoji', 'editar', 'eliminar', 'agregar',
])

export function esComandoPrivilegiado(interaccion: ChatInputCommandInteraction) {
  if (comandosSiempre.has(interaccion.commandName)) return true
  if (interaccion.commandName === 'economia') return ['dar', 'quitar'].includes(interaccion.options.getSubcommand())
  if (interaccion.commandName === 'cedula') return ['buscar', 'editar', 'eliminar'].includes(interaccion.options.getSubcommand())
  if (interaccion.commandName === 'vehiculo') return interaccion.options.getSubcommand() === 'eliminar'
  if (interaccion.commandName === 'codigo-penal') return false
  return false
}

export async function registrarComandoPrivilegiado(
  interaccion: ChatInputCommandInteraction,
  resultado: 'procesado' | 'error',
  error?: unknown,
) {
  if (!esComandoPrivilegiado(interaccion)) return
  const grupo = interaccion.options.getSubcommandGroup(false)
  const subcomando = interaccion.options.getSubcommand(false)
  const ruta = [interaccion.commandName, grupo, subcomando].filter(Boolean).join(' ')
  const opciones = formatearOpciones(interaccion.options.data)
  const errorSeguro = error instanceof Error
    ? error.message.replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 500)
    : undefined
  const fecha = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'America/Santiago',
  }).format(new Date())
  const lineas = [
    `## Auditoría de comando · ${resultado === 'error' ? 'Error' : 'Ejecución'}`,
    `**Acción:** /${ruta}`,
    `**Actor:** <@${interaccion.user.id}> · ${interaccion.user.tag}`,
    `**ID actor:** ${interaccion.user.id}`,
    `**Servidor:** ${interaccion.guild?.name ?? 'DM'} · ${interaccion.guildId ?? 'sin guild'}`,
    `**Canal:** ${interaccion.channelId ?? 'desconocido'}`,
    `**Fecha:** ${fecha}`,
    `**Opciones:**\n${opciones || 'Sin opciones'}`,
    ...(errorSeguro ? [`**Error:** ${errorSeguro}`] : []),
  ]
  const container = new ContainerBuilder()
    .setAccentColor(coloresEmbed.principal)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lineas.join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Registro interno de moderación y administración'))
  const payload = comoComponentsV2({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  })
  const destinos = [config.canales.logModeracion, config.canales.logAdministracion]
  const resultados = await Promise.allSettled(destinos.map(async (canalId) => {
    const canal = await interaccion.client.channels.fetch(canalId)
    if (!canal?.isTextBased() || !('send' in canal)) throw new Error('Canal de auditoría no disponible o no es de texto')
    await canal.send(payload)
  }))
  for (const [indice, resultadoEnvio] of resultados.entries()) {
    if (resultadoEnvio.status === 'rejected') {
      console.error(`No se pudo enviar auditoría al destino ${indice + 1}:`, resultadoEnvio.reason)
    }
  }
}

function formatearOpciones(opciones: readonly any[], ruta = ''): string {
  const lineas: string[] = []
  for (const opcion of opciones) {
    const nombre = ruta ? `${ruta}.${opcion.name}` : opcion.name
    if (Array.isArray(opcion.options) && opcion.options.length) {
      lineas.push(...formatearOpciones(opcion.options, nombre).split('\n'))
      continue
    }
    let valor = opcion.value
    if (opcion.user?.id) valor = `<@${opcion.user.id}> (${opcion.user.id})`
    else if (opcion.role?.id) valor = `<@&${opcion.role.id}> (${opcion.role.id})`
    else if (opcion.channel?.id) valor = `<#${opcion.channel.id}> (${opcion.channel.id})`
    else if (opcion.attachment) valor = opcion.attachment.name ?? opcion.attachment.id ?? 'adjunto'
    if (valor === undefined || valor === null) valor = '—'
    lineas.push(`• **${nombre}:** ${String(valor).slice(0, 500)}`)
  }
  return lineas.join('\n').slice(0, 2500)
}
