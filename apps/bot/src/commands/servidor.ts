import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { crearEmbed, coloresEmbed } from '../utils/embeds'
import { editarComponentsV2, enviarComponentsV2 } from '../utils/components-v2'

const efimero = MessageFlags.Ephemeral
const reglasPorDefecto = 'Respeta las reglas del servidor, mantén el rol y trata a los demás con respeto.'
const guildCommand = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild)

const aperturaData = guildCommand('apertura', 'Vota para abrir el servidor, con plazo máximo de 30 minutos')
  .addIntegerOption((o) => o.setName('meta').setDescription('Votos favorables necesarios para abrir').setRequired(true).setMinValue(1).setMaxValue(500))
const abrirData = guildCommand('abrir', 'Marca el servidor como abierto')
const cerrarData = guildCommand('cerrar', 'Marca el servidor como cerrado')
const cierreData = guildCommand('cierre', 'Anuncia el cierre del servidor')
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo del cierre').setMaxLength(500))
const entornoData = guildCommand('entorno', 'Publica un mensaje dentro del entorno')
  .addStringOption((o) => o.setName('mensaje').setDescription('Mensaje de entorno').setRequired(true).setMaxLength(1800))
const alertaData = guildCommand('alerta', 'Publica una alerta para el servidor')
  .addStringOption((o) => o.setName('mensaje').setDescription('Texto de la alerta').setRequired(true).setMaxLength(1800))
  .addChannelOption((o) => o.setName('canal').setDescription('Canal de destino').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
const reglasData = guildCommand('alerta-reglas', 'Consulta y administra las reglas de alerta')
  .addSubcommand((s) => s.setName('ver').setDescription('Muestra las reglas actuales'))
  .addSubcommand((s) => s.setName('editar').setDescription('Actualiza las reglas')
    .addStringOption((o) => o.setName('texto').setDescription('Reglas').setRequired(true).setMaxLength(1800)))
  .addSubcommand((s) => s.setName('restablecer').setDescription('Restaura las reglas predeterminadas'))

export const servidor = [
  { data: aperturaData, execute: ejecutarApertura },
  { data: abrirData, execute: (i: ChatInputCommandInteraction) => cambiarEstado(i, true) },
  { data: cerrarData, execute: (i: ChatInputCommandInteraction) => cambiarEstado(i, false) },
  { data: cierreData, execute: ejecutarCierre },
  { data: entornoData, execute: ejecutarEntorno },
  { data: alertaData, execute: ejecutarAlerta },
  { data: reglasData, execute: ejecutarReglas },
]

async function ejecutarApertura(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  if (!i.channel?.isSendable()) return i.reply({ content: 'No puedo publicar la votación en este canal.', flags: efimero })
  const meta = i.options.getInteger('meta', true)
  const plazoMs = 30 * 60_000
  const inicio = Date.now()
  const siId = `apertura:si:${i.id}`
  const noId = `apertura:no:${i.id}`
  const botones = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(siId).setLabel('Votar a favor').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(noId).setLabel('Votar en contra').setStyle(ButtonStyle.Secondary),
  )
  await guardarEstado(false, 'Votación de apertura en curso')
  const mensaje = await i.reply({
    embeds: [crearEmbed('Votación de apertura', `Meta: **${meta} votos favorables**.\nPlazo máximo: **30 minutos**.\nEl servidor permanecerá cerrado hasta alcanzar la meta.`, coloresEmbed.aviso)],
    components: [botones()],
    fetchReply: true,
  })
  const votos = new Map<string, boolean>()
  const collector = mensaje.createMessageComponentCollector({ time: plazoMs })
  collector.on('collect', async (boton) => {
    if (boton.customId !== siId && boton.customId !== noId) return
    votos.set(boton.user.id, boton.customId === siId)
    const favor = [...votos.values()].filter(Boolean).length
    const contra = votos.size - favor
    const minutosRestantes = Math.ceil(Math.max(0, plazoMs - (Date.now() - inicio)) / 60_000)
    await boton.update({
      embeds: [crearEmbed('Votación de apertura', `A favor: **${favor}/${meta}** · En contra: **${contra}**\nTiempo restante: **${minutosRestantes} min**.`, coloresEmbed.aviso)],
      components: [botones()],
    })
    if (favor >= meta) collector.stop('meta')
  })
  collector.on('end', async (_recogidas, motivo) => {
    const favor = [...votos.values()].filter(Boolean).length
    const contra = votos.size - favor
    const abierto = motivo === 'meta' && favor >= meta
    if (abierto) await guardarEstado(true, 'Votación aprobada')
    await editarComponentsV2(mensaje, {
      embeds: [crearEmbed(abierto ? 'Meta alcanzada · servidor abierto' : 'Plazo finalizado · servidor cerrado',
        `Votos favorables: **${favor}/${meta}** · En contra: **${contra}**.${abierto ? '' : '\nNo se alcanzó la meta dentro de los 30 minutos.'}`,
        abierto ? coloresEmbed.exito : coloresEmbed.neutro)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(siId).setLabel('Votación finalizada').setStyle(ButtonStyle.Secondary).setDisabled(true),
      )],
    }).catch(() => {})
  })
  return undefined
}

async function cambiarEstado(i: ChatInputCommandInteraction, abierto: boolean) {
  if (!esStaff(i)) return denegado(i)
  await guardarEstado(abierto, `Actualizado por ${i.user.tag}`)
  return i.reply({ content: abierto ? 'El servidor quedó marcado como abierto.' : 'El servidor quedó marcado como cerrado.', flags: efimero })
}

async function ejecutarCierre(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const motivo = i.options.getString('motivo')?.trim() || 'Cierre de jornada.'
  await guardarEstado(false, motivo)
  return i.reply({ embeds: [crearEmbed('Servidor cerrado', motivo, coloresEmbed.error)], allowedMentions: { parse: [] } })
}

async function ejecutarEntorno(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  if (!i.channel?.isSendable()) return i.reply({ content: 'No puedo escribir en este canal.', flags: efimero })
  await enviarComponentsV2(i.channel, { content: `**ENTORNO**\n${i.options.getString('mensaje', true)}`, allowedMentions: { parse: [] } })
  return i.reply({ content: 'Mensaje de entorno publicado.', flags: efimero })
}

async function ejecutarAlerta(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const canalId = i.options.getChannel('canal')?.id ?? i.channelId
  const canal = await i.guild?.channels.fetch(canalId)
  if (!canal?.isTextBased() || !('send' in canal)) return i.reply({ content: 'El canal elegido no permite mensajes.', flags: efimero })
  await enviarComponentsV2(canal, { content: `**ALERTA**\n${i.options.getString('mensaje', true)}`, allowedMentions: { parse: [] } })
  return i.reply({ content: `Alerta publicada en ${canal}.`, flags: efimero })
}

async function ejecutarReglas(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  if (accion !== 'ver' && !esStaff(i)) return denegado(i)
  if (accion === 'ver') {
    const fila = await db.configuracionServidor.findUnique({ where: { clave: 'servidor.alertaReglas' } })
    const texto = typeof fila?.valor === 'string' ? fila.valor : reglasPorDefecto
    return i.reply({ embeds: [crearEmbed('Reglas de alerta', texto)], flags: efimero })
  }
  const texto = accion === 'editar' ? i.options.getString('texto', true).trim() : reglasPorDefecto
  await db.configuracionServidor.upsert({
    where: { clave: 'servidor.alertaReglas' },
    create: { clave: 'servidor.alertaReglas', valor: texto },
    update: { valor: texto },
  })
  return i.reply({ content: accion === 'editar' ? 'Reglas actualizadas.' : 'Reglas restablecidas.', flags: efimero })
}

async function guardarEstado(abierto: boolean, motivo: string) {
  const valor = { abierto, motivo, actualizadoEn: new Date().toISOString() }
  await db.configuracionServidor.upsert({
    where: { clave: 'servidor.estado' },
    create: { clave: 'servidor.estado', valor },
    update: { valor },
  })
}

function esStaff(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  if (!i.inCachedGuild()) return false
  return [process.env.ROL_STAFF_ID, process.env.ROL_MODERADOR_ID, process.env.ROL_SOPORTE_ID, process.env.ROL_ADMIN_ID]
    .some((id) => !!id && i.member.roles.cache.has(id))
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Este comando requiere permisos de staff.', flags: efimero })
}