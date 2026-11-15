import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'

const efimero = MessageFlags.Ephemeral
const clave = 'bienvenida.config'
const mensajeClave = 'bienvenida.mensaje'
const mensajeDefecto = '¡Bienvenido {usuario} a {servidor}!'

export const bienvenidaData = new SlashCommandBuilder()
  .setName('bienvenida')
  .setDescription('Configura los mensajes de bienvenida')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('activar').setDescription('Activa o desactiva la bienvenida')
    .addBooleanOption((o) => o.setName('habilitado').setDescription('Estado de la bienvenida').setRequired(true))
    .addChannelOption((o) => o.setName('canal').setDescription('Canal donde se publicará').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('mensaje').setDescription('Define el texto de bienvenida')
    .addStringOption((o) => o.setName('texto').setDescription('Usa {usuario} y {servidor} como variables').setRequired(true).setMaxLength(1500)))
  .addSubcommand((s) => s.setName('probar').setDescription('Publica una bienvenida de prueba'))

export const bienvenida = { data: bienvenidaData, execute: ejecutarBienvenida }

async function ejecutarBienvenida(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden configurar la bienvenida.', flags: efimero })
  const accion = i.options.getSubcommand()
  if (accion === 'activar') {
    const actual = await db.configuracionServidor.findUnique({ where: { clave } })
    const previo = actual?.valor as { canalId?: string } | undefined
    const canalId = i.options.getChannel('canal')?.id ?? previo?.canalId
    const habilitado = i.options.getBoolean('habilitado', true)
    if (habilitado && !canalId) return i.reply({ content: 'Indica un canal para publicar las bienvenidas.', flags: efimero })
    await guardar(clave, { habilitado, canalId: canalId ?? null })
    return i.reply({ content: habilitado ? `Bienvenida activada en <#${canalId}>.` : 'Bienvenida desactivada.', flags: efimero })
  }

  if (accion === 'mensaje') {
    await guardar(mensajeClave, i.options.getString('texto', true))
    return i.reply({ content: 'Mensaje de bienvenida actualizado.', flags: efimero })
  }

  const fila = await db.configuracionServidor.findUnique({ where: { clave } })
  const config = fila?.valor as { canalId?: string } | undefined
  if (!config?.canalId) return i.reply({ content: 'Configura primero un canal de bienvenida.', flags: efimero })
  const canal = await i.guild?.channels.fetch(config.canalId)
  if (!canal?.isTextBased() || !('send' in canal)) return i.reply({ content: 'El canal configurado ya no está disponible.', flags: efimero })
  const plantilla = await obtenerMensaje()
  await canal.send({ content: renderizar(plantilla, i.user.id, i.guild!.name), allowedMentions: { users: [i.user.id], parse: [] } })
  return i.reply({ content: 'Mensaje de prueba publicado.', flags: efimero })
}

export async function enviarBienvenida(miembro: { id: string; guild: { name: string; channels: { fetch: (id: string) => Promise<unknown> } } }) {
  const fila = await db.configuracionServidor.findUnique({ where: { clave } })
  const config = fila?.valor as { habilitado?: boolean; canalId?: string } | undefined
  if (!config?.habilitado || !config.canalId) return
  const canal = await miembro.guild.channels.fetch(config.canalId) as { isTextBased?: () => boolean; send?: (message: unknown) => Promise<unknown> } | null
  if (!canal?.isTextBased?.() || !canal.send) return
  const plantilla = await obtenerMensaje()
  await canal.send({ content: renderizar(plantilla, miembro.id, miembro.guild.name), allowedMentions: { users: [miembro.id], parse: [] } })
}

async function obtenerMensaje() {
  const fila = await db.configuracionServidor.findUnique({ where: { clave: mensajeClave } })
  return typeof fila?.valor === 'string' ? fila.valor : mensajeDefecto
}

async function guardar(claveConfig: string, valor: unknown) {
  await db.configuracionServidor.upsert({
    where: { clave: claveConfig },
    create: { clave: claveConfig, valor: valor as object },
    update: { valor: valor as object },
  })
}

function renderizar(plantilla: string, usuarioId: string, servidor: string) {
  return plantilla.replaceAll('{usuario}', `<@${usuarioId}>`).replaceAll('{servidor}', servidor)
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}