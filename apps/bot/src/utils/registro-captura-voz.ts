const capturasPorCanal = new Map<string, string>()

export function reservarCapturaVoz(canalId: string, capturaId: string): boolean {
  const actual = capturasPorCanal.get(canalId)
  if (actual && actual !== capturaId) return false
  capturasPorCanal.set(canalId, capturaId)
  return true
}

export function liberarCapturaVoz(canalId: string, capturaId: string): void {
  if (capturasPorCanal.get(canalId) === capturaId) capturasPorCanal.delete(canalId)
}

export function capturaVozReservada(canalId: string): boolean {
  return capturasPorCanal.has(canalId)
}
