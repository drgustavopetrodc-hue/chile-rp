import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ErrorAutorizacionSegundoPersonaje,
  ErrorLimitePersonajes,
  ErrorUsuarioNoVerificado,
} from '../types.js'
import type {
  AutorizarSegundoPersonaje,
  DatosNuevoPersonaje,
  EventoAuditoriaIdentidad,
  PerfilDiscord,
  PersonajeConCedula,
  StoreIdentidad,
  TransaccionIdentidad,
  UsuarioIdentidad,
} from '../types.js'
import { crearPersonaje } from './personajes.js'
import type { OpcionesCrearPersonaje } from './personajes.js'

type RetornoAutorizacionEsVoid = ReturnType<AutorizarSegundoPersonaje> extends void ? true : false
const RETORNO_AUTORIZACION_ES_VOID: RetornoAutorizacionEsVoid = true
const callbackAutorizacionAsincrono = async (_usuario: UsuarioIdentidad) => undefined
const opcionesAutorizacionAsincrona: OpcionesCrearPersonaje<typeof callbackAutorizacionAsincrono> = {
  // @ts-expect-error Los callbacks asíncronos no son autorizadores válidos.
  autorizarSegundoPersonaje: callbackAutorizacionAsincrono,
}
void opcionesAutorizacionAsincrona

const PERFIL: PerfilDiscord = {
  discordId: '123456789012345678',
  username: 'jugador',
}

function crearStoreFake(
  opciones: { verificacion?: UsuarioIdentidad['verificacion']; activos?: number } = {},
) {
  const usuario: UsuarioIdentidad = {
    id: 'usuario-1',
    discordId: PERFIL.discordId,
    username: PERFIL.username,
    avatar: null,
    rol: 'JUGADOR',
    verificacion: opciones.verificacion ?? 'VERIFICADO',
  }
  const auditorias: EventoAuditoriaIdentidad[] = []
  let conteoBloqueos = 0
  let cantidadCreados = 0

  const operaciones: TransaccionIdentidad = {
    bloquearCreacionPersonaje: async () => { conteoBloqueos++ },
    upsertUsuarioPerfil: async () => usuario,
    obtenerUsuarioPorDiscordId: async () => usuario,
    contarPersonajesActivos: async () => opciones.activos ?? 0,
    crearPersonajeConCedula: async (datos: DatosNuevoPersonaje) => {
      cantidadCreados++
      return {
        id: `personaje-${cantidadCreados}`,
        usuarioId: datos.usuarioId,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        rut: datos.rut,
        fechaNacimiento: datos.fechaNacimiento,
        nacionalidad: 'Chilena',
        activo: true,
        creadoEn: new Date(),
        cedula: {
          id: `cedula-${cantidadCreados}`,
          personajeId: `personaje-${cantidadCreados}`,
          numeroSerie: datos.numeroSerie,
          robloxUsername: datos.robloxUsername,
          emitidaEn: new Date(),
          venceEn: datos.venceEn,
          estado: 'VIGENTE',
        },
      }
    },
    registrarAuditoria: async (evento) => { auditorias.push(evento) },
  }
  const store: StoreIdentidad = {
    ...operaciones,
    transaction: async <T>(operacion: (tx: TransaccionIdentidad) => Promise<T>) =>
      operacion(operaciones),
    listarPersonajesActivos: async () => [],
    consultarCedulaPorPersonaje: async () => null,
    personajePerteneceAUsuario: async () => false,
  }

  return {
    store,
    auditorias,
    get bloqueos() { return conteoBloqueos },
    get creados() { return cantidadCreados },
  }
}

const entrada = {
  perfil: PERFIL,
  nombres: 'Ana',
  apellidos: 'Pérez',
  fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
  robloxUsername: 'ana_rp',
}

test('crea personaje y cédula dentro del flujo transaccional y audita ambos', async () => {
  const fake = crearStoreFake()
  const personaje = await crearPersonaje(entrada, { store: fake.store })

  assert.equal(personaje.cedula?.personajeId, personaje.id)
  assert.equal(fake.bloqueos, 1)
  assert.deepEqual(fake.auditorias.map(({ entidad }) => entidad), ['Personaje', 'Cedula'])
  assert.ok(fake.auditorias.every(({ actorId }) => actorId === 'usuario-1'))
})

test('exige autorización de servidor para el segundo personaje', async () => {
  assert.equal(RETORNO_AUTORIZACION_ES_VOID, true)
  const fake = crearStoreFake({ activos: 1 })
  await assert.rejects(
    crearPersonaje(entrada, { store: fake.store }),
    ErrorAutorizacionSegundoPersonaje,
  )
  const intentoBooleano = { store: fake.store, autorizarSegundoPersonaje: true }
  // @ts-expect-error La autorización requiere un callback confiable, no un booleano.
  await assert.rejects(crearPersonaje(entrada, intentoBooleano), ErrorAutorizacionSegundoPersonaje)

  let autorizaciones = 0
  const autorizar: AutorizarSegundoPersonaje = (usuario) => {
    assert.equal(usuario.id, 'usuario-1')
    autorizaciones++
  }
  await crearPersonaje(entrada, {
    store: fake.store,
    autorizarSegundoPersonaje: autorizar,
  })
  assert.equal(autorizaciones, 1)
})

test('impide crear personaje sin verificación y superar el límite activo', async () => {
  const noVerificado = crearStoreFake({ verificacion: 'PENDIENTE' })
  await assert.rejects(
    crearPersonaje(entrada, { store: noVerificado.store }),
    ErrorUsuarioNoVerificado,
  )

  const enLimite = crearStoreFake({ activos: 2 })
  await assert.rejects(
    crearPersonaje(entrada, { store: enLimite.store }),
    ErrorLimitePersonajes,
  )
  assert.equal(enLimite.creados, 0)
})
