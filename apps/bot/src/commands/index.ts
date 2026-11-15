import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import * as panelVerificacion from './panel-verificacion'
import * as cedula from './cedula'

interface Comando {
  data: Pick<SlashCommandBuilder, 'name' | 'toJSON'>
  execute: (i: ChatInputCommandInteraction) => Promise<unknown>
}

export const comandos: Comando[] = [panelVerificacion, cedula]
