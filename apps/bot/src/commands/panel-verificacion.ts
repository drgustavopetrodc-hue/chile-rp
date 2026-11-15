import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { crearPanel } from '../handlers/verificacion'

export const data = new SlashCommandBuilder()
  .setName('panel-verificacion')
  .setDescription('Publica el panel de verificación en este canal')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.channel || !i.channel.isSendable()) {
    return i.reply({ content: 'No puedo escribir en este canal.', flags: MessageFlags.Ephemeral })
  }
  await i.channel.send(crearPanel())
  return i.reply({ content: 'Panel publicado.', flags: MessageFlags.Ephemeral })
}
