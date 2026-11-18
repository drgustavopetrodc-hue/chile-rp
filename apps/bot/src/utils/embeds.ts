import { EmbedBuilder } from 'discord.js'

export const coloresEmbed = {
  principal: 0x174a5b,
  exito: 0x2f795d,
  aviso: 0xa77624,
  error: 0xa6454b,
  neutro: 0x5d6a70,
} as const

export function crearEmbed(titulo: string, descripcion?: string, color: number = coloresEmbed.principal) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'REPÚBLICA DE CHILE · ROLEPLAY' })
    .setTitle(titulo)
    .setFooter({ text: 'RP Chile · Sistema del servidor' })
    .setTimestamp()
  if (descripcion) embed.setDescription(descripcion)
  return embed
}