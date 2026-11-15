import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  InteractionContextType,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  User,
  ModalSubmitInteraction,
} from 'discord.js'
import { CategoriaTicket, db } from '@rp-chile/db'
import { config } from '../config'
import { asegurarUsuario } from '../utils/usuarios'
import { crearEmbed } from '../utils/embeds'
import { enviarComponentsV2 } from '../utils/components-v2'

const efimero = MessageFlags.Ephemeral

export const soporteData = new SlashCommandBuilder()
  .setName('soporte')
  .setDescription('Abre un ticket privado con el equipo de soporte')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('asunto')
      .setDescription('Motivo de contacto')
      .setRequired(true)
      .setMaxLength(100),
  )
  .addStringOption((o) =>
    o
      .setName('categoria')
      .setDescription('Tipo de solicitud')
      .addChoices(
        { name: 'Soporte', value: 'SOPORTE' },
        { name: 'Reporte', value: 'REPORTE' },
        { name: 'Apelación', value: 'APELACION' },
        { name: 'Otro', value: 'OTRO' },
      ),
  )

export const solicitarRolData = new SlashCommandBuilder()
  .setName('solicitar-rol')
  .setDescription('Postula a un cargo de una institución')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Experiencia y motivo de postulación').setRequired(true).setMaxLength(1000))

export const ticketPanelData = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Publica el panel para abrir tickets')
  .setContexts(InteractionContextType.Guild)

const ticketModalId = 'ticketpanel:modal'

export const calificarData = new SlashCommandBuilder()
  .setName('calificar')
  .setDescription('Envía una calificación al equipo')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) => o.setName('nota').setDescription('Nota de 1 a 5').setRequired(true).setMinValue(1).setMaxValue(5))
  .addStringOption((o) => o.setName('comentario').setDescription('Comentario opcional').setMaxLength(500))

export const comunidad = [
  { data: soporteData, execute: ejecutarSoporte },
  { data: ticketPanelData, execute: ejecutarTicketPanel },
  { data: solicitarRolData, execute: ejecutarSolicitud },
  { data: calificarData, execute: ejecutarCalificacion },
]

async function ejecutarSoporte(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  if (!config.roles.soporte) return i.reply({ content: 'Falta configurar ROL_SOPORTE_ID.', flags: efimero })
  const asunto = i.options.getString('asunto', true)
  const categoria = (i.options.getString('categoria') ?? 'SOPORTE') as CategoriaTicket
  const resultado = await crearTicket(i.guild, i.user, asunto, categoria)
  if ('existente' in resultado && resultado.existente) return i.reply({ content: `Ya tienes un ticket abierto: <#${resultado.existente.canalDiscordId}>`, flags: efimero })
  return i.reply({ content: `Ticket **#${resultado.ticket.numero}** creado: ${resultado.canal}.`, flags: efimero })
}

async function ejecutarTicketPanel(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden publicar el panel de tickets.', flags: efimero })
  if (!i.channel?.isSendable()) return i.reply({ content: 'No puedo escribir en este canal.', flags: efimero })
  const boton = new ButtonBuilder().setCustomId('ticketpanel:abrir').setLabel('Abrir ticket').setStyle(ButtonStyle.Primary)
  await enviarComponentsV2(i.channel, {
    embeds: [crearEmbed('Centro de soporte', 'Describe tu solicitud y el equipo te responderá en un canal privado.')],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(boton)],
  })
  return i.reply({ content: 'Panel de tickets publicado.', flags: efimero })
}

export async function manejarBotonTicket(i: ButtonInteraction) {
  if (i.customId !== 'ticketpanel:abrir') return
  if (!i.inCachedGuild()) return i.reply({ content: 'Usa el panel dentro del servidor.', flags: efimero })
  if (!config.roles.soporte) return i.reply({ content: 'El equipo de soporte no está configurado.', flags: efimero })
  const asunto = new TextInputBuilder().setCustomId('asunto').setLabel('Motivo de contacto').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
  const modal = new ModalBuilder().setCustomId(ticketModalId).setTitle('Abrir ticket')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(asunto))
  return i.showModal(modal)
}

export async function manejarModalTicket(i: ModalSubmitInteraction) {
  if (i.customId !== ticketModalId) return
  if (!i.inCachedGuild()) return i.reply({ content: 'Usa este formulario dentro del servidor.', flags: efimero })
  if (!config.roles.soporte) return i.reply({ content: 'El equipo de soporte no está configurado.', flags: efimero })
  const resultado = await crearTicket(i.guild, i.user, i.fields.getTextInputValue('asunto'), 'SOPORTE')
  if ('existente' in resultado && resultado.existente) return i.reply({ content: `Ya tienes un ticket abierto: <#${resultado.existente.canalDiscordId}>`, flags: efimero })
  return i.reply({ content: `Ticket **#${resultado.ticket.numero}** creado: ${resultado.canal}.`, flags: efimero })
}

async function crearTicket(guild: Guild, usuarioDiscord: User, asunto: string, categoria: CategoriaTicket) {
  const usuario = await asegurarUsuario(usuarioDiscord)
  const existente = await db.ticket.findFirst({ where: { usuarioId: usuario.id, estado: { in: ['ABIERTO', 'EN_ATENCION'] } } })
  if (existente) return { existente }
  if (!config.roles.soporte) throw new Error('ROL_SOPORTE_ID no configurado')
  const nombre = `ticket-${usuarioDiscord.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18) || usuarioDiscord.id.slice(-6)}`
  const canal = await guild.channels.create({
    name: nombre,
    type: ChannelType.GuildText,
    ...(config.canales.categoriaTickets && { parent: config.canales.categoriaTickets }),
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: usuarioDiscord.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: config.roles.soporte, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...(guild.client.user ? [{ id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }] : []),
    ],
  })
  try {
    const ticket = await db.ticket.create({ data: { usuarioId: usuario.id, asunto, categoria, canalDiscordId: canal.id } })
    await enviarComponentsV2(canal, { content: `<@&${config.roles.soporte}> · <@${usuarioDiscord.id}>` })
    return { canal, ticket }
  } catch (error) {
    await canal.delete('No se pudo registrar el ticket en la base de datos').catch(() => {})
    throw error
  }
}

async function ejecutarSolicitud(i: ChatInputCommandInteraction) {
  const habilitado = await db.configuracionServidor.findUnique({ where: { clave: 'solicitable.institucion' } })
  if (habilitado?.valor === false) return i.reply({ content: 'Las postulaciones a instituciones están temporalmente cerradas.', flags: efimero })
  const usuario = await asegurarUsuario(i.user)
  const identificador = i.options.getString('institucion', true).trim()
  const institucion = await db.institucion.findFirst({
    where: { activa: true, OR: [{ slug: identificador.toLowerCase() }, { nombre: { equals: identificador, mode: 'insensitive' } }] },
  })
  if (!institucion) return i.reply({ content: 'No se encontró una institución activa con ese nombre o identificador.', flags: efimero })
  const pendiente = await db.postulacion.findFirst({
    where: { usuarioId: usuario.id, institucionId: institucion.id, tipo: 'INSTITUCION', estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
  })
  if (pendiente) return i.reply({ content: 'Ya tienes una postulación pendiente para esta institución.', flags: efimero })
  const postulacion = await db.postulacion.create({
    data: {
      tipo: 'INSTITUCION',
      usuarioId: usuario.id,
      institucionId: institucion.id,
      respuestas: { motivo: i.options.getString('motivo', true) },
    },
  })
  return i.reply({ content: `Postulación enviada a **${institucion.nombre}**. ID: **${postulacion.id}**.`, flags: efimero })
}

async function ejecutarCalificacion(i: ChatInputCommandInteraction) {
  const usuario = await asegurarUsuario(i.user)
  const calificacion = i.options.getInteger('nota', true)
  await db.auditoria.create({
    data: {
      actorId: usuario.id,
      accion: 'comunidad.calificar',
      entidad: 'Calificacion',
      detalle: { nota: calificacion, comentario: i.options.getString('comentario') },
    },
  })
  return i.reply({ content: 'Gracias, tu calificación fue registrada.', flags: efimero })
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}
