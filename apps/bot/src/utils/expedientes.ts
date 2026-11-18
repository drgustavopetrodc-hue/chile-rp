export type EstadoExpedienteAdministrativo =
  | 'RECIBIDO'
  | 'EN_REVISION'
  | 'EN_TRAMITACION'
  | 'RESUELTO'
  | 'ARCHIVADO'

const transicionesPermitidas: Record<EstadoExpedienteAdministrativo, readonly EstadoExpedienteAdministrativo[]> = {
  RECIBIDO: ['EN_REVISION', 'ARCHIVADO'],
  EN_REVISION: ['EN_TRAMITACION', 'ARCHIVADO'],
  EN_TRAMITACION: ['EN_REVISION', 'ARCHIVADO'],
  RESUELTO: ['EN_REVISION'],
  ARCHIVADO: [],
}

export function puedeCambiarEstadoExpediente(
  actual: EstadoExpedienteAdministrativo,
  siguiente: EstadoExpedienteAdministrativo,
) {
  return transicionesPermitidas[actual].includes(siguiente)
}

export function alcanceAutoridadAdministrativa(institucionId?: string | null) {
  return institucionId ? `INSTITUCION:${institucionId}` : 'GENERAL'
}

export function alcancesAutoridadExpediente(institucionId?: string | null) {
  return [...new Set([alcanceAutoridadAdministrativa(institucionId), 'GENERAL'])]
}

export function anioEnChile(fecha: Date) {
  const anio = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Santiago',
    year: 'numeric',
  }).format(fecha)
  return Number(anio)
}

export function formatearFolioAdministrativo(anio: number, secuencia: number) {
  if (!Number.isInteger(anio) || anio < 1 || anio > 9999) {
    throw new RangeError('El año del folio no es válido.')
  }
  if (!Number.isSafeInteger(secuencia) || secuencia < 1) {
    throw new RangeError('La secuencia del folio no es válida.')
  }
  return `ADM-${String(anio).padStart(4, '0')}-${String(secuencia).padStart(5, '0')}`
}
