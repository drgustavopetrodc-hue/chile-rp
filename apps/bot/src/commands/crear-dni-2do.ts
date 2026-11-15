import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js'
import { db } from '@rp-chile/db'
import { crearPersonaje } from '../utils/personajes'
import { parsearFecha } from '../utils/fechas'
import { obtenerAvatarRoblox, RobloxLookupError } from '../utils/roblox'
import { publicarImagenCedula } from './cedula'

export const data = new SlashCommandBuilder()
  .setName('crear-dni-2do')
  .setDescription('Crea tu segundo personaje con el rol autorizado')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('nombres').setDescription('Nombres').setRequired(true).setMaxLength(40))
  .addStringOption((o) => o.setName('apellidos').setDescription('Apellidos').setRequired(true).setMaxLength(40))
  .addStringOption((o) => o.setName('nacimiento').setDescription('Fecha DD/MM/AAAA').setRequired(true))
  .addStringOption((o) => o.setName('roblox').setDescription('Usuario de Roblox, sin @').setRequired(true).setMaxLength(20))

export async function execute(i: ChatInputCommandInteraction) {
  const rolId = process.env.ROL_SEGUNDO_PERSONAJE_ID
  if (!rolId || !i.inCachedGuild() || !i.member.roles.cache.has(rolId)) {
    return i.reply({ content: 'Necesitas el rol de segundo personaje para usar este comando.', flags: MessageFlags.Ephemeral })
  }
  const usuario = await db.usuario.findUnique({ where: { discordId: i.user.id } })
  if (usuario?.verificacion !== 'VERIFICADO') {
    return i.reply({ content: 'Debes estar verificado para crear un personaje.', flags: MessageFlags.Ephemeral })
  }
  const cantidad = await db.personaje.count({ where: { activo: true, usuario: { discordId: i.user.id } } })
  if (cantidad !== 1) {
    return i.reply({ content: 'Debes tener exactamente un personaje activo para crear el segundo.', flags: MessageFlags.Ephemeral })
  }
  const fecha = parsearFecha(i.options.getString('nacimiento', true))
  if (!fecha) return i.reply({ content: 'Fecha inválida. Usa DD/MM/AAAA.', flags: MessageFlags.Ephemeral })
  await i.deferReply({ flags: MessageFlags.Ephemeral })
  let roblox: Awaited<ReturnType<typeof obtenerAvatarRoblox>>
  try {
    roblox = await obtenerAvatarRoblox(i.options.getString('roblox', true))
  } catch (error) {
    if (error instanceof RobloxLookupError) return i.editReply(error.message)
    throw error
  }
  const personaje = await crearPersonaje(
    i.user,
    i.options.getString('nombres', true),
    i.options.getString('apellidos', true),
    fecha,
    roblox.username,
  )
  const cedulaCreada = personaje.cedula
  if (!cedulaCreada) return i.editReply('El personaje se creó, pero no se pudo cargar su cédula. Contacta al staff.')
  return publicarImagenCedula(i, { ...personaje, cedula: cedulaCreada }, roblox.avatar, true)
}