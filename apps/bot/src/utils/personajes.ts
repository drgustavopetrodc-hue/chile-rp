import type { User } from 'discord.js'
import {
  crearPersonaje as crearPersonajeCompartido,
  ErrorLimitePersonajes,
  ErrorUsuarioNoVerificado,
  ErrorValidacionIdentidad,
} from '@rp-chile/identity'
import type {
  OpcionesCrearPersonaje as OpcionesCrearPersonajeCompartidas,
  PerfilDiscord,
} from '@rp-chile/identity'

export type OpcionesCrearPersonaje =
  Pick<OpcionesCrearPersonajeCompartidas, 'autorizarSegundoPersonaje'>

export async function crearPersonaje(
  user: User,
  nombres: string,
  apellidos: string,
  fechaNacimiento: Date,
  robloxUsername: string,
  opciones: OpcionesCrearPersonaje = {},
) {
  const perfil: PerfilDiscord = {
    discordId: user.id,
    username: user.username,
    avatar: user.displayAvatarURL(),
  }
  return crearPersonajeCompartido({
    perfil,
    nombres,
    apellidos,
    fechaNacimiento,
    robloxUsername,
  }, opciones)
}

export function mensajeErrorIdentidadPersonaje(error: unknown): string | undefined {
  if (error instanceof ErrorUsuarioNoVerificado) {
    return 'Debes estar verificado para crear un personaje.'
  }
  if (error instanceof ErrorLimitePersonajes) {
    return 'Ya alcanzaste el límite de personajes activos permitido.'
  }
  if (error instanceof ErrorValidacionIdentidad) {
    return 'Los datos del personaje no son válidos. Revisa nombres, apellidos, fecha y usuario de Roblox.'
  }
  return undefined
}
