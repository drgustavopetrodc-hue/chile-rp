import {
  EstadoGrabacionServicioStaff,
  EstadoServicioStaff,
  OrigenGrabacionServicioStaff,
  TipoActividadServicioStaff,
} from '@rp-chile/db'
import { db } from '@rp-chile/db'
import { calcularDuracionMs } from './servicio-staff-modelo'

export {
  calcularDuracionMs,
  construirInformeServicioStaff,
  formatearDuracion,
  parsearIdsDiscord,
} from './servicio-staff-modelo'

export const estadosServicioEnCurso = [
  EstadoServicioStaff.ESPERANDO_VOZ,
  EstadoServicioStaff.ACTIVO,
  EstadoServicioStaff.FINALIZANDO,
] as const

export async function obtenerServicioStaff(id: string) {
  return db.servicioStaff.findUnique({
    where: { id },
    include: {
      actividades: { orderBy: { iniciadoEn: 'asc' } },
      grabaciones: { orderBy: { creadaEn: 'asc' } },
    },
  })
}

export async function obtenerServicioEnCurso(guildId: string, staffDiscordId: string) {
  return db.servicioStaff.findFirst({
    where: {
      guildId,
      staffDiscordId,
      estado: { in: [...estadosServicioEnCurso] },
    },
    include: {
      actividades: { orderBy: { iniciadoEn: 'asc' } },
      grabaciones: { orderBy: { creadaEn: 'asc' } },
    },
    orderBy: { creadoEn: 'desc' },
  })
}

export async function obtenerServiciosEnCurso(guildId: string) {
  return db.servicioStaff.findMany({
    where: { guildId, estado: { in: [...estadosServicioEnCurso] } },
    include: {
      actividades: { orderBy: { iniciadoEn: 'asc' } },
      grabaciones: { orderBy: { creadaEn: 'asc' } },
    },
    orderBy: { creadoEn: 'asc' },
  })
}

export async function crearServicioStaff(datos: {
  guildId: string
  staffDiscordId: string
  staffNombre: string
  canalAsistenciaId: string
  canalAvisoId: string
}) {
  return db.servicioStaff.create({
    data: {
      ...datos,
      claveActivo: datos.staffDiscordId,
      estado: EstadoServicioStaff.ESPERANDO_VOZ,
    },
  })
}

export async function guardarPanelServicioStaff(
  servicioId: string,
  panelCanalId: string,
  panelMensajeId: string,
) {
  return db.servicioStaff.update({
    where: { id: servicioId },
    data: { panelCanalId, panelMensajeId },
  })
}

export async function guardarInformeServicioStaff(
  servicioId: string,
  informeCanalId: string,
  informeMensajeId: string,
) {
  return db.servicioStaff.update({
    where: { id: servicioId },
    data: { informeCanalId, informeMensajeId },
  })
}

export async function activarServicioStaff(servicioId: string, iniciadoEn: Date) {
  return db.servicioStaff.updateMany({
    where: { id: servicioId, estado: EstadoServicioStaff.ESPERANDO_VOZ },
    data: { estado: EstadoServicioStaff.ACTIVO, iniciadoEn },
  })
}

export async function cancelarServicioStaffEnEspera(servicioId: string, canceladoEn: Date) {
  return db.servicioStaff.updateMany({
    where: { id: servicioId, estado: EstadoServicioStaff.ESPERANDO_VOZ },
    data: {
      estado: EstadoServicioStaff.CANCELADO,
      claveActivo: null,
      finalizadoEn: canceladoEn,
    },
  })
}

export async function iniciarFinalizacionServicioStaff(servicioId: string, finalizadoEn: Date) {
  return db.servicioStaff.updateMany({
    where: {
      id: servicioId,
      estado: { in: [EstadoServicioStaff.ACTIVO, EstadoServicioStaff.FINALIZANDO] },
    },
    data: { estado: EstadoServicioStaff.FINALIZANDO, finalizadoEn },
  })
}

export async function completarServicioStaff(servicioId: string, finalizadoEn: Date) {
  return db.servicioStaff.updateMany({
    where: { id: servicioId, estado: EstadoServicioStaff.FINALIZANDO },
    data: {
      estado: EstadoServicioStaff.FINALIZADO,
      claveActivo: null,
      finalizadoEn,
    },
  })
}

export async function registrarMovimientoServicioStaff(datos: {
  servicioId: string
  canalAnteriorId: string | null
  canalNuevoId: string | null
  detalle: string
  iniciadoEn?: Date
}) {
  return db.actividadServicioStaff.create({
    data: {
      servicioId: datos.servicioId,
      tipo: TipoActividadServicioStaff.MOVIMIENTO_VOZ,
      titulo: 'Cambio de canal de voz',
      detalle: datos.detalle,
      canalAnteriorId: datos.canalAnteriorId,
      canalNuevoId: datos.canalNuevoId,
      iniciadoEn: datos.iniciadoEn,
      finalizadoEn: datos.iniciadoEn ?? new Date(),
      duracionMs: 0n,
    },
  })
}

export async function registrarSoporteEnServicioActivo(datos: {
  guildId: string
  staffDiscordId: string
  soporteId: string
  canalVozId: string
  abiertoEn: Date
  estadoGrabacion: string
}) {
  const servicio = await db.servicioStaff.findFirst({
    where: {
      guildId: datos.guildId,
      staffDiscordId: datos.staffDiscordId,
      estado: EstadoServicioStaff.ACTIVO,
    },
    orderBy: { creadoEn: 'desc' },
    select: { id: true },
  })
  if (!servicio) return undefined

  const existente = await db.actividadServicioStaff.findUnique({
    where: { soporteId: datos.soporteId },
    select: { id: true, servicioId: true },
  })
  if (existente) return existente.servicioId === servicio.id ? existente : undefined

  const estadoGrabacion =
    datos.estadoGrabacion === 'FINALIZADA'
      ? EstadoGrabacionServicioStaff.FINALIZADA
      : datos.estadoGrabacion === 'ERROR'
        ? EstadoGrabacionServicioStaff.ERROR
        : datos.estadoGrabacion === 'NO DISPONIBLE'
          ? EstadoGrabacionServicioStaff.SIN_AUDIO
          : EstadoGrabacionServicioStaff.PREPARANDO

  return db.$transaction(async (tx) => {
    const actividad = await tx.actividadServicioStaff.create({
      data: {
        servicioId: servicio.id,
        tipo: TipoActividadServicioStaff.SOPORTE,
        titulo: 'Soporte institucional',
        detalle: `Canal de voz: ${datos.canalVozId}`,
        soporteId: datos.soporteId,
        canalNuevoId: datos.canalVozId,
        iniciadoEn: datos.abiertoEn,
      },
    })
    await tx.grabacionServicioStaff.create({
      data: {
        servicioId: servicio.id,
        actividadId: actividad.id,
        grabacionId: datos.soporteId,
        origen: OrigenGrabacionServicioStaff.SOPORTE,
        estado: estadoGrabacion,
        iniciadoEn: estadoGrabacion === EstadoGrabacionServicioStaff.FINALIZADA
          ? datos.abiertoEn
          : null,
      },
    })
    return actividad
  })
}

export async function cerrarSoporteEnServicioStaff(datos: {
  soporteId: string
  finalizadoEn: Date
  grabacionIniciadaEn: Date | null
  grabacionFinalizadaEn: Date | null
  estadoGrabacion: string
  resultado: string
}) {
  const actividad = await db.actividadServicioStaff.findUnique({
    where: { soporteId: datos.soporteId },
    select: { id: true, servicioId: true, iniciadoEn: true },
  })
  if (!actividad) return

  const estadoGrabacion =
    datos.estadoGrabacion === 'FINALIZADA'
      ? EstadoGrabacionServicioStaff.FINALIZADA
      : datos.estadoGrabacion === 'ERROR'
        ? EstadoGrabacionServicioStaff.ERROR
        : datos.estadoGrabacion === 'NO DISPONIBLE'
          ? EstadoGrabacionServicioStaff.SIN_AUDIO
          : EstadoGrabacionServicioStaff.INTERRUMPIDA

  await db.$transaction([
    db.actividadServicioStaff.update({
      where: { id: actividad.id },
      data: {
        finalizadoEn: datos.finalizadoEn,
        duracionMs: BigInt(calcularDuracionMs(actividad.iniciadoEn, datos.finalizadoEn)),
        resultado: datos.resultado,
      },
    }),
    db.grabacionServicioStaff.updateMany({
      where: {
        servicioId: actividad.servicioId,
        grabacionId: datos.soporteId,
      },
      data: {
        estado: estadoGrabacion,
        iniciadoEn: datos.grabacionIniciadaEn,
        finalizadoEn: datos.grabacionFinalizadaEn,
      },
    }),
  ])
}

export async function actualizarGrabacionSoporteEnServicioStaff(datos: {
  soporteId: string
  estadoGrabacion: string
  iniciadoEn: Date | null
  finalizadoEn: Date | null
}) {
  const actividad = await db.actividadServicioStaff.findUnique({
    where: { soporteId: datos.soporteId },
    select: { servicioId: true },
  })
  if (!actividad) return

  const estado =
    datos.estadoGrabacion === 'GRABANDO'
      ? EstadoGrabacionServicioStaff.GRABANDO
      : datos.estadoGrabacion === 'FINALIZADA'
        ? EstadoGrabacionServicioStaff.FINALIZADA
        : datos.estadoGrabacion === 'ERROR'
          ? EstadoGrabacionServicioStaff.ERROR
          : datos.estadoGrabacion === 'NO DISPONIBLE'
            ? EstadoGrabacionServicioStaff.SIN_AUDIO
            : EstadoGrabacionServicioStaff.PREPARANDO

  return db.grabacionServicioStaff.updateMany({
    where: {
      servicioId: actividad.servicioId,
      grabacionId: datos.soporteId,
    },
    data: {
      estado,
      iniciadoEn: datos.iniciadoEn,
      finalizadoEn: datos.finalizadoEn,
    },
  })
}

export async function guardarGrabacionServicioStaff(datos: {
  servicioId: string
  grabacionId: string
  estado: EstadoGrabacionServicioStaff
  iniciadoEn?: Date | null
  finalizadoEn?: Date | null
}) {
  return db.grabacionServicioStaff.upsert({
    where: {
      servicioId_grabacionId: {
        servicioId: datos.servicioId,
        grabacionId: datos.grabacionId,
      },
    },
    create: {
      servicioId: datos.servicioId,
      grabacionId: datos.grabacionId,
      origen: OrigenGrabacionServicioStaff.ASISTENCIA_STAFF,
      estado: datos.estado,
      iniciadoEn: datos.iniciadoEn,
      finalizadoEn: datos.finalizadoEn,
    },
    update: {
      estado: datos.estado,
      iniciadoEn: datos.iniciadoEn,
      finalizadoEn: datos.finalizadoEn,
    },
  })
}

export async function marcarGrabacionesStaffInterrumpidas(guildId: string) {
  return db.grabacionServicioStaff.updateMany({
    where: {
      servicio: {
        guildId,
        estado: { in: [...estadosServicioEnCurso] },
      },
      origen: OrigenGrabacionServicioStaff.ASISTENCIA_STAFF,
      estado: { in: [
        EstadoGrabacionServicioStaff.PREPARANDO,
        EstadoGrabacionServicioStaff.GRABANDO,
      ] },
    },
    data: {
      estado: EstadoGrabacionServicioStaff.INTERRUMPIDA,
      finalizadoEn: new Date(),
    },
  })
}

