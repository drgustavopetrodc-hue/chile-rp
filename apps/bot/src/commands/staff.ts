import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { RolPlataforma, db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'

const efimero = MessageFlags.Ephemeral
const opcionesStaff = [
  { name: 'Soporte', value: 'soporte' },
  { name: 'Moderador', value: 'moderador' },
  { name: 'Administrador', value: 'admin' },
] as const

export const staffData = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Administra el equipo del servidor')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('agregar').setDescription('Agrega una persona al equipo')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true))
    .addStringOption((o) => o.setName('tipo').setDescription('Rol del equipo').setRequired(true).addChoices(...opcionesStaff)))
  .addSubcommand((s) => s.setName('quitar').setDescription('Retira un rol del equipo')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true))
    .addStringOption((o) => o.setName('tipo').setDescription('Rol que se retirará').setRequired(true).addChoices(...opcionesStaff)))
  .addSubcommand((s) => s.setName('ver').setDescription('Lista miembros staff registrados'))

export const staff = { data: staffData, execute: ejecutarStaff }

async function ejecutarStaff(i: ChatInputCommandInteraction) {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden gestionar el equipo.', flags: efimero })
  const accion = i.options.getSubcommand()
  if (accion === 'ver') {
    const usuarios = await db.usuario.findMany({ where: { rol: { in: [RolPlataforma.STAFF, RolPlataforma.ADMIN] } }, orderBy: [{ rol: 'desc' }, { username: 'asc' }], take: 100 })
    return i.reply({
      content: usuarios.length ? usuarios.map((u) => `<@${u.discordId}> · ${u.rol}`).join('\n') : 'No hay miembros staff registrados.',
      flags: efimero,
    })
  }

  if (!i.inCachedGuild()) return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  const usuario = i.options.getUser('usuario', true)
  const tipo = i.options.getString('tipo', true) as (typeof opcionesStaff)[number]['value']
  const rolId = rolDiscord(tipo)
  if (!rolId) return i.reply({ content: `Falta configurar el rol de ${tipo} en las variables de entorno.`, flags: efimero })
  const miembro = await i.guild.members.fetch(usuario.id).catch(() => null)
  if (!miembro) return i.reply({ content: 'El usuario no es miembro del servidor.', flags: efimero })

  if (accion === 'agregar') {
    await miembro.roles.add(rolId, `Agregado por ${i.user.tag}`)
  } else {
    if (!miembro.roles.cache.has(rolId)) return i.reply({ content: 'Ese miembro no tiene el rol seleccionado.', flags: efimero })
    await miembro.roles.remove(rolId, `Retirado por ${i.user.tag}`)
  }

  const usuarioDb = await asegurarUsuario(usuario)
  const conservaAdmin = miembro.roles.cache.has(process.env.ROL_ADMIN_ID ?? '') && tipo !== 'admin'
  const conservaStaff = [process.env.ROL_STAFF_ID, process.env.ROL_MODERADOR_ID, process.env.ROL_SOPORTE_ID]
    .some((id) => !!id && miembro.roles.cache.has(id) && id !== rolId)
  const rolPlataforma = accion === 'agregar'
    ? (tipo === 'admin' ? RolPlataforma.ADMIN : RolPlataforma.STAFF)
    : conservaAdmin ? RolPlataforma.ADMIN : conservaStaff ? RolPlataforma.STAFF : RolPlataforma.JUGADOR
  await db.usuario.update({ where: { id: usuarioDb.id }, data: { rol: rolPlataforma } })
  return i.reply({ content: accion === 'agregar' ? `Rol de ${tipo} asignado a ${usuario.tag}.` : `Rol de ${tipo} retirado de ${usuario.tag}.`, flags: efimero })
}

function rolDiscord(tipo: (typeof opcionesStaff)[number]['value']) {
  if (tipo === 'admin') return process.env.ROL_ADMIN_ID
  if (tipo === 'moderador') return process.env.ROL_MODERADOR_ID
  return process.env.ROL_SOPORTE_ID
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}