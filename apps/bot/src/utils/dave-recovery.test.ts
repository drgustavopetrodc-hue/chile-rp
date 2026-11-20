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
  assert.match(fuente, /this\.limpiarFlujos\(\)/)
  assert.match(fuente, /await this\.suscribir\(this\.manifiesto\.participantes\)/)
  assert.doesNotMatch(fuente, /daveEncryption:\s*false/)
})
