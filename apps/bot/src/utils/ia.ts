import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'

// Orden de prueba: Groq → Gemini → OpenRouter. Si uno falla o agota su cupo, pasa al siguiente.
// Todos usan el formato "OpenAI Chat Completions", así que agregar otro proveedor es agregar una línea.

export class IAError extends Error {
  constructor(message: string, readonly proveedores?: EstadoProveedor[]) {
    super(message)
    this.name = 'IAError'
  }
}

interface PaginaNormativa {
  numero: number
  texto: string
  frecuencias: Map<string, number>
}

const palabrasComunes = new Set([
  'a', 'al', 'algo', 'algunos', 'ante', 'como', 'con', 'cual', 'cuando', 'de', 'del', 'desde', 'donde',
  'durante', 'e', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esta',
  'este', 'esto', 'fue', 'ha', 'hace', 'hacia', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'me', 'mi',
  'mis', 'más', 'muy', 'no', 'o', 'para', 'pero', 'por', 'que', 'se', 'sin', 'sobre', 'su', 'sus', 'también',
  'te', 'tiene', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'ya', 'normativa', 'regla', 'reglas',
])

function palabras(texto: string) {
  return texto
    .toLocaleLowerCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[\p{L}\p{N}]{2,}/gu) ?? []
}

let normativaCache: Promise<PaginaNormativa[]> | undefined

async function cargarPaginasNormativa(): Promise<PaginaNormativa[]> {
  if (!normativaCache) {
    normativaCache = (async () => {
      const parser = new PDFParse({
        data: await readFile(new URL('../../../../Normativa General Chile.pdf', import.meta.url)),
      })
      try {
        const paginas = (await parser.getText()).pages
          .map(({ num, text }) => ({ numero: num, texto: text.trim() }))
          .filter(({ texto }) => texto.length > 0)
        if (!paginas.length) throw new IAError('Normativa General Chile.pdf no contiene texto legible')
        return paginas.map((pagina) => ({
          ...pagina,
          frecuencias: palabras(pagina.texto).reduce((frecuencias, palabra) => {
            frecuencias.set(palabra, (frecuencias.get(palabra) ?? 0) + 1)
            return frecuencias
          }, new Map<string, number>()),
        }))
      } finally {
        await parser.destroy()
      }
    })().catch((err: unknown) => {
      normativaCache = undefined
      throw err
    })
  }
  return normativaCache
}

export async function extraerNormativaRelevante(consulta: string, maxCaracteres = 4500): Promise<string> {
  const paginas = await cargarPaginasNormativa()
  const terminos = [...new Set(palabras(consulta).filter((palabra) => !palabrasComunes.has(palabra)))]
  if (!terminos.length) return ''

  const puntajes = paginas.map((pagina) => {
    let puntaje = 0
    for (const termino of terminos) {
      const frecuencia = pagina.frecuencias.get(termino) ?? 0
      if (!frecuencia) continue
      const documentos = paginas.filter((otra) => otra.frecuencias.has(termino)).length
      const idf = Math.log(1 + (paginas.length - documentos + 0.5) / (documentos + 0.5))
      puntaje += idf * (1 + Math.log(frecuencia))
    }
    return { pagina, puntaje }
  }).filter(({ puntaje }) => puntaje > 0).sort((a, b) => b.puntaje - a.puntaje)

  let restante = maxCaracteres
  const extractos: string[] = []
  for (const { pagina } of puntajes) {
    if (restante <= 0) break
    const encabezado = `${extractos.length ? '\n\n' : ''}Página ${pagina.numero}:\n`
    const texto = pagina.texto.slice(0, Math.max(0, restante - encabezado.length))
    if (!texto) continue
    extractos.push(`${encabezado}${texto}`)
    restante -= encabezado.length + texto.length
  }
  return extractos.reverse().join('')
}

export interface ProveedorConfigurado {
  nombre: string
  modelo: string
}

type TipoProveedor = 'groq' | 'gemini' | 'openrouter'

interface ProveedorInterno extends ProveedorConfigurado {
  tipo: TipoProveedor
  base: string
  clave: string
}

export interface MensajeConversacionIA {
  role: 'user' | 'assistant'
  content: string
}

export type EstadoDisponibilidad = 'sin_comprobar' | 'disponible' | 'degradado' | 'no_disponible'

export interface EstadoProveedor extends ProveedorConfigurado {
  estado: EstadoDisponibilidad
  latenciaMs?: number
  ultimoError?: string
  codigoHttp?: number
  comprobadoEn?: string
}

export interface UltimoProveedorUsado {
  proveedor: string
  modelo: string
  latenciaMs: number
  fecha: string
}

function obtenerProveedoresConfigurados(): ProveedorInterno[] {
  const lista: ProveedorInterno[] = []
  const e = process.env
  if (e.GROQ_API_KEY) {
    lista.push({
      nombre: 'Groq',
      tipo: 'groq',
      base: e.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      clave: e.GROQ_API_KEY,
      modelo: e.GROQ_MODEL || 'openai/gpt-oss-120b',
    })
  }
  if (e.GEMINI_API_KEY) {
    lista.push({
      nombre: 'Gemini',
      tipo: 'gemini',
      base: e.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      clave: e.GEMINI_API_KEY,
      modelo: e.GEMINI_MODEL || 'gemini-flash-latest',
    })
  }
  if (e.OPENROUTER_API_KEY) {
    lista.push({
      nombre: 'OpenRouter',
      tipo: 'openrouter',
      base: e.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      clave: e.OPENROUTER_API_KEY,
      modelo: e.OPENROUTER_MODEL || 'inclusionai/ling-3.2-flash:free',
    })
  }
  return lista
}

export function proveedoresConfigurados(): ProveedorConfigurado[] {
  return obtenerProveedoresConfigurados().map(({ nombre, modelo }) => ({ nombre, modelo }))
}

export interface Peticion {
  sistema: string
  usuario: string
  maxTokens?: number
  temperatura?: number
  historial?: MensajeConversacionIA[]
  usuarioId?: string
  cuotaReservada?: boolean
  razonamiento?: 'low' | 'medium' | 'high'
}

export interface ResultadoIA {
  texto: string
  proveedor: string
  modelo: string
  latenciaMs: number
  finishReason: string | null
}

interface RespuestaCompletado {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: unknown; tool_calls?: unknown[] }
  }>
}

class ErrorProveedor extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

const estadosProveedor = new Map<string, EstadoProveedor>()
const solicitudesEnCurso = new Map<string, Promise<ResultadoIA>>()
let ultimoProveedorUsado: UltimoProveedorUsado | undefined
const MAX_INTENTOS_PROVEEDOR = 2
const TIMEOUT_POR_INTENTO_MS = 12_000
const TIMEOUT_TOTAL_MS = 45_000
const LIMITE_CONCURRENCIA = 4
const LIMITE_ESPERA = 20
let solicitudesActivas = 0
const colaSolicitudes: Array<() => void> = []

async function conLimiteDeConcurrencia<T>(operacion: () => Promise<T>): Promise<T> {
  if (solicitudesActivas >= LIMITE_CONCURRENCIA) {
    if (colaSolicitudes.length >= LIMITE_ESPERA) {
      throw new IAError('La IA está ocupada; inténtalo nuevamente en unos minutos.')
    }
    await new Promise<void>((resolver) => colaSolicitudes.push(resolver))
  } else {
    solicitudesActivas++
  }

  try {
    return await operacion()
  } finally {
    const siguiente = colaSolicitudes.shift()
    if (siguiente) siguiente()
    else solicitudesActivas--
  }
}

function claveEstado(prov: ProveedorConfigurado) {
  return `${prov.nombre}:${prov.modelo}`
}

function registrarEstado(
  prov: ProveedorConfigurado,
  estado: Omit<EstadoProveedor, 'nombre' | 'modelo'> & { modelo?: string },
) {
  const { modelo, ...resto } = estado
  estadosProveedor.set(claveEstado(prov), {
    nombre: prov.nombre,
    modelo: modelo ?? prov.modelo,
    ...resto,
  })
}

export function obtenerEstadoProveedores(): EstadoProveedor[] {
  return obtenerProveedoresConfigurados().map((prov) =>
    estadosProveedor.get(claveEstado(prov)) ?? {
      nombre: prov.nombre,
      modelo: prov.modelo,
      estado: 'sin_comprobar',
    },
  )
}

export function obtenerUltimoProveedorUsado() {
  return ultimoProveedorUsado
}

function esNivelRazonamiento(valor: string | undefined): valor is 'low' | 'medium' | 'high' {
  return valor === 'low' || valor === 'medium' || valor === 'high'
}

function crearMensajes(p: Peticion) {
  return [
    { role: 'system', content: p.sistema },
    ...(p.historial ?? []).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: p.usuario },
  ]
}

function crearCuerpo(prov: ProveedorInterno, modelo: string, p: Peticion) {
  const maxTokens = Math.max(1, Math.min(32_000, Math.trunc(p.maxTokens ?? 1500)))
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: crearMensajes(p),
    temperature: p.temperatura ?? 0.4,
  }

  if (prov.tipo === 'groq') {
    cuerpo.max_completion_tokens = maxTokens
    if (/^openai\/gpt-oss-(?:20b|120b)$/i.test(modelo)) {
      const esfuerzo = p.razonamiento ?? (esNivelRazonamiento(process.env.GROQ_REASONING_EFFORT)
        ? process.env.GROQ_REASONING_EFFORT
        : 'medium')
      cuerpo.reasoning_effort = esfuerzo
      cuerpo.reasoning_format = 'hidden'
    }
  } else {
    cuerpo.max_tokens = maxTokens
    if (prov.tipo === 'gemini' && /^gemini-(?:3|4)(?:[.-]|$)/i.test(modelo)) {
      const esfuerzo = p.razonamiento ?? (esNivelRazonamiento(process.env.GEMINI_REASONING_EFFORT)
        ? process.env.GEMINI_REASONING_EFFORT
        : undefined)
      if (esfuerzo) cuerpo.reasoning_effort = esfuerzo
    }
  }

  return cuerpo
}

function extraerTexto(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido.trim()
  if (!Array.isArray(contenido)) return ''
  return contenido
    .map((parte) => {
      if (!parte || typeof parte !== 'object') return ''
      const texto = (parte as { text?: unknown }).text
      return typeof texto === 'string' ? texto : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function obtenerRetryAfter(respuesta: Response): number | undefined {
  const valor = respuesta.headers.get('retry-after')
  if (!valor) return undefined
  const segundos = Number(valor)
  const milisegundos = Number.isFinite(segundos)
    ? segundos * 1000
    : Date.parse(valor) - Date.now()
  return Number.isFinite(milisegundos) && milisegundos > 0
    ? Math.min(milisegundos, 10_000)
    : undefined
}

async function detalleErrorHttp(respuesta: Response): Promise<string> {
  const cuerpo = await respuesta.text().catch(() => '')
  if (!cuerpo) return ''

  try {
    const datos: unknown = JSON.parse(cuerpo)
    if (!datos || typeof datos !== 'object') return ''
    const error = (datos as { error?: unknown }).error
    if (!error || typeof error !== 'object') return ''
    const campos = error as { code?: unknown; type?: unknown; message?: unknown }
    return [campos.code, campos.type, campos.message]
      .filter((campo): campo is string => typeof campo === 'string')
      .join(': ')
      .replace(/(api[\s_-]?key|token|authorization)\s*[:=]\s*\S+/gi, '$1=[redactado]')
      .replace(/\s+/g, ' ')
      .slice(0, 160)
  } catch {
    return ''
  }
}

function convertirErrorProveedor(error: unknown): ErrorProveedor {
  if (error instanceof ErrorProveedor) return error
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new ErrorProveedor('tiempo de espera agotado', 'timeout', true)
  }
  return new ErrorProveedor(
    error instanceof Error ? error.message.slice(0, 160) : 'fallo de red',
    'network',
    true,
  )
}

async function consultarUnaVez(
  prov: ProveedorInterno,
  modelo: string,
  p: Peticion,
  deadline: number,
): Promise<{ texto: string; finishReason: string | null }> {
  const restante = deadline - Date.now()
  if (restante <= 0) throw new ErrorProveedor('se agotó el tiempo total de consulta', 'deadline', true)

  return conLimiteDeConcurrencia(async () => {
    try {
      const respuesta = await fetch(`${prov.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prov.clave}` },
        body: JSON.stringify(crearCuerpo(prov, modelo, p)),
        signal: AbortSignal.timeout(Math.min(TIMEOUT_POR_INTENTO_MS, restante)),
      })
      if (!respuesta.ok) {
        const status = respuesta.status
        const temporal = status === 408 || status === 429 || [500, 502, 503, 504].includes(status)
        const detalle = await detalleErrorHttp(respuesta)
        throw new ErrorProveedor(
          `respuesta HTTP ${status}${detalle ? `: ${detalle}` : ''}`,
          `http_${status}`,
          temporal,
          status,
          obtenerRetryAfter(respuesta),
        )
      }

      let datos: RespuestaCompletado
      try {
        datos = (await respuesta.json()) as RespuestaCompletado
      } catch {
        throw new ErrorProveedor('la respuesta no contiene JSON válido', 'invalid_json', true)
      }

      const opcion = datos.choices?.[0]
      const finishReason = opcion?.finish_reason ?? null
      if (opcion?.message?.tool_calls?.length || finishReason === 'tool_calls' || finishReason === 'function_call') {
        throw new ErrorProveedor(
          'el modelo solicitó herramientas que esta integración no ejecuta',
          'unsupported_tool_call',
          false,
        )
      }
      const texto = extraerTexto(opcion?.message?.content)
      if (!texto && finishReason === 'content_filter') {
        throw new ErrorProveedor('la respuesta fue bloqueada por el filtro del proveedor', 'content_filtered', false)
      }
      if (!texto) throw new ErrorProveedor('la respuesta no contiene texto final', 'empty_response', true)
      return { texto, finishReason }
    } catch (err) {
      throw convertirErrorProveedor(err)
    }
  })
}

async function consultarConReintentos(
  prov: ProveedorInterno,
  modelo: string,
  p: Peticion,
  deadline: number,
): Promise<{ texto: string; finishReason: string | null; latenciaMs: number }> {
  const inicio = Date.now()
  let ultimoError: ErrorProveedor | undefined

  for (let intento = 0; intento < MAX_INTENTOS_PROVEEDOR; intento++) {
    try {
      const resultado = await consultarUnaVez(prov, modelo, p, deadline)
      return { ...resultado, latenciaMs: Date.now() - inicio }
    } catch (error) {
      ultimoError = convertirErrorProveedor(error)
      if (!ultimoError.retryable || intento + 1 >= MAX_INTENTOS_PROVEEDOR) break

      const backoff = Math.min(3000, 400 * 2 ** intento)
      const jitter = Math.floor(backoff * (0.5 + Math.random()))
      const espera = Math.max(jitter, ultimoError.retryAfterMs ?? 0)
      if (deadline - Date.now() <= espera) break
      console.warn(`[IA] ${prov.nombre} ${ultimoError.codigo}; reintentando una vez`)
      await new Promise((resolver) => setTimeout(resolver, espera))
    }
  }

  throw ultimoError ?? new ErrorProveedor('fallo desconocido', 'unknown', false)
}

async function generarConProveedor(
  prov: ProveedorInterno,
  p: Peticion,
  deadline: number,
): Promise<ResultadoIA> {
  const modeloAlternativo = prov.tipo === 'groq'
    ? process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile'
    : undefined
  const inicio = Date.now()

  try {
    let resultado: Awaited<ReturnType<typeof consultarConReintentos>>
    let modelo = prov.modelo
    try {
      resultado = await consultarConReintentos(prov, modelo, p, deadline)
    } catch (error) {
      const fallo = convertirErrorProveedor(error)
      if (fallo.status !== 404 || !modeloAlternativo || modeloAlternativo === prov.modelo) throw fallo
      console.warn(`[IA] ${prov.nombre} no ofrece ${prov.modelo}; probando el modelo alternativo configurado`)
      modelo = modeloAlternativo
      resultado = await consultarConReintentos(prov, modelo, p, deadline)
    }

    const latenciaMs = Date.now() - inicio
    registrarEstado(prov, {
      estado: 'disponible',
      modelo,
      latenciaMs,
      comprobadoEn: new Date().toISOString(),
    })
    return {
      texto: resultado.texto,
      proveedor: prov.nombre,
      modelo,
      latenciaMs,
      finishReason: resultado.finishReason,
    }
  } catch (error) {
    const fallo = convertirErrorProveedor(error)
    const latenciaMs = Date.now() - inicio
    const mensaje = `${fallo.codigo}${fallo.status ? ` (HTTP ${fallo.status})` : ''}`
    registrarEstado(prov, {
      estado: fallo.retryable ? 'degradado' : 'no_disponible',
      latenciaMs,
      ultimoError: mensaje,
      codigoHttp: fallo.status,
      comprobadoEn: new Date().toISOString(),
    })
    console.warn(`[IA] ${prov.nombre} falló: ${mensaje}; ${fallo.message.slice(0, 120)}`)
    throw fallo
  }
}

async function generarSinDeduplicar(p: Peticion): Promise<ResultadoIA> {
  const lista = obtenerProveedoresConfigurados()
  if (!lista.length) throw new IAError('No hay proveedores de IA configurados')

  const deadline = Date.now() + TIMEOUT_TOTAL_MS
  const fallos: string[] = []
  for (const prov of lista) {
    try {
      const resultado = await generarConProveedor(prov, p, deadline)
      ultimoProveedorUsado = {
        proveedor: resultado.proveedor,
        modelo: resultado.modelo,
        latenciaMs: resultado.latenciaMs,
        fecha: new Date().toISOString(),
      }
      return resultado
    } catch (error) {
      const fallo = convertirErrorProveedor(error)
      if (fallo.codigo === 'content_filtered') {
        throw new IAError('El proveedor bloqueó la respuesta por sus filtros de seguridad.', obtenerEstadoProveedores())
      }
      fallos.push(`${prov.nombre}: ${fallo.codigo}`)
    }
  }
  const estados = obtenerEstadoProveedores()
  throw new IAError(
    `Todos los proveedores de IA fallaron o agotaron su cupo (${fallos.join('; ')})`,
    estados,
  )
}

export async function generar(p: Peticion): Promise<ResultadoIA> {
  const usuarioId = p.usuarioId
  const reservaAutomatica = !!usuarioId && !p.cuotaReservada
  if (reservaAutomatica && usuarioId) {
    const reserva = reservarUso(usuarioId, false)
    if (!reserva.ok) throw new IAError(reserva.motivo)
  }

  const clave = createHash('sha256')
    .update(JSON.stringify([p.usuarioId ?? '', p.sistema, p.historial ?? [], p.usuario, p.maxTokens, p.temperatura]))
    .digest('hex')
  const solicitudExistente = solicitudesEnCurso.get(clave)
  try {
    if (solicitudExistente) return await solicitudExistente
    const solicitud = generarSinDeduplicar(p)
    solicitudesEnCurso.set(clave, solicitud)
    try {
      return await solicitud
    } finally {
      if (solicitudesEnCurso.get(clave) === solicitud) solicitudesEnCurso.delete(clave)
    }
  } catch (error) {
    if (reservaAutomatica && usuarioId) devolverUso(usuarioId, false)
    throw error
  }
}

export async function probarProveedores(): Promise<EstadoProveedor[]> {
  const lista = obtenerProveedoresConfigurados()
  if (!lista.length) return []
  const peticion: Peticion = {
    sistema: 'Responde únicamente con la palabra OK.',
    usuario: 'ping',
    maxTokens: 50,
    temperatura: 0,
  }
  const deadline = Date.now() + TIMEOUT_TOTAL_MS
  await Promise.all(lista.map(async (prov) => {
    try {
      await generarConProveedor(prov, peticion, deadline)
    } catch {
      // generarConProveedor registra y reporta cada fallo antes de propagarlo.
    }
  }))
  return obtenerEstadoProveedores()
}

// ───────────── Contador de uso (se reinicia cada día, hora de Chile) ─────────────

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

let dia = hoy()
let usoGlobal = 0
const usoPorUsuario = new Map<string, number>()
const LIMITE_USUARIO_DIA = 20
const LIMITE_GLOBAL_DIA = 500

export type Reserva = { ok: true } | { ok: false; motivo: string }

export function reservarUso(usuarioId: string, exento: boolean): Reserva {
  const d = hoy()
  if (d !== dia) {
    dia = d
    usoGlobal = 0
    usoPorUsuario.clear()
  }
  if (usoGlobal >= LIMITE_GLOBAL_DIA) {
    return { ok: false, motivo: 'La IA alcanzó el límite diario del servidor. Inténtalo mañana o consulta al staff.' }
  }
  const usoUsuario = usoPorUsuario.get(usuarioId) ?? 0
  if (!exento && usoUsuario >= LIMITE_USUARIO_DIA) {
    return { ok: false, motivo: `Alcanzaste el límite de ${LIMITE_USUARIO_DIA} consultas de IA por día.` }
  }
  usoGlobal++
  if (!exento) usoPorUsuario.set(usuarioId, usoUsuario + 1)
  return { ok: true }
}

export function devolverUso(usuarioId: string, exento: boolean) {
  if (usoGlobal > 0) usoGlobal--
  if (exento) return
  const usoUsuario = usoPorUsuario.get(usuarioId) ?? 0
  if (usoUsuario <= 1) usoPorUsuario.delete(usuarioId)
  else usoPorUsuario.set(usuarioId, usoUsuario - 1)
}

export const usoDeHoy = () => ({
  dia,
  global: usoGlobal,
  limiteGlobal: LIMITE_GLOBAL_DIA,
  limiteUsuario: LIMITE_USUARIO_DIA,
})

export function filtroMemoriaIA(guildId: string, channelId: string, usuarioId: string) {
  const hash = (valor: string) => createHash('sha256').update(valor).digest('hex')
  return {
    guildId: hash(`guild:${guildId}`),
    channelId: hash(`channel:${channelId}`),
    usuarioId: hash(`user:${usuarioId}`),
  }
}

export function limitarHistorialIA(
  historial: MensajeConversacionIA[],
  maxCaracteres = 6000,
): MensajeConversacionIA[] {
  const turnos: MensajeConversacionIA[][] = []
  let restantes = maxCaracteres
  for (let indice = historial.length - 2; indice >= 0; indice -= 2) {
    const turno = historial.slice(indice, indice + 2)
    if (turno.length !== 2 || turno[0]?.role !== 'user' || turno[1]?.role !== 'assistant') continue
    const tamanio = turno[0].content.length + turno[1].content.length
    if (tamanio > restantes) break
    turnos.push(turno)
    restantes -= tamanio
  }
  return turnos.reverse().flat()
}

// ───────────── Seguridad de la salida ─────────────

// Evita que la IA mencione @everyone/@here o a personas/roles, y respeta el máximo de texto de Discord.
export function limpiarSalida(texto: string, maximo = 3000): string {
  const limpio = texto
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/<@[!&]?\d+>/g, '[mención]')
    .trim()
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio
}
