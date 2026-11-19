import { randomInt } from 'node:crypto'

const CUERPO_RUT_MINIMO = 18_000_000
const CUERPO_RUT_MAXIMO_EXCLUSIVO = 26_000_000
const SERIE_MINIMO = 100_000_000
const SERIE_MAXIMO_EXCLUSIVO = 1_000_000_000

export function calcularDv(cuerpo: number): string {
  if (!Number.isSafeInteger(cuerpo) || cuerpo < 0) {
    throw new RangeError('El cuerpo del RUT debe ser un entero no negativo.')
  }
  let suma = 0
  let multiplicador = 2
  for (const digito of String(cuerpo).split('').reverse()) {
    suma += Number(digito) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }
  const resultado = 11 - (suma % 11)
  if (resultado === 11) return '0'
  if (resultado === 10) return 'K'
  return String(resultado)
}

export function generarRut(): string {
  const cuerpo = randomInt(CUERPO_RUT_MINIMO, CUERPO_RUT_MAXIMO_EXCLUSIVO)
  const cuerpoFormateado = String(cuerpo).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cuerpoFormateado}-${calcularDv(cuerpo)}`
}

export function generarNumeroSerie(): string {
  return String(randomInt(SERIE_MINIMO, SERIE_MAXIMO_EXCLUSIVO))
}
