import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'

// Cliente de IA con proveedores gratuitos y control de uso.
// Orden de prueba: Gemini → Groq → OpenRouter. Si uno falla o agota su cupo, pasa al siguiente.
// Todos usan el formato "OpenAI Chat Completions", así que agregar otro proveedor es agregar una línea.

export class IAError extends Error {}

let normativaCache: Promise<string> | undefined

export function cargarNormativa(): Promise<string> {
  if (!normativaCache) {
    normativaCache = (async () => {
      const parser = new PDFParse({
        data: await readFile(new URL('../../../../Normativa General Chile.pdf', import.meta.url)),
      })
      try {
        const texto = (await parser.getText()).text.trim()
        if (!texto) throw new IAError('Normativa General Chile.pdf no contiene texto legible')
        return texto
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
      modelo: e.GROQ_MODEL || 'llama-3.3-70b-versatile',
    })
  }
  if (e.OPENROUTER_API_KEY) {
    lista.push({
      nombre: 'OpenRouter',
      base: e.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      clave: e.OPENROUTER_API_KEY,
      modelo: e.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
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

// ───────────── Límites de uso (se reinician cada día, hora de Chile) ─────────────

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

let dia = hoy()
let usoGlobal = 0
const usoPorUsuario = new Map<string, number>()
const ultimoUso = new Map<string, number>()

const numeroEnv = (clave: string, defecto: number) => {
  const n = Number(process.env[clave])
  return Number.isFinite(n) && n >= 0 && process.env[clave] !== '' && process.env[clave] !== undefined ? n : defecto
}

export const limites = () => ({
  global: numeroEnv('IA_LIMITE_GLOBAL_DIARIO', 400),
  usuario: numeroEnv('IA_LIMITE_USUARIO_DIARIO', 15),
  cooldownSegundos: numeroEnv('IA_COOLDOWN_SEGUNDOS', 15),
})

export type Reserva = { ok: true } | { ok: false; motivo: string }

// `exento` (staff) se salta el límite y la espera por usuario, pero igual cuenta en el límite global.
export function reservarUso(usuarioId: string, exento: boolean): Reserva {
  const d = hoy()
  if (d !== dia) {
    dia = d
    usoGlobal = 0
    usoPorUsuario.clear()
    ultimoUso.clear()
  }
  const lim = limites()
  if (usoGlobal >= lim.global) {
    return { ok: false, motivo: 'La IA alcanzó su límite de uso de hoy. Vuelve a intentarlo mañana.' }
  }
  if (!exento) {
    const restante = (ultimoUso.get(usuarioId) ?? 0) + lim.cooldownSegundos * 1000 - Date.now()
    if (restante > 0) {
      return { ok: false, motivo: `Espera ${Math.ceil(restante / 1000)} segundos antes de volver a usar la IA.` }
    }
    const usados = usoPorUsuario.get(usuarioId) ?? 0
    if (usados >= lim.usuario) {
      return { ok: false, motivo: `Alcanzaste tu límite de ${lim.usuario} usos de IA por hoy.` }
    }
    usoPorUsuario.set(usuarioId, usados + 1)
    ultimoUso.set(usuarioId, Date.now())
  }
  usoGlobal++
  return { ok: true }
}

// Si la IA falló, no se descuenta el uso al jugador.
export function devolverUso(usuarioId: string, exento: boolean) {
  if (usoGlobal > 0) usoGlobal--
  if (!exento) {
    usoPorUsuario.set(usuarioId, Math.max(0, (usoPorUsuario.get(usuarioId) ?? 1) - 1))
    ultimoUso.delete(usuarioId)
  }
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
