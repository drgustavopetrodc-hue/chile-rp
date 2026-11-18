import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anioEnChile,
  alcanceAutoridadAdministrativa,
  alcancesAutoridadExpediente,
  formatearFolioAdministrativo,
  puedeCambiarEstadoExpediente,
} from './expedientes'

test('solo permite transiciones administrativas explícitas y deja archivados como terminales', () => {
  assert.equal(puedeCambiarEstadoExpediente('RECIBIDO', 'EN_REVISION'), true)
  assert.equal(puedeCambiarEstadoExpediente('RESUELTO', 'EN_REVISION'), true)
  assert.equal(puedeCambiarEstadoExpediente('RECIBIDO', 'RESUELTO'), false)
  assert.equal(puedeCambiarEstadoExpediente('ARCHIVADO', 'EN_REVISION'), false)
})

test('usa un alcance general o institucional determinista para las competencias', () => {
  assert.equal(alcanceAutoridadAdministrativa(), 'GENERAL')
  assert.equal(alcanceAutoridadAdministrativa('inst-123'), 'INSTITUCION:inst-123')
  assert.deepEqual(alcancesAutoridadExpediente('inst-123'), ['INSTITUCION:inst-123', 'GENERAL'])
  assert.deepEqual(alcancesAutoridadExpediente(), ['GENERAL'])
})

test('genera folios estables y calcula el año según la zona horaria de Chile', () => {
  assert.equal(formatearFolioAdministrativo(2026, 7), 'ADM-2026-00007')
  assert.equal(anioEnChile(new Date('2026-01-01T02:30:00.000Z')), 2025)
  assert.throws(() => formatearFolioAdministrativo(2026, 0), RangeError)
})
