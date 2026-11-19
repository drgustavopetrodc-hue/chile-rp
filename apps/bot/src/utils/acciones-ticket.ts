export type EquipoTicketAccion =
  | 'SOPORTE'
  | 'FUNDACION'
  | 'JUNTA_ADMINISTRATIVA'
  | 'MODERACION'

export type ResultadoReasignacion = 'EXITOSA' | 'FALLIDA' | 'REVERTIDA'

export interface ClasificacionAccionTicket {
  accion: 'CERRAR' | 'REASIGNAR' | 'NINGUNA'
  destino: EquipoTicketAccion | null
  ordenExplicita: boolean
  ambigua: boolean
}

const verbosReasignacion =
  /\b(?:reasign\w*|asign\w*|deriv\w*|pas\w*|transfier\w*|transfer\w*|traslad\w*|mov\w*|cambi\w*|redirig\w*|encamin\w*|canaliz\w*|envi\w*|mand\w*|devuelv\w*|devolv\w*|regres\w*|retorn\w*)\b/
const entidadTicket = /\b(?:ticket|caso)\b/

export function quitarContenidoCitado(texto: string) {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/“[^”]*”|“[^”]*$|"[^"]*"|"[^"]*$/g, ' ')
    .replace(/‘[^’]*’|‘[^’]*$|'[^']*'|'[^']*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizarSolicitudTicket(texto: string) {
  return texto
    .replace(/<@!?[\d]+>|<@&[\d]+>|<#\d+>/g, ' ')
    .toLocaleLowerCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[\s¿?¡!.,]+/, '')
    .trim()
}

export function esMencionActivadora(
  texto: string,
  botId: string,
  usuariosMencionados: readonly string[],
) {
  return usuariosMencionados.includes(botId) && mencionBotAlFinal(texto, botId)
}

export function puedeUsarClasificacionIA(iaActiva: boolean | undefined, hayProveedores: boolean) {
  return iaActiva !== false && hayProveedores
}

export function detectarReasignacionDeterminista(texto: string): ClasificacionAccionTicket | undefined {
  const normalizado = normalizarSolicitudTicket(quitarContenidoCitado(texto))
  if (!esOrdenReasignacionExplicita(normalizado)) return undefined

  const destinos = destinosEnTexto(normalizado)
  const destino = encontrarDestino(normalizado)
  const ambigua = !destino || destinos.size > 1
  return {
    accion: 'REASIGNAR',
    destino: ambigua ? null : destino,
    ordenExplicita: true,
    ambigua,
  }
}

export function esOrdenReasignacionExplicita(texto: string) {
  return esOrdenReasignacionExplicitaNormalizada(
    normalizarSolicitudTicket(quitarContenidoCitado(texto)),
  )
}

export function detectarCierreDeterminista(texto: string) {
  const normalizado = normalizarSolicitudTicket(quitarContenidoCitado(texto))
  if (esPreguntaONegacion(normalizado)) return false
  return /\b(?:elimin\w*|borr\w*|cierr\w*|finaliz\w*|termin\w*|archiv\w*)\b/.test(normalizado) &&
    entidadTicket.test(normalizado)
}

export function parsearClasificacionAccionTicket(texto: string): ClasificacionAccionTicket | undefined {
  const contenido = texto.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')
  const inicio = contenido.indexOf('{')
  const fin = contenido.lastIndexOf('}')
  if (inicio < 0 || fin <= inicio) return undefined

  let valor: unknown
  try {
    valor = JSON.parse(contenido.slice(inicio, fin + 1))
  } catch {
    return undefined
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined

  const datos = valor as Record<string, unknown>
  const { accion, destino, ordenExplicita, ambigua } = datos
  if (
    (accion !== 'CERRAR' && accion !== 'REASIGNAR' && accion !== 'NINGUNA') ||
    typeof ordenExplicita !== 'boolean' ||
    typeof ambigua !== 'boolean'
  ) return undefined

  const equipo = esEquipoTicket(destino) ? destino : null
  if (destino !== null && equipo === null) return undefined
  if (accion === 'CERRAR' && equipo !== null) return undefined
  if (accion === 'NINGUNA' && (equipo !== null || ordenExplicita)) return undefined
  if (accion === 'REASIGNAR' && !ambigua && equipo === null) return undefined

  return { accion, destino: equipo, ordenExplicita, ambigua }
}

export function destinoExplicitoUnico(texto: string, destino: EquipoTicketAccion) {
  const normalizado = normalizarSolicitudTicket(quitarContenidoCitado(texto))
  const destinos = destinosEnTexto(normalizado)
  return destinos.size === 1 && destinos.has(destino)
}

export function motivoReasignacion(texto: string) {
  const operativo = quitarContenidoCitado(texto)
    .replace(/<@!?[\d]+>|<@&[\d]+>|<#\d+>/g, ' ')
    .trim()
  const coincidencia = operativo.match(
    /\b(?:porque|debido\s+a|motivo(?:\s+de\s+reasignaci[oó]n)?\s*[:=]?)\s+(.+)$/i,
  )
  return coincidencia?.[1]?.trim().slice(0, 500) || null
}

export function puedeReasignarTicket(
  rolesUsuario: readonly string[],
  rolEquipoActual: string,
  rolesAutoridad: readonly (string | undefined)[],
  tienePermisoAdministrador: boolean,
) {
  return tienePermisoAdministrador ||
    rolesUsuario.includes(rolEquipoActual) ||
    rolesAutoridad.some((rolId) => !!rolId && rolesUsuario.includes(rolId))
}

export function validarPrecondicionesReasignacion(opciones: {
  estado: string
  equipoActual: EquipoTicketAccion | null
  equipoNuevo: EquipoTicketAccion
  rolActualExiste: boolean
  rolNuevoExiste: boolean
  botPuedeGestionarPermisos: boolean
}) {
  if (opciones.estado !== 'EN_ATENCION') return 'El ticket debe estar asignado a un equipo antes de poder reasignarlo.'
  if (!opciones.equipoActual) return 'No pude identificar un equipo responsable actual para este ticket.'
  if (opciones.equipoActual === opciones.equipoNuevo) return 'El ticket ya está asignado a ese equipo.'
  if (!opciones.rolActualExiste) return 'No encontré el rol del equipo actualmente asignado.'
  if (!opciones.rolNuevoExiste) return 'No encontré el rol del equipo de destino en este servidor.'
  if (!opciones.botPuedeGestionarPermisos) {
    return 'El bot necesita el permiso Gestionar roles para reasignar el acceso al ticket.'
  }
  return undefined
}

export class ErrorOperacionReasignacion extends Error {
  constructor(
    readonly resultado: Exclude<ResultadoReasignacion, 'EXITOSA'>,
    message: string,
    readonly causa: unknown,
    readonly errorRollback?: unknown,
  ) {
    super(message)
    this.name = 'ErrorOperacionReasignacion'
  }
}

export async function ejecutarReasignacionConRollback(operaciones: {
  concederDestino: () => Promise<unknown>
  retirarEquipoActual: () => Promise<unknown>
  actualizarRegistro: () => Promise<unknown>
  restaurarEquipoActual: () => Promise<unknown>
  restaurarRegistro: () => Promise<unknown>
  restaurarDestino: () => Promise<unknown>
  mantenerDestinoResponsable: () => Promise<unknown>
}) {
  let destinoConcedido = false
  try {
    await operaciones.concederDestino()
    destinoConcedido = true
    await operaciones.retirarEquipoActual()
    await operaciones.actualizarRegistro()
  } catch (causa) {
    if (!destinoConcedido) {
      throw new ErrorOperacionReasignacion(
        'FALLIDA',
        'No se pudo conceder acceso al equipo de destino; el acceso actual no se modificó.',
        causa,
      )
    }

    try {
      await operaciones.restaurarEquipoActual()
    } catch (errorRollback) {
      try {
        await operaciones.mantenerDestinoResponsable()
      } catch (errorDestino) {
        console.error('[Ticket] No se pudo confirmar el destino como equipo responsable:', errorDestino)
      }
      throw new ErrorOperacionReasignacion(
        'FALLIDA',
        'Falló la reasignación. No se pudo restaurar el equipo anterior; se conservó el acceso del equipo de destino.',
        causa,
        errorRollback,
      )
    }

    try {
      await operaciones.restaurarRegistro()
    } catch (errorRollback) {
      try {
        await operaciones.mantenerDestinoResponsable()
      } catch (errorDestino) {
        console.error('[Ticket] No se pudo confirmar el destino como equipo responsable:', errorDestino)
      }
      throw new ErrorOperacionReasignacion(
        'FALLIDA',
        'Falló la reasignación y no se pudo restaurar el registro. Se conservó el acceso del equipo de destino.',
        causa,
        errorRollback,
      )
    }

    try {
      await operaciones.restaurarDestino()
    } catch (errorRollback) {
      throw new ErrorOperacionReasignacion(
        'FALLIDA',
        'El equipo anterior fue restaurado, pero no se pudo retirar el acceso del destino.',
        causa,
        errorRollback,
      )
    }

    throw new ErrorOperacionReasignacion(
      'REVERTIDA',
      'Falló la reasignación; se restauraron los permisos y la asignación anteriores.',
      causa,
    )
  }
}

function encontrarDestino(texto: string): EquipoTicketAccion | null {
  const coincidencia = texto.match(
    /\b(?:a|al|para|hacia)\s+(?:(?:equipo|area|departamento)\s+(?:de\s+)?(?:(?:el|la)\s+)?)?(?:el\s+|la\s+)?(junta\s+administrativa|fundacion|moderacion|soporte)\b/,
  )
  if (!coincidencia) return null
  return equipoPorNombre(coincidencia[1]!.replace(/\s+/g, ' '))
}

function equipoPorNombre(nombre: string): EquipoTicketAccion | null {
  if (nombre === 'junta administrativa') return 'JUNTA_ADMINISTRATIVA'
  if (nombre === 'fundacion') return 'FUNDACION'
  if (nombre === 'moderacion') return 'MODERACION'
  if (nombre === 'soporte') return 'SOPORTE'
  return null
}

function destinosEnTexto(texto: string) {
  const encontrados = new Set<EquipoTicketAccion>()
  const patronDestino =
    /\b(?:a|al|para|hacia)\s+(?:(?:equipo|area|departamento)\s+(?:de\s+)?(?:(?:el|la)\s+)?)?(?:el\s+|la\s+)?(junta\s+administrativa|fundacion|moderacion|soporte)\b/g
  for (const coincidencia of texto.matchAll(patronDestino)) {
    const equipo = equipoPorNombre(coincidencia[1]!)
    if (equipo) encontrados.add(equipo)
  }
  const primerDestino = texto.match(
    /\b(?:a|al|para|hacia)\s+(?:(?:equipo|area|departamento)\s+(?:de\s+)?(?:(?:el|la)\s+)?)?(?:el\s+|la\s+)?(?:junta\s+administrativa|fundacion|moderacion|soporte)\b/,
  )
  if (primerDestino?.index !== undefined) {
    const resto = texto.slice(primerDestino.index + primerDestino[0].length)
    const alternativa = /\b(?:o|u)\b[\s,:-]{0,20}(?:(?:a|al|para|hacia)\s+)?(?:(?:equipo|area|departamento)\s+(?:de\s+)?(?:(?:el|la)\s+)?)?(?:el\s+|la\s+)?(junta\s+administrativa|fundacion|moderacion|soporte)\b/g
    for (const coincidencia of resto.matchAll(alternativa)) {
      const equipo = equipoPorNombre(coincidencia[1]!)
      if (equipo) encontrados.add(equipo)
    }
  }
  return encontrados
}

function esOrdenReasignacionExplicitaNormalizada(texto: string) {
  if (esPreguntaONegacion(texto)) return false
  return verbosReasignacion.test(texto) && entidadTicket.test(texto)
}

function esPreguntaONegacion(texto: string) {
  return /^(?:como|por\s+que|que\s+significa|se\s+puede|puedo|cuando|donde|cual)\b/.test(texto) ||
    /^(?:no|nunca|jamas)\b.{0,100}\b(?:reasign\w*|asign\w*|deriv\w*|pas\w*|transfier\w*|transfer\w*|traslad\w*|mov\w*|cambi\w*|redirig\w*|encamin\w*|canaliz\w*|envi\w*|mand\w*|devuelv\w*|devolv\w*|regres\w*|retorn\w*|elimin\w*|borr\w*|cierr\w*|finaliz\w*|termin\w*|archiv\w*)\b/.test(texto)
}

function esEquipoTicket(valor: unknown): valor is EquipoTicketAccion {
  return valor === 'SOPORTE' ||
    valor === 'FUNDACION' ||
    valor === 'JUNTA_ADMINISTRATIVA' ||
    valor === 'MODERACION'
}

function mencionBotAlFinal(texto: string, botId: string) {
  const mencion = new RegExp(`<@!?${botId}>`, 'g')
  const coincidencias = [...texto.matchAll(mencion)]
  const ultima = coincidencias.at(-1)
  return !!ultima && ultima.index !== undefined &&
    /^[\s.,!?;:]*$/.test(texto.slice(ultima.index + ultima[0].length))
}
