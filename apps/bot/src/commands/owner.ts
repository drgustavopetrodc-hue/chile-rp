import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  Message,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'

const efimero = MessageFlags.Ephemeral
const presupuestoKey = 'economia.presupuesto'
const reaccionKey = 'owner.autoReaccion'

export const presupuestoData = new SlashCommandBuilder()
  .setName('agregar-presupuesto')
  .setDescription('Aumenta el presupuesto general de la economía')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1).setMaxValue(2_000_000_000))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo del ajuste').setRequired(true).setMaxLength(300))

export const ckData = new SlashCommandBuilder()
  .setName('ck')
  .setDescription('Desactiva permanentemente un personaje (CK)')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('usuario').setDescription('Dueño del personaje').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo del CK').setRequired(true).setMaxLength(500))

export const autoReaccionarData = new SlashCommandBuilder()
  .setName('auto-reaccionar')
  .setDescription('Configura una reacción automática en un canal')
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption((o) => o.setName('habilitado').setDescription('Activar la reacción automática').setRequired(true))
  .addChannelOption((o) => o.setName('canal').setDescription('Canal donde reaccionar').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
  .addStringOption((o) => o.setName('emoji').setDescription('Emoji Unicode o personalizado').setMaxLength(100))

export const emojiData = new SlashCommandBuilder()
  .setName('emoji')
  .setDescription('Crea un emoji personalizado en el servidor')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('nombre').setDescription('Nombre del emoji').setRequired(true).setMinLength(2).setMaxLength(32))
  .addAttachmentOption((o) => o.setName('imagen').setDescription('Imagen PNG, JPG, GIF o WEBP').setRequired(true))

export const owner = [
  { data: presupuestoData, execute: ejecutarPresupuesto },
  { data: ckData, execute: ejecutarCk },
  { data: autoReaccionarData, execute: ejecutarAutoReaccionar },
  { data: emojiData, execute: ejecutarEmoji },
]

let autoReaccion: { habilitado: boolean; canalId: string; emoji: string } | null = null

export async function cargarAutoReaccion() {
  const fila = await db.configuracionServidor.findUnique({ where: { clave: reaccionKey } })
  const valor = fila?.valor as Partial<NonNullable<typeof autoReaccion>> | undefined
  autoReaccion = valor?.habilitado && valor.canalId && valor.emoji
    ? { habilitado: true, canalId: valor.canalId, emoji: valor.emoji }
    : null
}

export async function manejarAutoReaccion(mensaje: Message) {
  if (!autoReaccion?.habilitado || mensaje.author.bot || mensaje.channelId !== autoReaccion.canalId) return
  await mensaje.react(autoReaccion.emoji).catch(() => {})
}

async function ejecutarPresupuesto(i: ChatInputCommandInteraction) {
  if (!esOwner(i)) return denegado(i)
  const monto = i.options.getInteger('monto', true)
  const aumento = await db.$transaction(async (tx) => {
    const fila = await tx.configuracionServidor.findUnique({ where: { clave: presupuestoKey } })
    const previo = typeof fila?.valor === 'number' ? fila.valor : 0
    const total = previo + monto
    await tx.configuracionServidor.upsert({
      where: { clave: presupuestoKey },
      create: { clave: presupuestoKey, valor: total },
      update: { valor: total },
    })
    await tx.auditoria.create({
      data: {
        accion: 'economia.presupuesto.agregar',
        entidad: 'Presupuesto',
        detalle: { monto, total, motivo: i.options.getString('motivo', true) },
      },
    })
    return total
  })
  return i.reply({ content: `Presupuesto aumentado en $${monto.toLocaleString('es-CL')}. Total: $${aumento.toLocaleString('es-CL')}.`, flags: efimero })
}

async function ejecutarCk(i: ChatInputCommandInteraction) {
  if (!esOwner(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const personaje = await db.personaje.findFirst({
    where: { activo: true, usuario: { discordId: usuario.id } },
    include: { cedula: true },
    orderBy: { creadoEn: 'asc' },
  })
  if (!personaje) return i.reply({ content: 'El usuario no tiene un personaje activo.', flags: efimero })
  const actor = await asegurarUsuario(i.user)
  await db.$transaction(async (tx) => {
    await tx.personaje.update({ where: { id: personaje.id }, data: { activo: false } })
    if (personaje.cedula) await tx.cedula.update({ where: { id: personaje.cedula.id }, data: { estado: 'REVOCADO' } })
    await tx.auditoria.create({ data: {
      actorId: actor.id,
      accion: 'personaje.ck',
      entidad: 'Personaje',
      entidadId: personaje.id,
      detalle: { motivo: i.options.getString('motivo', true), discordId: usuario.id },
    } })
  })
  return i.reply({ content: `CK aplicado a **${personaje.nombres} ${personaje.apellidos}**.`, flags: efimero })
}

async function ejecutarAutoReaccionar(i: ChatInputCommandInteraction) {
  if (!esOwner(i)) return denegado(i)
  const habilitado = i.options.getBoolean('habilitado', true)
  const canal = i.options.getChannel('canal')
  const emoji = i.options.getString('emoji')?.trim()
  if (habilitado && (!canal || !emoji)) return i.reply({ content: 'Al activar, indica canal y emoji.', flags: efimero })
  const valor = habilitado && canal && emoji ? { habilitado: true, canalId: canal.id, emoji } : { habilitado: false, canalId: '', emoji: '' }
  await db.configuracionServidor.upsert({
    where: { clave: reaccionKey },
    create: { clave: reaccionKey, valor },
    update: { valor },
  })
  autoReaccion = valor.habilitado ? valor : null
  return i.reply({ content: habilitado ? `Reacción automática activada en ${canal}.` : 'Reacción automática desactivada.', flags: efimero })
}

async function ejecutarEmoji(i: ChatInputCommandInteraction) {
  if (!esOwner(i)) return denegado(i)
  const nombre = i.options.getString('nombre', true).toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const imagen = i.options.getAttachment('imagen', true)
  if (!/^https?:\/\//.test(imagen.url)) return i.reply({ content: 'La imagen adjunta no es válida.', flags: efimero })
  const emoji = await i.guild!.emojis.create({ attachment: imagen.url, name: nombre, reason: `Solicitado por ${i.user.tag}` })
  return i.reply({ content: `Emoji ${emoji} creado.`, flags: efimero })
}

function esOwner(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return false
  const owners = (process.env.OWNER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return i.guild.ownerId === i.user.id || owners.includes(i.user.id)
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Este comando está reservado al propietario del servidor.', flags: efimero })
}