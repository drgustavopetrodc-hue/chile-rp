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

export const institucionData = new SlashCommandBuilder()
  .setName('institucion')
  .setDescription('Administra instituciones y sus cargos')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('crear').setDescription('Crea una institución')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre visible').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('slug').setDescription('Identificador corto').setRequired(true).setMaxLength(40))
    .addStringOption((o) => o.setName('tipo').setDescription('Tipo de institución').setRequired(true).addChoices(
      { name: 'Gobierno', value: 'GOBIERNO' }, { name: 'Municipal', value: 'MUNICIPAL' },
      { name: 'Judicial', value: 'JUDICIAL' }, { name: 'Fiscalía', value: 'FISCALIA' },
      { name: 'Defensoría', value: 'DEFENSORIA' }, { name: 'Policial', value: 'POLICIAL' },
      { name: 'Salud', value: 'SALUD' }, { name: 'Bancaria', value: 'BANCARIA' }, { name: 'Otra', value: 'OTRA' },
    ))
    .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setMaxLength(500)))
  .addSubcommand((s) => s.setName('editar').setDescription('Edita una institución')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true))
    .addStringOption((o) => o.setName('nombre').setDescription('Nuevo nombre').setMaxLength(80))
    .addStringOption((o) => o.setName('slug').setDescription('Nuevo identificador').setMaxLength(40))
    .addStringOption((o) => o.setName('descripcion').setDescription('Nueva descripción').setMaxLength(500))
    .addRoleOption((o) => o.setName('rol').setDescription('Rol asociado a la institución')))
  .addSubcommand((s) => s.setName('eliminar').setDescription('Desactiva una institución')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true)))
  .addSubcommand((s) => s.setName('lista').setDescription('Lista instituciones activas'))
  .addSubcommand((s) => s.setName('ver').setDescription('Muestra una institución y sus cargos')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre o identificador').setRequired(true)))

export const contratarData = new SlashCommandBuilder()
  .setName('contratar')
  .setDescription('Contrata personal para una institución')
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup((g) => g.setName('empresas').setDescription('Gestión de personal institucional')
    .addSubcommand((s) => s.setName('asignar').setDescription('Asigna un personaje a un cargo')
      .addUserOption((o) => o.setName('usuario').setDescription('Persona a contratar').setRequired(true))
      .addStringOption((o) => o.setName('institucion').setDescription('Institución').setRequired(true))
      .addStringOption((o) => o.setName('cargo').setDescription('Cargo').setRequired(true))))

export const instituciones = [
  { data: institucionData, execute: ejecutarInstitucion },
  { data: contratarData, execute: ejecutarContratacion },
]

async function ejecutarInstitucion(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return denegado(i)
  const accion = i.options.getSubcommand()
  if (accion === 'crear') {
    const slug = normalizarSlug(i.options.getString('slug', true))
    try {
      const institucion = await db.institucion.create({ data: {
        nombre: i.options.getString('nombre', true).trim(),
        slug,
        tipo: i.options.getString('tipo', true) as 'GOBIERNO' | 'MUNICIPAL' | 'JUDICIAL' | 'FISCALIA' | 'DEFENSORIA' | 'POLICIAL' | 'SALUD' | 'BANCARIA' | 'OTRA',
        descripcion: i.options.getString('descripcion')?.trim() || null,
      } })
      return i.reply({ content: `Institución **${institucion.nombre}** creada.`, flags: efimero })
    } catch (error) {
      if (esErrorUnico(error)) return i.reply({ content: 'Ya existe una institución con ese nombre o identificador.', flags: efimero })
      throw error
    }
  }

  if (accion === 'lista') {
    const lista = await db.institucion.findMany({ where: { activa: true }, include: { _count: { select: { cargos: true } } }, orderBy: { nombre: 'asc' } })
    return i.reply({ content: lista.length ? lista.map((x) => `**${x.nombre}** · \/${x.slug} · ${x._count.cargos} cargos`).join('\n') : 'No hay instituciones activas.', flags: efimero })
  }

  const identificador = i.options.getString('institucion', true)
  const institucion = await buscarInstitucion(identificador, accion !== 'eliminar')
  if (!institucion) return i.reply({ content: 'No se encontró esa institución.', flags: efimero })

  if (accion === 'ver') {
    const cargos = await db.cargo.findMany({ where: { institucionId: institucion.id }, orderBy: [{ nivel: 'desc' }, { nombre: 'asc' }] })
    return i.reply({ content: `**${institucion.nombre}** · ${institucion.tipo}\n${institucion.descripcion ?? 'Sin descripción'}\n${cargos.length ? cargos.map((c) => `• ${c.nombre} · nivel ${c.nivel} · ${formatearMoneda(c.sueldo)}`).join('\n') : 'Sin cargos.'}`, flags: efimero })
  }

  if (accion === 'eliminar') {
    await db.institucion.update({ where: { id: institucion.id }, data: { activa: false } })
    return i.reply({ content: `Institución **${institucion.nombre}** desactivada. Sus registros históricos se conservan.`, flags: efimero })
  }

  const nombre = i.options.getString('nombre')?.trim()
  const slugInput = i.options.getString('slug')
  const descripcion = i.options.getString('descripcion')
  const rol = i.options.getRole('rol')
  if (!nombre && !slugInput && descripcion === null && !rol) return i.reply({ content: 'Indica al menos un campo para editar.', flags: efimero })
  try {
    await db.institucion.update({ where: { id: institucion.id }, data: {
      ...(nombre && { nombre }),
      ...(slugInput && { slug: normalizarSlug(slugInput) }),
      ...(descripcion !== null && { descripcion: descripcion.trim() || null }),
      ...(rol && { discordRoleId: rol.id }),
    } })
    return i.reply({ content: `Institución **${institucion.nombre}** actualizada.`, flags: efimero })
  } catch (error) {
    if (esErrorUnico(error)) return i.reply({ content: 'Ya existe una institución con ese nombre o identificador.', flags: efimero })
    throw error
  }
}

async function ejecutarContratacion(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  const institucion = await buscarInstitucion(i.options.getString('institucion', true), true)
  if (!institucion) return i.reply({ content: 'No se encontró una institución activa.', flags: efimero })
  const cargo = await db.cargo.findFirst({ where: { institucionId: institucion.id, nombre: { equals: i.options.getString('cargo', true).trim(), mode: 'insensitive' } } })
  if (!cargo) return i.reply({ content: 'No se encontró ese cargo en la institución.', flags: efimero })

  const lider = await db.personaje.findFirst({
    where: { activo: true, usuario: { discordId: i.user.id }, cargos: { some: { activo: true, cargo: { institucionId: institucion.id } } } },
    include: { cargos: { where: { activo: true }, include: { cargo: true } } },
    orderBy: { creadoEn: 'asc' },
  })
  const maxNivel = await db.cargo.aggregate({ where: { institucionId: institucion.id }, _max: { nivel: true } })
  const esJefatura = lider?.cargos.some((f) => f.cargo.institucionId === institucion.id && f.cargo.nivel === maxNivel._max.nivel)
  if (!esJefatura && !esAdmin(i)) return i.reply({ content: 'Solo una jefatura activa de la institución puede contratar.', flags: efimero })

  const usuario = i.options.getUser('usuario', true)
  const personaje = await db.personaje.findFirst({ where: { activo: true, usuario: { discordId: usuario.id } }, orderBy: { creadoEn: 'asc' } })
  if (!personaje) return i.reply({ content: 'La persona no tiene un personaje activo.', flags: efimero })
  const asignacion = await db.funcionario.create({ data: { personajeId: personaje.id, cargoId: cargo.id } })
  return i.reply({ content: `**${personaje.nombres} ${personaje.apellidos}** fue asignado a **${cargo.nombre}** en ${institucion.nombre}. ID: ${asignacion.id}.`, flags: efimero })
}

async function buscarInstitucion(valor: string, activa: boolean) {
  const identificador = valor.trim()
  return db.institucion.findFirst({ where: {
    ...(activa && { activa: true }),
    OR: [{ slug: identificador.toLowerCase() }, { nombre: { equals: identificador, mode: 'insensitive' } }],
  } })
}

function normalizarSlug(valor: string) {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Solo administradores pueden gestionar instituciones.', flags: efimero })
}

function esErrorUnico(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}