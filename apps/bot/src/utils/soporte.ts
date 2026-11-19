import { PermissionFlagsBits } from 'discord.js'

export interface SeleccionGrupoSoporte {
  usuarios: readonly string[]
  rolId?: string | null
}

export interface ParticipantesSoporte {
  reportantes: SeleccionGrupoSoporte
  reportados: SeleccionGrupoSoporte
  testigos: SeleccionGrupoSoporte
}

export interface PermisoCanalSoporte {
  id: string
  allow: bigint[]
  deny: bigint[]
}

export function puedeIniciarSoporte(
  tienePermisoAdministrador: boolean,
  rolesMiembro: readonly string[],
  rolesAutorizados: { staff: string; moderador?: string; admin?: string },
): boolean {
  return tienePermisoAdministrador || [
    rolesAutorizados.staff,
    rolesAutorizados.moderador,
    rolesAutorizados.admin,
  ].some((id) => !!id && rolesMiembro.includes(id))
}

export function validarGrupoSoporte(
  grupo: SeleccionGrupoSoporte,
  opciones: { requerido: boolean; permiteRol: boolean; etiqueta: string },
): string | undefined {
  if (grupo.usuarios.length > 3) {
    return `${opciones.etiqueta}: se permiten como máximo tres usuarios.`
  }
  if (new Set(grupo.usuarios).size !== grupo.usuarios.length) {
    return `${opciones.etiqueta}: no se pueden repetir usuarios.`
  }
  if (grupo.rolId && !opciones.permiteRol) {
    return `${opciones.etiqueta}: no se permite seleccionar un rol.`
  }
  if (grupo.rolId && grupo.usuarios.length > 0) {
    return `${opciones.etiqueta}: selecciona usuarios o un rol, no ambos.`
  }
  if (opciones.requerido && grupo.usuarios.length === 0 && !grupo.rolId) {
    return `${opciones.etiqueta}: debes seleccionar al menos un usuario o un rol.`
  }
  return undefined
}

export function validarParticipantesSoporte(participantes: ParticipantesSoporte): string | undefined {
  return validarGrupoSoporte(participantes.reportantes, {
    requerido: true,
    permiteRol: true,
    etiqueta: 'Personas que reportan',
  }) ?? validarGrupoSoporte(participantes.reportados, {
    requerido: true,
    permiteRol: true,
    etiqueta: 'Personas reportadas',
  }) ?? validarGrupoSoporte(participantes.testigos, {
    requerido: false,
    permiteRol: false,
    etiqueta: 'Testigos',
  })
}

export function normalizarSufijoCanalSoporte(valor: string): string {
  const normalizado = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return normalizado || 'usuario'
}

export function obtenerIdsAccesoSoporte(
  participantes: ParticipantesSoporte,
  ejecutorId: string,
  rolesSupervision: readonly string[],
): string[] {
  return [...new Set([
    ...participantes.reportantes.usuarios,
    ...participantes.reportados.usuarios,
    ...participantes.testigos.usuarios,
    ...(participantes.reportantes.rolId ? [participantes.reportantes.rolId] : []),
    ...(participantes.reportados.rolId ? [participantes.reportados.rolId] : []),
    ejecutorId,
    ...rolesSupervision,
  ])]
}

export function obtenerIdsUsuariosParaMover(
  participantes: ParticipantesSoporte,
  moderadorId: string,
): string[] {
  return [...new Set([
    ...participantes.reportantes.usuarios,
    ...participantes.reportados.usuarios,
    ...participantes.testigos.usuarios,
    moderadorId,
  ])]
}

export function crearPermisosCanalSoporte(
  everyoneId: string,
  botId: string,
  idsAcceso: readonly string[],
  tipo: 'voz' | 'texto',
): PermisoCanalSoporte[] {
  const permitirTexto = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ]
  const permitirVoz = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ]
  const permitirBot = [
    ...(tipo === 'voz' ? permitirVoz : permitirTexto),
    PermissionFlagsBits.ManageChannels,
    ...(tipo === 'voz' ? [PermissionFlagsBits.MoveMembers] : []),
  ]
  const permitirParticipante = tipo === 'voz' ? permitirVoz : permitirTexto
  const entradas = new Map<string, { allow: Set<bigint>; deny: Set<bigint> }>()
  entradas.set(everyoneId, {
    allow: new Set(),
    deny: new Set([PermissionFlagsBits.ViewChannel]),
  })

  for (const id of idsAcceso) {
    if (id === everyoneId) throw new Error('No se puede asignar acceso al rol @everyone.')
    entradas.set(id, {
      allow: new Set(permitirParticipante),
      deny: new Set(),
    })
  }
  entradas.set(botId, {
    allow: new Set(permitirBot),
    deny: new Set(),
  })

  return [...entradas].map(([id, permisos]) => ({
    id,
    allow: [...permisos.allow],
    deny: [...permisos.deny],
  }))
}
