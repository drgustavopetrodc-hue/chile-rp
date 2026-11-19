import {
  ErrorLimitePersonajes,
  ErrorValidacionIdentidad,
} from '../types.js'
import type { PerfilDiscord } from '../types.js'

export const MAX_PERSONAJES_ACTIVOS = 2

export function validarPerfilDiscord(perfil: unknown): PerfilDiscord {
  if (!esRegistro(perfil)) {
    throw new ErrorValidacionIdentidad('El perfil de Discord no es válido.')
  }
  const discordId = validarTexto(perfil.discordId, 'discordId', 1, 64)
  const username = validarTexto(perfil.username, 'username', 1, 100)
  const avatar = perfil.avatar
  let avatarValidado: string | null | undefined
  if (avatar !== undefined && avatar !== null) {
    avatarValidado = validarTexto(avatar, 'avatar', 1, 2048)
  } else {
    avatarValidado = avatar
  }
  return { discordId, username, avatar: avatarValidado }
}

export function validarDatosNuevoPersonaje(
  datos: unknown,
) {
  if (!esRegistro(datos)) {
    throw new ErrorValidacionIdentidad('Los datos del personaje no son válidos.')
  }
  const nombres = validarTexto(datos.nombres, 'nombres', 1, 40)
  const apellidos = validarTexto(datos.apellidos, 'apellidos', 1, 40)
  const robloxUsername = validarNombreRoblox(datos.robloxUsername)
  const fechaNacimiento = datos.fechaNacimiento
  if (!(fechaNacimiento instanceof Date) || !Number.isFinite(fechaNacimiento.getTime())) {
    throw new ErrorValidacionIdentidad('La fecha de nacimiento no es válida.')
  }
  if (fechaNacimiento.getTime() > Date.now()) {
    throw new ErrorValidacionIdentidad('La fecha de nacimiento no puede ser futura.')
  }
  return {
    nombres,
    apellidos,
    fechaNacimiento: new Date(fechaNacimiento),
    robloxUsername,
  }
}

export function requiereAutorizacionSegundoPersonaje(cantidadActiva: number) {
  if (!Number.isSafeInteger(cantidadActiva) || cantidadActiva < 0) {
    throw new ErrorValidacionIdentidad('La cantidad de personajes activos no es válida.')
  }
  if (cantidadActiva >= MAX_PERSONAJES_ACTIVOS) throw new ErrorLimitePersonajes()
  return cantidadActiva === 1
}

function validarNombreRoblox(valor: unknown) {
  if (typeof valor !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(valor)) {
    throw new ErrorValidacionIdentidad(
      'El nombre de Roblox debe tener entre 3 y 20 letras, números o guiones bajos.',
    )
  }
  return valor
}

function validarTexto(valor: unknown, campo: string, minimo: number, maximo: number) {
  if (typeof valor !== 'string') throw new ErrorValidacionIdentidad(`El campo ${campo} debe ser texto.`)
  const normalizado = valor.trim()
  if (normalizado.length < minimo || normalizado.length > maximo) {
    throw new ErrorValidacionIdentidad(`El campo ${campo} debe tener entre ${minimo} y ${maximo} caracteres.`)
  }
  return normalizado
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}
