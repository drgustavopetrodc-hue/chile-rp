import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  devolverUso,
  filtroMemoriaIA,
  generar,
  IAError,
  limitarHistorialIA,
  reservarUso,
  type Peticion,
} from './ia'

const nombresVariables = [
  'GROQ_API_KEY',
  'GROQ_BASE_URL',
  'GROQ_MODEL',
  'GROQ_FALLBACK_MODEL',
  'GROQ_REASONING_EFFORT',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_REASONING_EFFORT',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_MODEL',
] as const

function restaurarEntorno(t: TestContext) {
  const entornoAnterior = new Map(nombresVariables.map((nombre) => [nombre, process.env[nombre]]))
  const fetchAnterior = globalThis.fetch
  for (const nombre of nombresVariables) delete process.env[nombre]
  t.after(() => {
    for (const nombre of nombresVariables) {
      const valor = entornoAnterior.get(nombre)
      if (valor === undefined) delete process.env[nombre]
      else process.env[nombre] = valor
    }
    globalThis.fetch = fetchAnterior
  })
}

function respuesta(texto: string, finishReason = 'stop') {
  return new Response(JSON.stringify({
    choices: [{ message: { content: texto }, finish_reason: finishReason }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function errorHttp(status: number) {
  return new Response(JSON.stringify({ error: { message: 'simulado' } }), { status })
}

function peticion(overrides: Partial<Peticion> = {}): Peticion {
  return {
    sistema: 'Responde brevemente.',
    usuario: `prueba-${Math.random()}`,
    maxTokens: 120,
    ...overrides,
  }
}

test('Groq reintenta 503 y usa parámetros compatibles con GPT-OSS', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  const llamadas: Record<string, unknown>[] = []
  let intentos = 0
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    llamadas.push(body)
    intentos++
    return intentos === 1 ? errorHttp(503) : respuesta('respuesta final')
  }

  const resultado = await generar(peticion())

  assert.equal(intentos, 2)
  assert.equal(resultado.texto, 'respuesta final')
  assert.equal(resultado.finishReason, 'stop')
  assert.equal(llamadas[0]?.model, 'openai/gpt-oss-120b')
  assert.equal(llamadas[0]?.max_completion_tokens, 120)
  assert.equal(llamadas[0]?.reasoning_effort, 'medium')
  assert.equal(llamadas[0]?.reasoning_format, 'hidden')
  assert.equal('max_tokens' in llamadas[0]!, false)
})

test('respuesta vacía no se acepta y el fallback entrega una respuesta', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GEMINI_API_KEY = 'test-key'
  const llamadas: string[] = []
  globalThis.fetch = async (url) => {
    const destino = String(url)
    llamadas.push(destino)
    if (destino.includes('groq')) return respuesta('')
    return respuesta('respuesta de Gemini')
  }

  const resultado = await generar(peticion())

  assert.equal(resultado.proveedor, 'Gemini')
  assert.equal(resultado.texto, 'respuesta de Gemini')
  assert.equal(llamadas.filter((url) => url.includes('groq')).length, 2)
  assert.equal(llamadas.filter((url) => url.includes('generativelanguage')).length, 1)
})

test('Groq prueba el modelo alternativo documentado cuando el principal responde 404', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GROQ_MODEL = 'modelo-retirado'
  const modelos: string[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string }
    modelos.push(body.model)
    return modelos.length === 1 ? errorHttp(404) : respuesta('respuesta alternativa')
  }

  const resultado = await generar(peticion())

  assert.deepEqual(modelos, ['modelo-retirado', 'llama-3.3-70b-versatile'])
  assert.equal(resultado.modelo, 'llama-3.3-70b-versatile')
})

test('una respuesta de tool call no se presenta como respuesta y pasa al siguiente proveedor', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GEMINI_API_KEY = 'test-key'
  const llamadas: string[] = []
  globalThis.fetch = async (url) => {
    const destino = String(url)
    llamadas.push(destino)
    if (destino.includes('groq')) {
      return new Response(JSON.stringify({
        choices: [{
          message: { content: null, tool_calls: [{ id: 'tool-1' }] },
          finish_reason: 'tool_calls',
        }],
      }), { status: 200 })
    }
    return respuesta('respuesta de respaldo')
  }

  const resultado = await generar(peticion())

  assert.equal(resultado.proveedor, 'Gemini')
  assert.equal(resultado.texto, 'respuesta de respaldo')
  assert.equal(llamadas.filter((url) => url.includes('groq')).length, 1)
})

test('una respuesta bloqueada no se omite probando otro proveedor', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GEMINI_API_KEY = 'test-key'
  let llamadasGemini = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage')) {
      llamadasGemini++
      return respuesta('no debería llamarse')
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
    }), { status: 200 })
  }

  await assert.rejects(generar(peticion()), IAError)
  assert.equal(llamadasGemini, 0)
})

test('errores permanentes omiten reintentos y errores temporales reintentan antes del fallback', async (t) => {
  restaurarEntorno(t)
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.OPENROUTER_API_KEY = 'test-key'

  for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
    let intentosGemini = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('generativelanguage')) {
        intentosGemini++
        return errorHttp(status)
      }
      return respuesta('respuesta de respaldo')
    }
    const resultado = await generar(peticion({ usuario: `http-${status}` }))
    const temporal = status === 429 || [500, 502, 503, 504].includes(status)
    assert.equal(intentosGemini, temporal ? 2 : 1, `HTTP ${status}`)
    assert.equal(resultado.proveedor, 'OpenRouter', `HTTP ${status}`)
  }
})

test('si todos los proveedores fallan se devuelve un error controlado con estados', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.OPENROUTER_API_KEY = 'test-key'
  globalThis.fetch = async (url) => String(url).includes('generativelanguage')
    ? errorHttp(503)
    : errorHttp(401)

  await assert.rejects(generar(peticion()), (error: unknown) => {
    assert.ok(error instanceof IAError)
    assert.match(error.message, /Groq: http_401/)
    assert.match(error.message, /Gemini: http_503/)
    assert.equal(error.proveedores?.length, 3)
    return true
  })
})

test('solicitudes simultáneas idénticas comparten la misma llamada al proveedor', async (t) => {
  restaurarEntorno(t)
  process.env.GROQ_API_KEY = 'test-key'
  let llamadas = 0
  globalThis.fetch = async () => {
    llamadas++
    await new Promise((resolver) => setTimeout(resolver, 20))
    return respuesta('única respuesta')
  }

  const consulta = peticion({ usuario: 'misma consulta', usuarioId: 'usuario-1' })
  const resultados = await Promise.all([generar(consulta), generar(consulta)])

  assert.equal(llamadas, 1)
  assert.equal(resultados[0]?.texto, resultados[1]?.texto)
})

test('la memoria se limita a turnos completos recientes y su filtro separa servidor, canal y usuario', () => {
  const historial = [
    { role: 'user' as const, content: 'pregunta antigua' },
    { role: 'assistant' as const, content: 'respuesta antigua' },
    { role: 'user' as const, content: 'pregunta reciente' },
    { role: 'assistant' as const, content: 'respuesta reciente' },
  ]

  assert.deepEqual(limitarHistorialIA(historial, 40), historial.slice(2))
  const filtro = filtroMemoriaIA('guild-1', 'channel-2', 'user-3')
  assert.notEqual(filtro.guildId, 'guild-1')
  assert.notEqual(filtro.channelId, 'channel-2')
  assert.notEqual(filtro.usuarioId, 'user-3')
  assert.notEqual(filtro.usuarioId, filtroMemoriaIA('guild-1', 'channel-2', 'user-4').usuarioId)
  assert.notEqual(filtro.channelId, filtroMemoriaIA('guild-1', 'channel-3', 'user-3').channelId)
  assert.notEqual(filtro.guildId, filtroMemoriaIA('guild-2', 'channel-2', 'user-3').guildId)
})

test('la cuota limita a un usuario y permite liberar reservas fallidas', async (t) => {
  restaurarEntorno(t)
  const usuario = `cuota-${Date.now()}`
  for (let intento = 0; intento < 20; intento++) assert.equal(reservarUso(usuario, false).ok, true)
  assert.equal(reservarUso(usuario, false).ok, false)
  devolverUso(usuario, false)
  assert.equal(reservarUso(usuario, false).ok, true)
  for (let intento = 0; intento < 20; intento++) devolverUso(usuario, false)
})
