import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'

const efimero = MessageFlags.Ephemeral

export const vehiculoData = new SlashCommandBuilder()
  .setName('vehiculo')
  .setDescription('Registra y consulta vehículos de tus personajes')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('registrar').setDescription('Registra un vehículo a tu nombre')
    .addStringOption((o) => o.setName('patente').setDescription('Patente chilena').setRequired(true).setMinLength(5).setMaxLength(9))
    .addStringOption((o) => o.setName('modelo').setDescription('Marca y modelo').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('color').setDescription('Color del vehículo').setMaxLength(40)))
  .addSubcommand((s) => s.setName('ver').setDescription('Consulta un vehículo por patente')
    .addStringOption((o) => o.setName('patente').setDescription('Patente').setRequired(true).setMinLength(5).setMaxLength(9)))
  .addSubcommand((s) => s.setName('mis').setDescription('Lista tus vehículos registrados'))
  .addSubcommand((s) => s.setName('eliminar').setDescription('Retira un vehículo del registro (administradores)')
    .addStringOption((o) => o.setName('patente').setDescription('Patente').setRequired(true).setMinLength(5).setMaxLength(9)))

export const databaseData = new SlashCommandBuilder()
  .setName('database')
  .setDescription('Consulta registros del servidor')
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup((g) => g.setName('vehiculos').setDescription('Base de datos de vehículos')
    .addSubcommand((s) => s.setName('ver').setDescription('Lista catálogo y vehículos registrados'))
    .addSubcommand((s) => s.setName('anadir').setDescription('Añade un modelo al catálogo')
      .addStringOption((o) => o.setName('modelo').setDescription('Modelo disponible').setRequired(true).setMaxLength(80)))
    .addSubcommand((s) => s.setName('remover').setDescription('Retira un modelo del catálogo')
      .addStringOption((o) => o.setName('modelo').setDescription('Modelo').setRequired(true).setMaxLength(80))))

export const vehiculos = [
  { data: vehiculoData, execute: ejecutarVehiculo },
  { data: databaseData, execute: ejecutarDatabase },
]

async function ejecutarVehiculo(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  const patente = normalizarPatente(i.options.getString('patente', accion !== 'mis'))

  if (accion === 'registrar') {
    const personaje = await personajeDe(i.user.id)
    if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })
    if (!patenteValida(patente)) return i.reply({ content: 'Patente inválida. Usa entre 5 y 8 letras o números.', flags: efimero })
    const modeloIngresado = i.options.getString('modelo', true).trim()
    const modelos = await leerCatalogo()
    const modelo = modelos.length ? modelos.find((x) => x.toLowerCase() === modeloIngresado.toLowerCase()) : modeloIngresado
    if (!modelo) return i.reply({ content: 'Ese modelo no está en el catálogo autorizado.', flags: efimero })
    try {
      const vehiculo = await db.vehiculo.create({
        data: {
          patente,
          modelo,
          color: i.options.getString('color')?.trim() || null,
          personajeId: personaje.id,
        },
      })
      return i.reply({ content: `Vehículo **${vehiculo.patente}** (${vehiculo.modelo}) registrado a tu nombre.`, flags: efimero })
    } catch (error) {
      if (esErrorUnico(error)) return i.reply({ content: 'Esa patente ya está registrada.', flags: efimero })
      throw error
    }
  }

  if (accion === 'eliminar') {
    if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden eliminar vehículos.', flags: efimero })
    const resultado = await db.vehiculo.updateMany({ where: { patente, activo: true }, data: { activo: false } })
    return i.reply({ content: resultado.count ? `Vehículo **${patente}** retirado del registro.` : 'No se encontró un vehículo activo con esa patente.', flags: efimero })
  }

  if (accion === 'ver') {
    const vehiculo = patenteValida(patente)
      ? await db.vehiculo.findFirst({ where: { patente, activo: true }, include: { personaje: true } })
      : null
    if (!vehiculo) return i.reply({ content: 'No se encontró un vehículo activo con esa patente.', flags: efimero })
    return i.reply({ content: formatearVehiculo(vehiculo), flags: efimero })
  }

  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })
  const lista = await db.vehiculo.findMany({ where: { personajeId: personaje.id, activo: true }, orderBy: { registradoEn: 'desc' } })
  return i.reply({ content: lista.length ? lista.map((v) => `**${v.patente}** · ${v.modelo}${v.color ? ` · ${v.color}` : ''}`).join('\n') : 'No tienes vehículos registrados.', flags: efimero })
}

async function ejecutarDatabase(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden consultar la base completa.', flags: efimero })
  const accion = i.options.getSubcommand()
  if (accion === 'anadir' || accion === 'remover') {
    const modelo = i.options.getString('modelo', true).trim()
    const catalogo = await leerCatalogo()
    const existente = catalogo.find((x) => x.toLowerCase() === modelo.toLowerCase())
    if (accion === 'anadir') {
      if (existente) return i.reply({ content: 'Ese modelo ya está en el catálogo.', flags: efimero })
      catalogo.push(modelo)
    } else {
      if (!existente) return i.reply({ content: 'Ese modelo no está en el catálogo.', flags: efimero })
      catalogo.splice(catalogo.indexOf(existente), 1)
    }
    await guardarCatalogo(catalogo)
    return i.reply({ content: accion === 'anadir' ? `Modelo **${modelo}** añadido al catálogo.` : `Modelo **${modelo}** retirado del catálogo.`, flags: efimero })
  }
  const lista = await db.vehiculo.findMany({ where: { activo: true }, include: { personaje: true }, orderBy: { patente: 'asc' }, take: 50 })
  const catalogo = await leerCatalogo()
  return i.reply({
    content: [
      `**Catálogo**\n${catalogo.length ? catalogo.join('\n') : 'Sin modelos configurados.'}`,
      `**Vehículos registrados**\n${lista.length ? lista.map(formatearVehiculo).join('\n') : 'No hay vehículos registrados.'}`,
    ].join('\n\n').slice(0, 1900),
    flags: efimero,
  })
}

async function leerCatalogo(): Promise<string[]> {
  const fila = await db.configuracionServidor.findUnique({ where: { clave: 'vehiculos.catalogo' } })
  return Array.isArray(fila?.valor) ? fila.valor.filter((valor): valor is string => typeof valor === 'string') : []
}

async function guardarCatalogo(catalogo: string[]) {
  await db.configuracionServidor.upsert({
    where: { clave: 'vehiculos.catalogo' },
    create: { clave: 'vehiculos.catalogo', valor: catalogo },
    update: { valor: catalogo },
  })
}

async function personajeDe(discordId: string) {
  return db.personaje.findFirst({ where: { activo: true, usuario: { discordId } }, orderBy: { creadoEn: 'asc' } })
}

function normalizarPatente(valor: string | null) {
  return (valor ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
}

function patenteValida(valor: string) {
  return /^[A-Z0-9]{5,8}$/.test(valor)
}

function formatearVehiculo(v: { patente: string; modelo: string; color: string | null; personaje: { nombres: string; apellidos: string } }) {
  return `**${v.patente}** · ${v.modelo}${v.color ? ` · ${v.color}` : ''} · ${v.personaje.nombres} ${v.personaje.apellidos}`
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}

function esErrorUnico(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}