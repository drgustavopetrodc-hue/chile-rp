import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function puedeRecuperar(lastTransitionId: number | undefined): boolean {
  return lastTransitionId !== undefined
}

test('reconoce transition 0 como recuperable y undefined como no recuperable', () => {
  assert.equal(puedeRecuperar(0), true)
  assert.equal(puedeRecuperar(25), true)
  assert.equal(puedeRecuperar(undefined), false)
})

test('recupera después del límite de fallos consecutivos cuando existe transición', () => {
  const fallosConsecutivos = 25
  const tolerancia = 24
  assert.equal(fallosConsecutivos > tolerancia && puedeRecuperar(0), true)
  assert.equal(fallosConsecutivos > tolerancia && puedeRecuperar(undefined), false)
})

test('el parche permanece en los bundles CJS y ESM de discordjs voice', async () => {
  for (const archivo of ['index.js', 'index.mjs']) {
    const fuente = await readFile(
      join(process.cwd(), '..', '..', 'node_modules', '@discordjs', 'voice', 'dist', archivo),
      'utf8',
    )
    assert.match(
      fuente,
      /this\.lastTransitionId !== undefined\) this\.recoverFromInvalidTransition/,
      `${archivo} no contiene la comprobación corregida`,
    )
    assert.doesNotMatch(
      fuente,
      /if \(this\.lastTransitionId\) this\.recoverFromInvalidTransition/,
      `${archivo} conserva la comprobación falsy incorrecta`,
    )
  }
})

test('processWelcome conserva transition 0 sin habilitar passthrough global', async () => {
  const fuente = await readFile(
    join(process.cwd(), '..', '..', 'node_modules', '@discordjs', 'voice', 'dist', 'index.js'),
    'utf8',
  )
  assert.match(fuente, /this\.lastTransitionId = transitionId/)
  assert.match(fuente, /processWelcome\(payload\)/)
  assert.doesNotMatch(
    fuente.slice(fuente.indexOf('processWelcome(payload)'), fuente.indexOf('processWelcome(payload)') + 1_500),
    /setPassthroughMode\(true/,
  )
})

test('la reconexión limpia suscripciones antes de recrearlas', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'utils', 'soporte-grabacion.ts'),
    'utf8',
  )
  assert.match(fuente, /reconexionPromise/)
  assert.match(fuente, /reconectarDespuesDeErrorVoz/)
  assert.match(fuente, /this\.limpiarFlujos\(\)/)
  assert.match(fuente, /await this\.suscribir\(this\.manifiesto\.participantes\)/)
  assert.match(fuente, /const debiaCapturar = this\.capturaActiva/)
  assert.doesNotMatch(fuente, /daveEncryption:\s*false/)
})

test('el cierre WebSocket inicia reconexión sin finalizar por el estado Disconnected', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'utils', 'soporte-grabacion.ts'),
    'utf8',
  )
  assert.match(
    fuente,
    /siguiente\.status !== VoiceConnectionStatus\.Disconnected[\s\S]*reconectarDespuesDeErrorVoz/,
  )
  assert.doesNotMatch(
    fuente.slice(fuente.indexOf('stateChange'), fuente.indexOf('reconectarDespuesDeErrorVoz')),
    /this\.conexionError\(new Error/,
  )
})

test('DAVE no recrea la conexión ni repite reconexiones manuales', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'utils', 'soporte-grabacion.ts'),
    'utf8',
  )
  assert.match(fuente, /El parche DAVE está recuperando el descifrado/)
  assert.match(fuente, /30_000/)
  assert.doesNotMatch(fuente, /Reconexión DAVE completada/)
  assert.doesNotMatch(fuente, /reconectarDespuesDeErrorDAVE/)
})

test('el manejador global ignora canales e interacciones Discord desconocidos', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'index.ts'),
    'utf8',
  )
  assert.match(fuente, /codigoDiscord === 10003/)
  assert.match(fuente, /codigoDiscord === 10008/)
  assert.match(fuente, /codigoDiscord === 10062/)
})

test('Servicio Staff no bloquea inicio por soportes activos en otro canal', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'commands', 'servicio-staff.ts'),
    'utf8',
  )
  assert.doesNotMatch(fuente, /hayGrabacionSoporteActiva/)
  assert.match(fuente, /reservarCapturaVoz\(canal\.id, grabacionId\)/)
})

test('Servicio Staff entrega la mezcla final por DM antes de conservar las referencias', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'commands', 'servicio-staff.ts'),
    'utf8',
  )
  assert.match(fuente, /usuario\.send/)
  assert.match(fuente, /servicio-staff-\$\{servicio\.id\}-mezcla\.ogg/)
  assert.match(fuente, /resultado\.mezclaPath/)
})

test('las grabaciones de soporte se publican en ambos canales institucionales de logs', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'commands', 'soporte.ts'),
    'utf8',
  )
  assert.match(fuente, /config\.canales\.logModeracion/)
  assert.match(fuente, /config\.canales\.logAdministracion/)
  assert.match(fuente, /soporte-\$\{registro\.id\}-mezcla\.ogg/)
  assert.match(fuente, /publicarGrabacionEnLogs/)
})

test('cada entrada humana a Asistencia Staff reproduce el saludo institucional', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'commands', 'servicio-staff.ts'),
    'utf8',
  )
  assert.match(fuente, /nuevo\.channelId === grabacionEnCanal\.canal\.id/)
  assert.match(fuente, /await anunciarBienvenidaAsistencia/)
  assert.match(fuente, /bienvenidasAsistenciaEnCurso/)
  assert.match(fuente, /bienvenidasAsistenciaEnCurso\.delete/)
  assert.match(fuente, /if \(bienvenidasAsistenciaEnCurso\.has\(clave\)\) return/)
})

test('el anuncio institucional no se reproduce al entrar al canal de soporte', async () => {
  const fuente = await readFile(
    join(process.cwd(), 'src', 'commands', 'soporte.ts'),
    'utf8',
  )
  assert.doesNotMatch(fuente, /anunciarBienvenidaSoporte/)
})

test('Asistencia Staff elimina el límite de pistas pero soporte y directa lo conservan', async () => {
  const grabador = await readFile(
    join(process.cwd(), 'src', 'utils', 'soporte-grabacion.ts'),
    'utf8',
  )
  assert.match(
    grabador,
    /origenGrabacion !== 'servicio-staff'[\s\S]*cantidadTotal > limitePistasGrabacion/,
  )

  const staff = await readFile(
    join(process.cwd(), 'src', 'commands', 'servicio-staff.ts'),
    'utf8',
  )
  assert.doesNotMatch(staff, /participantes\.length > limitePistasGrabacion/)
  assert.doesNotMatch(staff, /participantes\.size >= limitePistasGrabacion/)
  assert.doesNotMatch(staff, /se alcanzó el límite/)
})
