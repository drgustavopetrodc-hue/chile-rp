// RUT ficticio para el roleplay (cuerpo aleatorio + dígito verificador módulo 11).

export function calcularDv(cuerpo: number): string {
  let suma = 0
  let mult = 2
  for (const d of String(cuerpo).split('').reverse()) {
    suma += Number(d) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const r = 11 - (suma % 11)
  if (r === 11) return '0'
  if (r === 10) return 'K'
  return String(r)
}

export function generarRut(): string {
  const cuerpo = 18_000_000 + Math.floor(Math.random() * 8_000_000)
  const conPuntos = cuerpo.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${conPuntos}-${calcularDv(cuerpo)}`
}

export function generarNumeroSerie(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000))
}
