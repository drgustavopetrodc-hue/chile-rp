import { resolverStoreIdentidad } from '../default-store.js'
import { ErrorValidacionIdentidad } from '../types.js'
import type { PerfilDiscord, StoreIdentidad } from '../types.js'
import { validarPerfilDiscord } from '../utils/validacion.js'

export async function crearOActualizarUsuario(
  perfil: PerfilDiscord,
  store?: StoreIdentidad,
) {
  const datos = validarPerfilDiscord(perfil)
  return (await resolverStoreIdentidad(store)).upsertUsuarioPerfil(datos)
}

export async function consultarEstadoVerificacion(discordId: string, store?: StoreIdentidad) {
  const id = validarIdentificador(discordId, 'discordId')
  const usuario = await (await resolverStoreIdentidad(store)).obtenerUsuarioPorDiscordId(id)
  return usuario?.verificacion ?? null
}

export async function estaUsuarioVerificado(discordId: string, store?: StoreIdentidad) {
  return (await consultarEstadoVerificacion(discordId, store)) === 'VERIFICADO'
}

function validarIdentificador(valor: string, campo: string) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 128) {
    throw new ErrorValidacionIdentidad(`El campo ${campo} no es válido.`)
  }
  return valor.trim()
}
