import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'

// Cliente de IA con proveedores gratuitos y control de uso.
// Orden de prueba: Gemini → Groq → OpenRouter. Si uno falla o agota su cupo, pasa al siguiente.
// Todos usan el formato "OpenAI Chat Completions", así que agregar otro proveedor es agregar una línea.

export class IAError extends Error {}

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

interface Proveedor {
  nombre: string
  base: string
  clave: string
  modelo: string
}

export function proveedoresConfigurados(): Proveedor[] {
  const lista: Proveedor[] = []
  const e = process.env
  if (e.GEMINI_API_KEY) {
    lista.push({
      nombre: 'Gemini',
      base: e.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      clave: e.GEMINI_API_KEY,
      modelo: e.GEMINI_MODEL || 'gemini-flash-latest',
    })
  }
  if (e.GROQ_API_KEY) {
    lista.push({
      nombre: 'Groq',
      base: e.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      clave: e.GROQ_API_KEY,
      modelo: e.GROQ_MODEL || 'openai/gpt-oss-120b',
    })
  }
  if (e.OPENROUTER_API_KEY) {
    lista.push({
      nombre: 'OpenRouter',
      base: e.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      clave: e.OPENROUTER_API_KEY,
      modelo: e.OPENROUTER_MODEL || 'inclusionai/ling-3.2-flash:free',
    })
  }
  return lista
}

export interface Peticion {
  sistema: string
  usuario: string
  maxTokens?: number
  temperatura?: number
}

export async function generar(p: Peticion): Promise<{ texto: string; proveedor: string; modelo: string }> {
  const lista = proveedoresConfigurados()
  if (!lista.length) throw new IAError('No hay proveedores de IA configurados')

  for (const prov of lista) {
    try {
      const respuesta = await fetch(`${prov.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prov.clave}` },
        body: JSON.stringify({
          model: prov.modelo,
          messages: [
            { role: 'system', content: p.sistema },
            { role: 'user', content: p.usuario },
          ],
          max_tokens: p.maxTokens ?? 1500,
          temperature: p.temperatura ?? 0.4,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!respuesta.ok) {
        // Nunca se registra la clave, solo el estado y un fragmento del error.
        const detalle = (await respuesta.text().catch(() => '')).slice(0, 200)
        console.warn(`[IA] ${prov.nombre} respondió ${respuesta.status}: ${detalle}`)
        continue
      }
      const datos = (await respuesta.json()) as { choices?: { message?: { content?: string | null } }[] }
      const texto = datos.choices?.[0]?.message?.content?.trim()
      if (texto) return { texto, proveedor: prov.nombre, modelo: prov.modelo }
      console.warn(`[IA] ${prov.nombre} devolvió una respuesta vacía`)
    } catch (err) {
      console.warn(`[IA] ${prov.nombre} falló:`, err instanceof Error ? err.message : err)
    }
  }
  throw new IAError('Todos los proveedores de IA fallaron o agotaron su cupo')
}

// ───────────── Contador de uso (se reinicia cada día, hora de Chile) ─────────────

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

let dia = hoy()
let usoGlobal = 0

export type Reserva = { ok: true } | { ok: false; motivo: string }

export function reservarUso(_usuarioId: string, _exento: boolean): Reserva {
  const d = hoy()
  if (d !== dia) {
    dia = d
    usoGlobal = 0
  }
  usoGlobal++
  return { ok: true }
}

export function devolverUso(_usuarioId: string, _exento: boolean) {
  if (usoGlobal > 0) usoGlobal--
}

export const usoDeHoy = () => ({ dia, global: usoGlobal })

// ───────────── Seguridad de la salida ─────────────

// Evita que la IA mencione @everyone/@here o a personas/roles, y respeta el máximo de texto de Discord.
export function limpiarSalida(texto: string, maximo = 3000): string {
  const limpio = texto
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/<@[!&]?\d+>/g, '[mención]')
    .trim()
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio
}
