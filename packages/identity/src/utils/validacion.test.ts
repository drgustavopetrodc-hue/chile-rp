import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ErrorLimitePersonajes,
  ErrorValidacionIdentidad,
} from '../types.js'
import {
  requiereAutorizacionSegundoPersonaje,
  validarDatosNuevoPersonaje,
  validarPerfilDiscord,
} from './validacion.js'

test('valida y normaliza perfil de Discord', () => {
  assert.deepEqual(validarPerfilDiscord({
    discordId: '  123456789012345678  ',
    username: '  jugador  ',
    avatar: null,
  }), {
    discordId: '123456789012345678',
    username: 'jugador',
    avatar: null,
  })
  assert.throws(
    () => validarPerfilDiscord({ discordId: '', username: 'jugador' }),
    ErrorValidacionIdentidad,
  )
})

test('rechaza perfiles de Discord nulos, indefinidos o inválidos con error de identidad', () => {
  for (const perfil of [null, undefined, {}, [], 'perfil']) {
    assert.throws(
      () => validarPerfilDiscord(perfil),
      ErrorValidacionIdentidad,
    )
  }
})

test('valida datos de personaje y copia la fecha recibida', () => {
  const fecha = new Date('2000-01-02T00:00:00.000Z')
  const datos = validarDatosNuevoPersonaje({
    nombres: '  Ana  ',
    apellidos: '  Pérez  ',
    fechaNacimiento: fecha,
    robloxUsername: 'ana_rp',
  })
  assert.deepEqual(datos, {
    nombres: 'Ana',
    apellidos: 'Pérez',
    fechaNacimiento: fecha,
    robloxUsername: 'ana_rp',
  })
  assert.notEqual(datos.fechaNacimiento, fecha)
  assert.equal(datos.robloxUsername, 'ana_rp')
  assert.throws(
    () => validarDatosNuevoPersonaje({
      nombres: '',
      apellidos: 'Pérez',
      fechaNacimiento: fecha,
      robloxUsername: 'ana_rp',
    }),
    ErrorValidacionIdentidad,
  )
  assert.throws(
    () => validarDatosNuevoPersonaje({
      nombres: 'Ana',
      apellidos: 'Pérez',
      fechaNacimiento: new Date(Number.NaN),
      robloxUsername: 'ana_rp',
    }),
    ErrorValidacionIdentidad,
  )
})

test('rechaza datos de personaje nulos, indefinidos o inválidos con error de identidad', () => {
  for (const datos of [null, undefined, {}, [], 'personaje']) {
    assert.throws(
      () => validarDatosNuevoPersonaje(datos),
      ErrorValidacionIdentidad,
    )
  }
})

test('acepta un nombre Roblox válido', () => {
  const datos = validarDatosNuevoPersonaje({
    nombres: 'Ana',
    apellidos: 'Pérez',
    fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
    robloxUsername: 'Ana_123',
  })
  assert.equal(datos.robloxUsername, 'Ana_123')
})

test('rechaza un nombre Roblox demasiado corto', () => {
  assert.throws(
    () => validarDatosNuevoPersonaje({
      nombres: 'Ana',
      apellidos: 'Pérez',
      fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
      robloxUsername: 'ab',
    }),
    ErrorValidacionIdentidad,
  )
})

test('rechaza un nombre Roblox demasiado largo', () => {
  assert.throws(
    () => validarDatosNuevoPersonaje({
      nombres: 'Ana',
      apellidos: 'Pérez',
      fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
      robloxUsername: 'a'.repeat(21),
    }),
    ErrorValidacionIdentidad,
  )
})

test('rechaza espacios y caracteres no permitidos en el nombre Roblox', () => {
  for (const robloxUsername of ['ana rp', 'ana-rp', '@ana', ' ana_rp']) {
    assert.throws(
      () => validarDatosNuevoPersonaje({
        nombres: 'Ana',
        apellidos: 'Pérez',
        fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
        robloxUsername,
      }),
      ErrorValidacionIdentidad,
      robloxUsername,
    )
  }
})

test('rechaza fechas de nacimiento futuras y acepta fechas válidas', () => {
  assert.throws(
    () => validarDatosNuevoPersonaje({
      nombres: 'Ana',
      apellidos: 'Pérez',
      fechaNacimiento: new Date(Date.now() + 60_000),
      robloxUsername: 'ana_rp',
    }),
    ErrorValidacionIdentidad,
  )
  assert.equal(
    validarDatosNuevoPersonaje({
      nombres: 'Ana',
      apellidos: 'Pérez',
      fechaNacimiento: new Date('2000-01-02T00:00:00.000Z'),
      robloxUsername: 'ana_rp',
    }).fechaNacimiento.toISOString(),
    '2000-01-02T00:00:00.000Z',
  )
})

test('requiere autorización solo para el segundo personaje y aplica el límite', () => {
  assert.equal(requiereAutorizacionSegundoPersonaje(0), false)
  assert.equal(requiereAutorizacionSegundoPersonaje(1), true)
  assert.throws(() => requiereAutorizacionSegundoPersonaje(2), ErrorLimitePersonajes)
  assert.throws(() => requiereAutorizacionSegundoPersonaje(-1), ErrorValidacionIdentidad)
})
