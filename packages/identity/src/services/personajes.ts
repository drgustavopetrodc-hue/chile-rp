import { resolverStoreIdentidad } from '../default-store.js'
import {
  ErrorAutorizacionSegundoPersonaje,
  ErrorColisionIdentidadUnica,
  ErrorUsuarioNoVerificado,
  ErrorValidacionIdentidad,
} from '../types.js'
import type {
  AutorizarSegundoPersonaje,
  PerfilDiscord,
  PersonajeConCedula,
  StoreIdentidad,
} from '../types.js'
import { generarNumeroSerie, generarRut } from '../utils/rut.js'
import {
  requiereAutorizacionSegundoPersonaje,
  validarDatosNuevoPersonaje,
  validarPerfilDiscord,
} from '../utils/validacion.js'
import { registrarAuditoriaIdentidad } from './auditoria.js'

const INTENTOS_MAXIMOS_COLISION = 5
const ANIOS_VIGENCIA_CEDULA = 5

export interface CrearPersonajeInput {
  perfil: PerfilDiscord
  nombres: string
  apellidos: string
  fechaNacimiento: Date
  robloxUsername: string
}

type CallbackAutorizacion = (usuario: Parameters<AutorizarSegundoPersonaje>[0]) => unknown

export interface OpcionesCrearPersonaje<
  TAutorizacion extends CallbackAutorizacion = AutorizarSegundoPersonaje,
> {
  /**
   * Comprobación local y rápida de permisos, ejecutada dentro de la transacción.
   * No realices solicitudes de red aquí; consulta previamente los permisos que
   * requieran acceso remoto y valida aquí únicamente el estado local resultante.
   */
  autorizarSegundoPersonaje?: TAutorizacion
    & (ReturnType<TAutorizacion> extends PromiseLike<unknown> ? never : unknown)
  store?: StoreIdentidad
}

export async function crearPersonaje<
  TAutorizacion extends CallbackAutorizacion = AutorizarSegundoPersonaje,
>(
  entrada: CrearPersonajeInput,
  opciones: OpcionesCrearPersonaje<TAutorizacion> = {},
): Promise<PersonajeConCedula> {
  const datos = validarDatosNuevoPersonaje(entrada)
  const perfil = validarPerfilDiscord(entrada.perfil)
  const store = await resolverStoreIdentidad(opciones.store)

  for (let intento = 0; intento < INTENTOS_MAXIMOS_COLISION; intento++) {
    const rut = generarRut()
    const numeroSerie = generarNumeroSerie()
    try {
      return await store.transaction(async (tx) => {
        await tx.bloquearCreacionPersonaje(perfil.discordId)
        const usuario = await tx.upsertUsuarioPerfil(perfil)
        if (usuario.verificacion !== 'VERIFICADO') throw new ErrorUsuarioNoVerificado()

        const cantidadActiva = await tx.contarPersonajesActivos(usuario.id)
        if (requiereAutorizacionSegundoPersonaje(cantidadActiva)) {
          const autorizar = opciones.autorizarSegundoPersonaje
          if (typeof autorizar !== 'function') throw new ErrorAutorizacionSegundoPersonaje()
          const resultado: unknown = autorizar(usuario)
          if (resultado !== undefined) throw new ErrorAutorizacionSegundoPersonaje()
        }

        const fechaActual = new Date()
        const venceEn = new Date(fechaActual)
        venceEn.setFullYear(venceEn.getFullYear() + ANIOS_VIGENCIA_CEDULA)
        const personaje = await tx.crearPersonajeConCedula({
          usuarioId: usuario.id,
          ...datos,
          rut,
          numeroSerie,
          venceEn,
        })
        if (!personaje.cedula) {
          throw new ErrorValidacionIdentidad('No se pudo crear la cédula asociada al personaje.')
        }
        await registrarAuditoriaIdentidad(tx, {
          actorId: usuario.id,
          accion: 'identidad.personaje.crear',
          entidad: 'Personaje',
          entidadId: personaje.id,
          detalle: { origen: '@rp-chile/identity' },
        })
        await registrarAuditoriaIdentidad(tx, {
          actorId: usuario.id,
          accion: 'identidad.cedula.emitir',
          entidad: 'Cedula',
          entidadId: personaje.cedula.id,
          detalle: { origen: '@rp-chile/identity' },
        })
        return personaje
      })
    } catch (error) {
      if (!(error instanceof ErrorColisionIdentidadUnica) || intento + 1 === INTENTOS_MAXIMOS_COLISION) {
        throw error
      }
    }
  }
  throw new Error('No fue posible asignar identificadores únicos después de varios intentos.')
}

export async function listarPersonajesActivos(discordId: string, store?: StoreIdentidad) {
  const usuarioId = validarDiscordId(discordId)
  return (await resolverStoreIdentidad(store)).listarPersonajesActivos(usuarioId)
}

function validarDiscordId(discordId: string) {
  if (typeof discordId !== 'string' || !discordId.trim() || discordId.length > 128) {
    throw new ErrorValidacionIdentidad('El discordId no es válido.')
  }
  return discordId.trim()
}
