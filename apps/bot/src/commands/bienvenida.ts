import {
  ChannelType,
  ChatInputCommandInteraction,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { enviarComponentsV2 } from '../utils/components-v2'

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
  await enviarComponentsV2(canal, { content: renderizar(plantilla, i.user.id, i.guild!.name), allowedMentions: { users: [i.user.id], parse: [] } })
  return i.reply({ content: 'Mensaje de prueba publicado.', flags: efimero })
}

export async function enviarBienvenida(miembro: GuildMember) {
  const fila = await db.configuracionServidor.findUnique({ where: { clave } })
  const config = fila?.valor as { habilitado?: boolean; canalId?: string } | undefined
  if (!config?.habilitado || !config.canalId) return
  if (!miembro.joinedTimestamp) return
  const canal = await miembro.guild.channels.fetch(config.canalId).catch((error: unknown) => {
    if (esCanalInexistente(error)) {
      console.warn('El canal de bienvenida guardado no existe o no es accesible; actualízalo con /bienvenida activar.')
    } else {
      console.error('No se pudo consultar el canal de bienvenida:', error)
    }
    return null
  })
  if (!canal?.isTextBased() || !('send' in canal)) return
  const plantilla = await obtenerMensaje()
  const usuario = await db.usuario.findUnique({ where: { discordId: miembro.id }, select: { id: true } })
  if (!usuario) return
  const eventoKey = `${miembro.guild.id}:${miembro.id}:${miembro.joinedTimestamp}`
  const reclamo = await db.usuario.updateMany({
    where: {
      id: usuario.id,
      OR: [{ bienvenidaEventoKey: null }, { bienvenidaEventoKey: { not: eventoKey } }],
    },
    data: { bienvenidaEventoKey: eventoKey },
  })
  if (!reclamo.count) return
  try {
    await enviarComponentsV2(canal, { content: renderizar(plantilla, miembro.id, miembro.guild.name), allowedMentions: { users: [miembro.id], parse: [] } })
  } catch (error) {
    console.error('No se pudo enviar el mensaje de bienvenida:', error)
  }
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

function esCanalInexistente(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 10003
}