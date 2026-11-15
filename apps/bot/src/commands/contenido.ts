import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'

const efimero = MessageFlags.Ephemeral

export const embedData = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Publica contenido en formato embed')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('anuncio').setDescription('Publica un anuncio oficial')
    .addStringOption((o) => o.setName('titulo').setDescription('Título del anuncio').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('mensaje').setDescription('Contenido').setRequired(true).setMaxLength(3500))
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de destino').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('confesiones').setDescription('Publica una confesión revisada')
    .addStringOption((o) => o.setName('mensaje').setDescription('Texto de la confesión').setRequired(true).setMaxLength(3500))
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de destino').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))

export const contenido = { data: embedData, execute: ejecutarEmbed }

async function ejecutarEmbed(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return i.reply({ content: 'Este comando requiere permisos de staff.', flags: efimero })
  const canalId = i.options.getChannel('canal')?.id ?? i.channelId
  const canal = await i.guild?.channels.fetch(canalId)
  if (!canal?.isTextBased() || !('send' in canal)) return i.reply({ content: 'El canal elegido no permite mensajes.', flags: efimero })

  const accion = i.options.getSubcommand()
  const anuncio = accion === 'anuncio'
  const embed = new EmbedBuilder()
    .setColor(anuncio ? 0x1e6f5c : 0x8c4a5e)
    .setTitle(anuncio ? i.options.getString('titulo', true) : 'Confesión')
    .setDescription(i.options.getString('mensaje', true))
    .setFooter({ text: anuncio ? `Anuncio oficial · ${i.guild!.name}` : `Confesión revisada · ${i.guild!.name}` })
    .setTimestamp()
  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } })
  return i.reply({ content: `${anuncio ? 'Anuncio' : 'Confesión'} publicada en ${canal}.`, flags: efimero })
}

function esStaff(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  if (!i.inCachedGuild()) return false
  return [process.env.ROL_STAFF_ID, process.env.ROL_MODERADOR_ID, process.env.ROL_SOPORTE_ID, process.env.ROL_ADMIN_ID]
    .some((id) => !!id && i.member.roles.cache.has(id))
}