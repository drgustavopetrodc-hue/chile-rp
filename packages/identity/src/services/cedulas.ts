import { resolverStoreIdentidad } from '../default-store.js'
import { ErrorValidacionIdentidad } from '../types.js'
import type { CedulaIdentidad, StoreIdentidad } from '../types.js'

export async function consultarCedulaPorPersonaje(
  personajeId: string,
  store?: StoreIdentidad,
): Promise<CedulaIdentidad | null> {
  return (await resolverStoreIdentidad(store)).consultarCedulaPorPersonaje(
    validarIdentificador(personajeId, 'personajeId'),
  )
}

export async function personajePerteneceAUsuario(
  personajeId: string,
  discordId: string,
  store?: StoreIdentidad,
) {
  return (await resolverStoreIdentidad(store)).personajePerteneceAUsuario(
    validarIdentificador(personajeId, 'personajeId'),
    validarIdentificador(discordId, 'discordId'),
  )
}

function validarIdentificador(valor: string, campo: string) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 128) {
    throw new ErrorValidacionIdentidad(`El campo ${campo} no es válido.`)
  }
  return valor.trim()
}
