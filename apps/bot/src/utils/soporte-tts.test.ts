import assert from 'node:assert/strict'
import test from 'node:test'
import { anunciosTtsSoporte, VOZ_TTS_SOPORTE } from './soporte-tts'

test('usa una voz neural chilena para los anuncios institucionales', () => {
  assert.equal(VOZ_TTS_SOPORTE, 'es-CL-LorenzoNeural')
})

test('el anuncio inicial exige consentimiento explícito e individual', () => {
  assert.match(anunciosTtsSoporte.inicioConConsentimiento, /consentimiento explícito e individual/i)
  assert.match(anunciosTtsSoporte.inicioConConsentimiento, /botones de consentimiento/i)
  assert.match(anunciosTtsSoporte.inicioConConsentimiento, /no se grabará audio/i)
})

test('el anuncio sin almacenamiento no afirma que exista grabación', () => {
  assert.match(anunciosTtsSoporte.inicioSinGrabacion, /no se encuentra disponible/i)
  assert.match(anunciosTtsSoporte.inicioSinGrabacion, /continuará sin grabación/i)
})

test('los anuncios de estado distinguen inicio, rechazo, retiro y error', () => {
  assert.match(anunciosTtsSoporte.grabacionActiva, /grabación de audio se encuentra activo/i)
  assert.match(anunciosTtsSoporte.consentimientoRechazado, /no se obtuvo el consentimiento/i)
  assert.match(anunciosTtsSoporte.consentimientoRetirado, /ha retirado su consentimiento/i)
  assert.match(anunciosTtsSoporte.errorGrabacion, /inconveniente técnico/i)
})
