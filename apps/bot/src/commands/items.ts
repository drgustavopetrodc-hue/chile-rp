import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'

const efimero = MessageFlags.Ephemeral

export const itemData = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Administra artículos e inventarios')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('crear').setDescription('Crea un artículo de tienda')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre único').setRequired(true).setMaxLength(80))
    .addIntegerOption((o) => o.setName('precio').setDescription('Precio en pesos').setRequired(true).setMinValue(0).setMaxValue(2_000_000_000))
    .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setMaxLength(500)))
  .addSubcommand((s) => s.setName('editar').setDescription('Edita un artículo existente')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre actual del artículo').setRequired(true))
    .addStringOption((o) => o.setName('nuevo_nombre').setDescription('Nuevo nombre').setMaxLength(80))
    .addIntegerOption((o) => o.setName('precio').setDescription('Nuevo precio').setMinValue(0).setMaxValue(2_000_000_000))
    .addStringOption((o) => o.setName('descripcion').setDescription('Nueva descripción').setMaxLength(500)))
  .addSubcommand((s) => s.setName('eliminar').setDescription('Desactiva un artículo')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre del artículo').setRequired(true)))
  .addSubcommand((s) => s.setName('dar').setDescription('Entrega artículos a un personaje')
    .addUserOption((o) => o.setName('usuario').setDescription('Destinatario').setRequired(true))
    .addStringOption((o) => o.setName('articulo').setDescription('Nombre del artículo').setRequired(true))
    .addIntegerOption((o) => o.setName('cantidad').setDescription('Cantidad').setRequired(true).setMinValue(1).setMaxValue(1000)))

export const item = { data: itemData, execute: ejecutarItem }

async function ejecutarItem(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden administrar artículos.', flags: efimero })
  const accion = i.options.getSubcommand()
  const nombre = i.options.getString('nombre')?.trim()

  if (accion === 'crear') {
    try {
      const creado = await db.item.create({
        data: {
          nombre: nombre!,
          precio: BigInt(i.options.getInteger('precio', true)),
          descripcion: i.options.getString('descripcion')?.trim() || null,
        },
      })
      return i.reply({ content: `Artículo **${creado.nombre}** creado.`, flags: efimero })
    } catch (error) {
      if (esErrorUnico(error)) return i.reply({ content: 'Ya existe un artículo con ese nombre.', flags: efimero })
      throw error
    }
  }

  if (accion === 'editar') {
    const nuevoNombre = i.options.getString('nuevo_nombre')?.trim()
    const precio = i.options.getInteger('precio')
    const descripcion = i.options.getString('descripcion')
    if (!nuevoNombre && precio === null && descripcion === null) {
      return i.reply({ content: 'Indica al menos un campo para editar.', flags: efimero })
    }
    try {
      const cambio = await db.item.updateMany({
        where: { nombre: { equals: nombre!, mode: 'insensitive' }, activa: true },
        data: {
          ...(nuevoNombre && { nombre: nuevoNombre }),
          ...(precio !== null && { precio: BigInt(precio) }),
          ...(descripcion !== null && { descripcion: descripcion.trim() || null }),
        },
      })
      return i.reply({ content: cambio.count ? 'Artículo actualizado.' : 'No se encontró un artículo activo con ese nombre.', flags: efimero })
    } catch (error) {
      if (esErrorUnico(error)) return i.reply({ content: 'Ya existe un artículo con ese nombre.', flags: efimero })
      throw error
    }
  }

  if (accion === 'eliminar') {
    const cambio = await db.item.updateMany({ where: { nombre: { equals: nombre!, mode: 'insensitive' }, activa: true }, data: { activa: false } })
    return i.reply({ content: cambio.count ? 'Artículo desactivado; su inventario existente se conserva.' : 'No se encontró un artículo activo con ese nombre.', flags: efimero })
  }

  const destinatario = i.options.getUser('usuario', true)
  const personaje = await db.personaje.findFirst({ where: { activo: true, usuario: { discordId: destinatario.id } }, orderBy: { creadoEn: 'asc' } })
  if (!personaje) return i.reply({ content: 'El usuario no tiene un personaje activo.', flags: efimero })
  const articulo = i.options.getString('articulo', true).trim()
  const registro = await db.item.findFirst({ where: { activa: true, nombre: { equals: articulo, mode: 'insensitive' } } })
  if (!registro) return i.reply({ content: 'No se encontró un artículo activo.', flags: efimero })
  const cantidad = i.options.getInteger('cantidad', true)
  await db.inventarioItem.upsert({
    where: { personajeId_itemId: { personajeId: personaje.id, itemId: registro.id } },
    create: { personajeId: personaje.id, itemId: registro.id, cantidad },
    update: { cantidad: { increment: cantidad } },
  })
  return i.reply({ content: `Entregados **${cantidad} × ${registro.nombre}** a <@${destinatario.id}>.`, flags: efimero })
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}

function esErrorUnico(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}