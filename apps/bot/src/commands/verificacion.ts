import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { crearPanel } from '../handlers/verificacion'
import { enviarComponentsV2 } from '../utils/components-v2'

export const data = new SlashCommandBuilder()
  .setName('verificacion')
  .setDescription('Publica el panel de verificación')
  .setContexts(InteractionContextType.Guild)

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
    !(i.inCachedGuild() && process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID))) {
    return i.reply({ content: 'Solo administradores pueden publicar el panel.', flags: MessageFlags.Ephemeral })
  }
  if (!i.channel?.isSendable()) return i.reply({ content: 'No puedo escribir en este canal.', flags: MessageFlags.Ephemeral })
  await enviarComponentsV2(i.channel, crearPanel())
  return i.reply({ content: 'Panel publicado.', flags: MessageFlags.Ephemeral })
}