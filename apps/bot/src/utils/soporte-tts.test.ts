import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anunciosTtsSoporte,
  ejecutarConParticipantesSilenciados,
  VOZ_TTS_SOPORTE,
} from './soporte-tts'

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

test('silencia a los miembros durante el anuncio y restaura solo los que silenció', async () => {
  const estados = new Map([
    ['participante', false],
    ['moderador', false],
    ['silenciado', true],
  ])
  const llamadas: Array<{ id: string; mute: boolean }> = []
  const miembros = [...estados].map(([id]) => ({
    id,
    user: { bot: false },
    voice: {
      get serverMute() { return estados.get(id)! },
      async setMute(mute: boolean) {
        llamadas.push({ id, mute })
        estados.set(id, mute)
      },
    },
  }))
  miembros.push({
    id: 'bot',
    user: { bot: true },
    voice: {
      get serverMute() { return false },
      async setMute(mute: boolean) {
        llamadas.push({ id: 'bot', mute })
      },
    },
  })

  let reproduccionVioSilencioCompleto = false
  await ejecutarConParticipantesSilenciados(miembros, async () => {
    reproduccionVioSilencioCompleto =
      estados.get('participante') === true &&
      estados.get('moderador') === true &&
      estados.get('silenciado') === true
  })

  assert.equal(reproduccionVioSilencioCompleto, true)
  assert.equal(estados.get('participante'), false)
  assert.equal(estados.get('moderador'), false)
  assert.equal(estados.get('silenciado'), true)
  assert.deepEqual(llamadas, [
    { id: 'participante', mute: true },
    { id: 'moderador', mute: true },
    { id: 'participante', mute: false },
    { id: 'moderador', mute: false },
  ])
})

test('restaura los silencios temporales aunque falle la reproducción', async () => {
  let serverMute = false
  const miembro = {
    id: 'participante',
    user: { bot: false },
    voice: {
      get serverMute() { return serverMute },
      async setMute(mute: boolean) { serverMute = mute },
    },
  }

  await assert.rejects(
    ejecutarConParticipantesSilenciados([miembro], async () => {
      throw new Error('fallo de reproducción')
    }),
    /fallo de reproducción/,
  )
  assert.equal(serverMute, false)
})
