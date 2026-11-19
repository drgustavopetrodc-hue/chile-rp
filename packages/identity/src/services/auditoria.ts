import { ErrorValidacionIdentidad } from '../types.js'
import type { EventoAuditoriaIdentidad, OperacionesIdentidad } from '../types.js'

export async function registrarAuditoriaIdentidad(
  destino: Pick<OperacionesIdentidad, 'registrarAuditoria'>,
  evento: EventoAuditoriaIdentidad,
) {
  if (!evento.actorId.trim() || !evento.accion.trim() || !evento.entidad.trim() || !evento.entidadId.trim()) {
    throw new ErrorValidacionIdentidad('Los datos de auditoría de identidad están incompletos.')
  }
  return destino.registrarAuditoria(evento)
}
