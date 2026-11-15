import { EmbedBuilder } from 'discord.js'

export const coloresEmbed = {
  principal: 0x176b63,
  exito: 0x25845a,
  aviso: 0xc28b2c,
  error: 0xb84d4d,
  neutro: 0x53636a,
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