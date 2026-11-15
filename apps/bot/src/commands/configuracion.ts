import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { config } from '../config'

const efimero = MessageFlags.Ephemeral

export const configData = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configura canales, roles y opciones del servidor')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('canal').setDescription('Configura un canal del bot')
    .addStringOption((o) => o.setName('tipo').setDescription('Uso del canal').setRequired(true).addChoices(
      { name: 'Revisión de verificación', value: 'revision' },
      { name: 'Categoría de tickets', value: 'categoria_tickets' },
      { name: 'Alertas', value: 'alertas' },
      { name: 'Anuncios', value: 'anuncios' },
    ))
    .addChannelOption((o) => o.setName('canal').setDescription('Canal o categoría').setRequired(true)))
  .addSubcommand((s) => s.setName('rol').setDescription('Configura un rol del bot')
    .addStringOption((o) => o.setName('tipo').setDescription('Función del rol').setRequired(true).addChoices(
      { name: 'Staff', value: 'staff' }, { name: 'Moderador', value: 'moderador' },
      { name: 'Soporte', value: 'soporte' }, { name: 'Administrador', value: 'admin' },
      { name: 'Policía', value: 'policia' }, { name: 'Ciudadano verificado', value: 'ciudadano' },
      { name: 'No verificado', value: 'no_verificado' }, { name: 'Segundo personaje', value: 'segundo_personaje' },
    ))
    .addRoleOption((o) => o.setName('rol').setDescription('Rol de Discord').setRequired(true)))
  .addSubcommand((s) => s.setName('moneda').setDescription('Define el símbolo de la economía')
    .addStringOption((o) => o.setName('simbolo').setDescription('Símbolo, por ejemplo $ o ₱').setRequired(true).setMaxLength(4)))
  .addSubcommand((s) => s.setName('solicitable').setDescription('Activa o desactiva un tipo de postulación')
    .addStringOption((o) => o.setName('tipo').setDescription('Tipo de postulación').setRequired(true).addChoices(
      { name: 'Institución', value: 'institucion' }, { name: 'Staff', value: 'staff' },
    ))
    .addBooleanOption((o) => o.setName('habilitado').setDescription('Permitir nuevas solicitudes').setRequired(true)))
  .addSubcommand((s) => s.setName('ver').setDescription('Muestra la configuración guardada'))

export const seguridadData = new SlashCommandBuilder()
  .setName('seguridad')
  .setDescription('Consulta o configura restricciones de acceso')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('estado').setDescription('Muestra el modo de seguridad actual'))
  .addSubcommand((s) => s.setName('configurar').setDescription('Configura el acceso estricto por verificación')
    .addBooleanOption((o) => o.setName('estricto').setDescription('Exigir verificación para usar comandos').setRequired(true)))

export const configuracion = [
  { data: configData, execute: ejecutarConfig },
  { data: seguridadData, execute: ejecutarSeguridad },
]

let modoEstricto = false

export async function cargarConfiguracionServidor() {
  const filas = await db.configuracionServidor.findMany({ where: { clave: { startsWith: 'discord.' } } })
  for (const fila of filas) {
    if (typeof fila.valor !== 'string') continue
    if (fila.clave.startsWith('discord.rol.')) aplicarRol(fila.clave.slice('discord.rol.'.length), fila.valor)
    if (fila.clave.startsWith('discord.canal.')) aplicarCanal(fila.clave.slice('discord.canal.'.length), fila.valor)
  }
  const moneda = await db.configuracionServidor.findUnique({ where: { clave: 'economia.moneda' } })
  if (typeof moneda?.valor === 'string') process.env.MONEDA_SIMBOLO = moneda.valor
  const seguridad = await db.configuracionServidor.findUnique({ where: { clave: 'seguridad.estricto' } })
  modoEstricto = seguridad?.valor === true
}

export async function usuarioPuedeUsarComando(commandName: string, discordId: string) {
  if (!modoEstricto || ['cedula', 'crear-dni-2do', 'soporte'].includes(commandName)) return true
  const usuario = await db.usuario.findUnique({ where: { discordId }, select: { verificacion: true } })
  return usuario?.verificacion === 'VERIFICADO'
}

async function ejecutarConfig(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return denegado(i)
  const accion = i.options.getSubcommand()
  if (accion === 'ver') {
    const filas = await db.configuracionServidor.findMany({
      where: { OR: [{ clave: { startsWith: 'discord.' } }, { clave: { startsWith: 'solicitable.' } }, { clave: 'economia.moneda' }] },
      orderBy: { clave: 'asc' },
    })
    return i.reply({ content: filas.length ? filas.map((fila) => `**${fila.clave}** · ${String(fila.valor)}`).join('\n') : 'No hay ajustes personalizados.', flags: efimero })
  }

  if (accion === 'canal') {
    const tipo = i.options.getString('tipo', true)
    const canal = i.options.getChannel('canal', true)
    const esCanalTexto = canal.type === ChannelType.GuildText || canal.type === ChannelType.GuildAnnouncement
    if (tipo === 'categoria_tickets' ? canal.type !== ChannelType.GuildCategory : !esCanalTexto) {
      return i.reply({ content: tipo === 'categoria_tickets' ? 'Selecciona una categoría.' : 'Selecciona un canal de texto.', flags: efimero })
    }
    await guardar(`discord.canal.${tipo}`, canal.id)
    aplicarCanal(tipo, canal.id)
    return i.reply({ content: `Canal de ${tipo} actualizado a ${canal}.`, flags: efimero })
  }

  if (accion === 'rol') {
    const tipo = i.options.getString('tipo', true)
    const rol = i.options.getRole('rol', true)
    await guardar(`discord.rol.${tipo}`, rol.id)
    aplicarRol(tipo, rol.id)
    return i.reply({ content: `Rol de ${tipo} actualizado a ${rol}.`, flags: efimero })
  }

  if (accion === 'moneda') {
    const simbolo = i.options.getString('simbolo', true).trim()
    if (!simbolo) return i.reply({ content: 'El símbolo no puede estar vacío.', flags: efimero })
    await guardar('economia.moneda', simbolo)
    process.env.MONEDA_SIMBOLO = simbolo
    return i.reply({ content: `Símbolo de economía actualizado a ${simbolo}.`, flags: efimero })
  }

  const tipo = i.options.getString('tipo', true)
  const habilitado = i.options.getBoolean('habilitado', true)
  await guardar(`solicitable.${tipo}`, habilitado)
  return i.reply({ content: `Solicitudes de ${tipo}: ${habilitado ? 'habilitadas' : 'deshabilitadas'}.`, flags: efimero })
}

async function ejecutarSeguridad(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return denegado(i)
  if (i.options.getSubcommand() === 'estado') {
    return i.reply({ content: `Modo estricto por verificación: **${modoEstricto ? 'activado' : 'desactivado'}**.`, flags: efimero })
  }
  modoEstricto = i.options.getBoolean('estricto', true)
  await guardar('seguridad.estricto', modoEstricto)
  return i.reply({ content: `Modo estricto ${modoEstricto ? 'activado' : 'desactivado'}.`, flags: efimero })
}

async function guardar(clave: string, valor: string | boolean) {
  await db.configuracionServidor.upsert({
    where: { clave },
    create: { clave, valor },
    update: { valor },
  })
}

function aplicarRol(tipo: string, id: string) {
  const variables: Record<string, string> = {
    staff: 'ROL_STAFF_ID', moderador: 'ROL_MODERADOR_ID', soporte: 'ROL_SOPORTE_ID',
    admin: 'ROL_ADMIN_ID', policia: 'ROL_POLICIA_ID', ciudadano: 'ROL_CIUDADANO_ID',
    no_verificado: 'ROL_NO_VERIFICADO_ID', segundo_personaje: 'ROL_SEGUNDO_PERSONAJE_ID',
  }
  const variable = variables[tipo]
  if (!variable) return
  process.env[variable] = id
  if (tipo === 'staff') config.roles.staff = id
  else if (tipo === 'moderador') config.roles.moderador = id
  else if (tipo === 'soporte') config.roles.soporte = id
  else if (tipo === 'admin') config.roles.admin = id
  else if (tipo === 'policia') config.roles.policia = id
  else if (tipo === 'ciudadano') config.roles.ciudadano = id
  else if (tipo === 'no_verificado') config.roles.noVerificado = id
  else config.roles.segundoPersonaje = id
}

function aplicarCanal(tipo: string, id: string) {
  if (tipo === 'revision') config.canales.revision = id
  else if (tipo === 'categoria_tickets') config.canales.categoriaTickets = id
  else if (tipo === 'alertas') process.env.CANAL_ALERTAS_ID = id
  else if (tipo === 'anuncios') process.env.CANAL_ANUNCIOS_ID = id
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Solo administradores pueden cambiar esta configuración.', flags: efimero })
}