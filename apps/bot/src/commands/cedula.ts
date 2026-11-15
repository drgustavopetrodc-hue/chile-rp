import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { formatearFecha } from '../utils/fechas'

export const data = new SlashCommandBuilder()
  .setName('cedula')
  .setDescription('Muestra una cédula de identidad')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano (por defecto, tú)'))

export async function execute(i: ChatInputCommandInteraction) {
  const objetivo = i.options.getUser('usuario') ?? i.user

  const personaje = await db.personaje.findFirst({
    where: { activo: true, usuario: { discordId: objetivo.id }, cedula: { isNot: null } },
    include: { cedula: true },
    orderBy: { creadoEn: 'asc' },
  })
  if (!personaje || !personaje.cedula) {
    return i.reply({
      content: objetivo.id === i.user.id ? 'Aún no tienes cédula.' : `${objetivo} no tiene cédula.`,
      flags: MessageFlags.Ephemeral,
    })
  }

  const c = personaje.cedula
  const embed = new EmbedBuilder()
    .setColor(0x0039a6)
    .setTitle('República de Chile — Cédula de Identidad')
    .setThumbnail(objetivo.displayAvatarURL())
    .addFields(
      { name: 'Nombres', value: personaje.nombres, inline: true },
      { name: 'Apellidos', value: personaje.apellidos, inline: true },
      { name: 'RUT', value: personaje.rut, inline: true },
      { name: 'Nacionalidad', value: personaje.nacionalidad, inline: true },
      { name: 'Nacimiento', value: formatearFecha(personaje.fechaNacimiento), inline: true },
      { name: 'N° de serie', value: c.numeroSerie, inline: true },
      { name: 'Emisión', value: formatearFecha(c.emitidaEn), inline: true },
      { name: 'Vencimiento', value: formatearFecha(c.venceEn), inline: true },
      { name: 'Estado', value: c.estado, inline: true },
    )
  return i.reply({ embeds: [embed] })
}
