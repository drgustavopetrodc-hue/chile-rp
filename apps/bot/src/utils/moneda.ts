export function formatearMoneda(monto: bigint | number) {
  const simbolo = process.env.MONEDA_SIMBOLO ?? '$'
  return `${simbolo}${monto.toLocaleString('es-CL')}`
}