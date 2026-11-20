export type OrigenGrabacionStaff = 'ASISTENCIA_STAFF' | 'SOPORTE'
export type EstadoGrabacionStaff =
  | 'PREPARANDO'
  | 'GRABANDO'
  | 'FINALIZADA'
  | 'INTERRUMPIDA'
  | 'ERROR'
  | 'SIN_AUDIO'
export type TipoActividadStaff = 'SOPORTE' | 'MOVIMIENTO_VOZ'

export function formatearDuracion(duracionMs: number): string {
  const segundos = Math.max(0, Math.floor(duracionMs / 1_000))
  const horas = Math.floor(segundos / 3_600)
  const minutos = Math.floor((segundos % 3_600) / 60)
  const segundosRestantes = segundos % 60
  return `${horas} h ${minutos.toString().padStart(2, '0')} min ${segundosRestantes.toString().padStart(2, '0')} s`
}

export function calcularDuracionMs(inicio: Date, fin: Date): number {
  return Math.max(0, fin.getTime() - inicio.getTime())
}

export function parsearIdsDiscord(texto: string): string[] {
  const tokens = texto.trim() ? texto.trim().split(/[,\s;]+/) : []
  return tokens.map((token) => {
    const id = /^<@!?(\d{17,20})>$/.exec(token)?.[1] ?? token
    if (!/^\d{17,20}$/.test(id)) {
      throw new Error(`"${token}" no es un ID o una mención de usuario válida.`)
    }
    return id
  })
}

export function construirInformeServicioStaff(datos: {
  nombre: string
  discordId: string
  iniciadoEn: Date
  finalizadoEn: Date
  actividades: Array<{
    tipo: TipoActividadStaff
    titulo: string
    detalle: string | null
    iniciadoEn: Date
    finalizadoEn: Date | null
    duracionMs: bigint | null
    soporteId: string | null
    resultado: string | null
  }>
  grabaciones: Array<{
    grabacionId: string
    origen: OrigenGrabacionStaff
    estado: EstadoGrabacionStaff
  }>
}) {
  const duracionTotal = formatearDuracion(
    calcularDuracionMs(datos.iniciadoEn, datos.finalizadoEn),
  )
  const soportes = datos.actividades.filter((actividad) => actividad.tipo === 'SOPORTE')
  const actividades = datos.actividades
    .slice()
    .sort((a, b) => a.iniciadoEn.getTime() - b.iniciadoEn.getTime())
    .map((actividad) => {
      const fin = actividad.finalizadoEn ?? datos.finalizadoEn
      const duracion = actividad.duracionMs === null
        ? calcularDuracionMs(actividad.iniciadoEn, fin)
        : Number(actividad.duracionMs)
      const referencia = actividad.soporteId ? ` · Soporte \`${actividad.soporteId}\`` : ''
      const detalle = actividad.detalle ? ` · ${actividad.detalle}` : ''
      const resultado = actividad.resultado
        ? ` · Resultado: ${actividad.resultado}`
        : actividad.tipo === 'SOPORTE' && !actividad.finalizadoEn
          ? ' · Sigue abierto al finalizar el servicio'
          : ''
      return `• ${actividad.titulo}${referencia}${detalle} — ${formatearDuracion(duracion)}${resultado}`
    })
    .join('\n')
  const grabaciones = datos.grabaciones
    .map((grabacion) =>
      `• \`${grabacion.grabacionId}\` · ${grabacion.origen === 'SOPORTE' ? 'soporte' : 'Asistencia Staff'} · ${grabacion.estado}`,
    )
    .join('\n')

  return {
    identificacion: `**Staff:** ${datos.nombre}\n**ID de Discord:** ${datos.discordId}`,
    resumen:
      `**Fecha:** ${datos.iniciadoEn.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}\n` +
      `**Inicio:** ${datos.iniciadoEn.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' })}\n` +
      `**Término:** ${datos.finalizadoEn.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' })}\n` +
      `**Duración total:** ${duracionTotal}\n` +
      `**Soportes atendidos:** ${soportes.length}`,
    actividades: (actividades || '• Sin actividades registradas').slice(0, 1_000),
    grabaciones: (grabaciones || 'No hay referencias de grabación.').slice(0, 1_000),
    estado: 'Servicio finalizado correctamente.',
  }
}
