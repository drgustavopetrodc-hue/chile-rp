// Convierte "DD/MM/AAAA" en Date (UTC). Devuelve null si no es válida.
export function parsearFecha(texto: string): Date | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  const valida =
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  return valida ? fecha : null
}

export function edadEn(fecha: Date, hoy = new Date()): number {
  let edad = hoy.getUTCFullYear() - fecha.getUTCFullYear()
  const cumple =
    hoy.getUTCMonth() > fecha.getUTCMonth() ||
    (hoy.getUTCMonth() === fecha.getUTCMonth() && hoy.getUTCDate() >= fecha.getUTCDate())
  if (!cumple) edad--
  return edad
}

export const formatearFecha = (f: Date) =>
  f.toLocaleDateString('es-CL', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
