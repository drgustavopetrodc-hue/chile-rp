import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { formatearMoneda } from '../utils/moneda'

const efimero = MessageFlags.Ephemeral
const plata = formatearMoneda

export const sueldoData = new SlashCommandBuilder()
  .setName('sueldo')
  .setDescription('Administra cargos y sueldos de instituciones')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('asignar').setDescription('Asigna un personaje a un cargo')
    .addUserOption((o) => o.setName('usuario').setDescription('Funcionario').setRequired(true))
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true))
    .addStringOption((o) => o.setName('cargo').setDescription('Nombre del cargo').setRequired(true)))
  .addSubcommand((s) => s.setName('editar').setDescription('Define el sueldo de un cargo')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true))
    .addStringOption((o) => o.setName('cargo').setDescription('Nombre del cargo').setRequired(true))
    .addIntegerOption((o) => o.setName('monto').setDescription('Sueldo en pesos').setRequired(true).setMinValue(0).setMaxValue(2_000_000_000)))
  .addSubcommand((s) => s.setName('eliminar').setDescription('Deja el sueldo del cargo en cero')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true))
    .addStringOption((o) => o.setName('cargo').setDescription('Nombre del cargo').setRequired(true)))
  .addSubcommand((s) => s.setName('ver').setDescription('Consulta sueldos por institución')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true)))

export const sueldo = { data: sueldoData, execute: ejecutarSueldo }

async function ejecutarSueldo(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden gestionar cargos y sueldos.', flags: efimero })
  const accion = i.options.getSubcommand()
  const institucion = await buscarInstitucion(i.options.getString('institucion', true))
  if (!institucion) return i.reply({ content: 'No se encontró una institución activa.', flags: efimero })

  if (accion === 'ver') {
    const cargos = await db.cargo.findMany({ where: { institucionId: institucion.id }, orderBy: [{ nivel: 'desc' }, { nombre: 'asc' }] })
    return i.reply({
      content: cargos.length ? cargos.map((c) => `**${c.nombre}** · ${plata(c.sueldo)} · nivel ${c.nivel}`).join('\n') : 'La institución no tiene cargos configurados.',
      flags: efimero,
    })
  }

  const nombreCargo = i.options.getString('cargo', true).trim()
  const cargo = await db.cargo.findFirst({ where: { institucionId: institucion.id, nombre: { equals: nombreCargo, mode: 'insensitive' } } })
  if (!cargo) return i.reply({ content: 'No se encontró ese cargo en la institución.', flags: efimero })

  if (accion === 'editar' || accion === 'eliminar') {
    const sueldo = accion === 'editar' ? BigInt(i.options.getInteger('monto', true)) : 0n
    await db.cargo.update({ where: { id: cargo.id }, data: { sueldo } })
    return i.reply({ content: `Sueldo de **${cargo.nombre}** actualizado a ${plata(sueldo)}.`, flags: efimero })
  }

  const usuario = i.options.getUser('usuario', true)
  const personaje = await db.personaje.findFirst({ where: { activo: true, usuario: { discordId: usuario.id } }, orderBy: { creadoEn: 'asc' } })
  if (!personaje) return i.reply({ content: 'El usuario no tiene un personaje activo.', flags: efimero })
  const asignacion = await db.$transaction(async (tx) => {
    await tx.funcionario.updateMany({ where: { personajeId: personaje.id, cargoId: cargo.id, activo: true }, data: { activo: false, hasta: new Date() } })
    return tx.funcionario.create({ data: { personajeId: personaje.id, cargoId: cargo.id } })
  })
  return i.reply({ content: `**${personaje.nombres} ${personaje.apellidos}** asignado a **${cargo.nombre}** en ${institucion.nombre}. ID: ${asignacion.id}.`, flags: efimero })
}

async function buscarInstitucion(valor: string) {
  const identificador = valor.trim()
  return db.institucion.findFirst({
    where: { activa: true, OR: [{ slug: identificador.toLowerCase() }, { nombre: { equals: identificador, mode: 'insensitive' } }] },
  })
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}