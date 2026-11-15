import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js'
import { RolPlataforma, db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'

const efimero = MessageFlags.Ephemeral

export const editarData = new SlashCommandBuilder()
  .setName('editar')
  .setDescription('Edita categorías o empresas (owner)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('categoria').setDescription('Renombra una categoría')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre actual').setRequired(true))
    .addStringOption((o) => o.setName('nuevo_nombre').setDescription('Nuevo nombre').setRequired(true).setMaxLength(60)))
  .addSubcommand((s) => s.setName('empresas').setDescription('Edita una empresa')
    .addStringOption((o) => o.setName('identificador').setDescription('Nombre o slug').setRequired(true))
    .addStringOption((o) => o.setName('nombre').setDescription('Nuevo nombre').setMaxLength(80))
    .addStringOption((o) => o.setName('slug').setDescription('Nuevo identificador').setMaxLength(40))
    .addStringOption((o) => o.setName('descripcion').setDescription('Nueva descripción').setMaxLength(500)))

export const eliminarData = new SlashCommandBuilder()
  .setName('eliminar')
  .setDescription('Retira elementos del servidor (owner)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('administrador').setDescription('Retira el rol de administrador')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))
  .addSubcommand((s) => s.setName('moderador').setDescription('Retira el rol de moderador')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))
  .addSubcommand((s) => s.setName('soporte').setDescription('Retira el rol de soporte')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))
  .addSubcommand((s) => s.setName('categoria').setDescription('Elimina una categoría')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre de categoría').setRequired(true)))
  .addSubcommand((s) => s.setName('empresa').setDescription('Desactiva una empresa')
    .addStringOption((o) => o.setName('identificador').setDescription('Nombre o slug').setRequired(true)))

export const ownerManagement = [
  { data: editarData, execute: ejecutarEditar },
  { data: eliminarData, execute: ejecutarEliminar },
]

async function ejecutarEditar(i: ChatInputCommandInteraction) {
  if (!esOwner(i)) return denegado(i)
  if (i.options.getSubcommand() === 'categoria') {
    const categorias = await leerCategorias()
    const indice = categorias.findIndex((x) => x.toLowerCase() === i.options.getString('nombre', true).trim().toLowerCase())
    if (indice < 0) return i.reply({ content: 'No se encontró esa categoría.', flags: efimero })
    const nuevoNombre = i.options.getString('nuevo_nombre', true).trim()
    if (categorias.some((x, index) => index !== indice && x.toLowerCase() === nuevoNombre.toLowerCase())) {
      return i.reply({ content: 'Ya existe una categoría con ese nombre.', flags: efimero })
    }
    categorias[indice] = nuevoNombre
    await guardarCategorias(categorias)
    return i.reply({ content: `Categoría renombrada a **${nuevoNombre}**.`, flags: efimero })
  }

  const empresa = await buscarEmpresa(i.options.getString('identificador', true))
  if (!empresa) return i.reply({ content: 'No se encontró una empresa activa.', flags: efimero })
  const nombre = i.options.getString('nombre')?.trim()
  const slugInput = i.options.getString('slug')
  const descripcion = i.options.getString('descripcion')
  if (!nombre && !slugInput && descripcion === null) return i.reply({ content: 'Indica al menos un campo para editar.', flags: efimero })
  try {
    await db.institucion.update({ where: { id: empresa.id }, data: {
      ...(nombre && { nombre }),
      ...(slugInput && { slug: normalizarSlug(slugInput) }),
      ...(descripcion !== null && { descripcion: descripcion.trim() || null }),
    } })
    return i.reply({ content: `Empresa **${empresa.nombre}** actualizada.`, flags: efimero })
  } catch (error) {
    if (esErrorUnico(error)) return i.reply({ content: 'Ya existe una empresa con ese nombre o identificador.', flags: efimero })
    throw error
  }
}

async function ejecutarEliminar(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild() || !esOwner(i)) return denegado(i)
  const accion = i.options.getSubcommand()
  if (accion === 'administrador' || accion === 'moderador' || accion === 'soporte') {
    const usuario = i.options.getUser('usuario', true)
    const variable = accion === 'administrador' ? 'ROL_ADMIN_ID' : accion === 'moderador' ? 'ROL_MODERADOR_ID' : 'ROL_SOPORTE_ID'
    const rolId = process.env[variable]
    if (!rolId) return i.reply({ content: `Configura ${variable} desde /config rol.`, flags: efimero })
    const miembro = await i.guild.members.fetch(usuario.id).catch(() => null)
    if (!miembro || !miembro.roles.cache.has(rolId)) return i.reply({ content: 'El miembro no tiene ese rol o no está en el servidor.', flags: efimero })
    await miembro.roles.remove(rolId, `Retirado por owner ${i.user.tag}`)
    const usuarioDb = await asegurarUsuario(usuario)
    const adminRestante = accion !== 'administrador' && !!process.env.ROL_ADMIN_ID && miembro.roles.cache.has(process.env.ROL_ADMIN_ID)
    const staffRestante = [process.env.ROL_STAFF_ID, process.env.ROL_MODERADOR_ID, process.env.ROL_SOPORTE_ID]
      .some((id) => !!id && id !== rolId && miembro.roles.cache.has(id))
    const rol = adminRestante ? RolPlataforma.ADMIN : staffRestante ? RolPlataforma.STAFF : RolPlataforma.JUGADOR
    await db.usuario.update({ where: { id: usuarioDb.id }, data: { rol } })
    return i.reply({ content: `Se retiró el rol de ${accion} a ${usuario.tag}.`, flags: efimero })
  }

  if (accion === 'categoria') {
    const nombre = i.options.getString('nombre', true).trim()
    const categorias = await leerCategorias()
    const restantes = categorias.filter((x) => x.toLowerCase() !== nombre.toLowerCase())
    if (restantes.length === categorias.length) return i.reply({ content: 'No se encontró esa categoría.', flags: efimero })
    await guardarCategorias(restantes)
    return i.reply({ content: `Categoría **${nombre}** eliminada.`, flags: efimero })
  }

  const empresa = await buscarEmpresa(i.options.getString('identificador', true))
  if (!empresa) return i.reply({ content: 'No se encontró una empresa activa.', flags: efimero })
  await db.institucion.update({ where: { id: empresa.id }, data: { activa: false } })
  return i.reply({ content: `Empresa **${empresa.nombre}** desactivada.`, flags: efimero })
}

async function leerCategorias(): Promise<string[]> {
  const fila = await db.configuracionServidor.findUnique({ where: { clave: 'owner.categorias' } })
  return Array.isArray(fila?.valor) ? fila.valor.filter((x): x is string => typeof x === 'string') : []
}

async function guardarCategorias(categorias: string[]) {
  await db.configuracionServidor.upsert({
    where: { clave: 'owner.categorias' },
    create: { clave: 'owner.categorias', valor: categorias },
    update: { valor: categorias },
  })
}

async function buscarEmpresa(valor: string) {
  const identificador = valor.trim()
  return db.institucion.findFirst({ where: {
    activa: true,
    OR: [{ slug: identificador.toLowerCase() }, { nombre: { equals: identificador, mode: 'insensitive' } }],
  } })
}

function normalizarSlug(valor: string) {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
}

function esErrorUnico(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function esOwner(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return false
  const owners = (process.env.OWNER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return i.guild.ownerId === i.user.id || owners.includes(i.user.id)
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Esta acción está reservada a los owners configurados.', flags: efimero })
}