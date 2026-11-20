import assert from 'node:assert/strict'
import test from 'node:test'
import {
  capturaVozReservada,
  liberarCapturaVoz,
  reservarCapturaVoz,
} from './registro-captura-voz'

test('impide dos capturas simultáneas en el mismo canal y libera solo a su propietario', () => {
  assert.equal(reservarCapturaVoz('canal-1', 'grabacion-1'), true)
  assert.equal(reservarCapturaVoz('canal-1', 'grabacion-2'), false)
  assert.equal(capturaVozReservada('canal-1'), true)

  liberarCapturaVoz('canal-1', 'grabacion-2')
  assert.equal(capturaVozReservada('canal-1'), true)

  liberarCapturaVoz('canal-1', 'grabacion-1')
  assert.equal(capturaVozReservada('canal-1'), false)
})
