import type {
  EstadoDocumento,
  EstadoVerificacion,
  Prisma,
  RolPlataforma,
} from '@rp-chile/db'

export interface PerfilDiscord {
  discordId: string
  username: string
  avatar?: string | null
}

export interface UsuarioIdentidad {
  id: string
  discordId: string
  username: string
  avatar: string | null
  rol: RolPlataforma
  verificacion: EstadoVerificacion
}

export interface CedulaIdentidad {
  id: string
  personajeId: string
  numeroSerie: string
  robloxUsername: string | null
  emitidaEn: Date
  venceEn: Date
  estado: EstadoDocumento
}

export interface PersonajeConCedula {
  id: string
  usuarioId: string
  nombres: string
  apellidos: string
  rut: string
  fechaNacimiento: Date
  nacionalidad: string
  activo: boolean
  creadoEn: Date
  cedula: CedulaIdentidad | null
}

export interface DatosNuevoPersonaje {
  usuarioId: string
  nombres: string
  apellidos: string
  rut: string
  fechaNacimiento: Date
  numeroSerie: string
  venceEn: Date
  robloxUsername: string
}

export interface EventoAuditoriaIdentidad {
  actorId: string
  accion: string
  entidad: string
  entidadId: string
  detalle?: Prisma.InputJsonObject
}

export interface OperacionesIdentidad {
  bloquearCreacionPersonaje(discordId: string): Promise<void>
  upsertUsuarioPerfil(perfil: PerfilDiscord): Promise<UsuarioIdentidad>
  obtenerUsuarioPorDiscordId(discordId: string): Promise<UsuarioIdentidad | null>
  contarPersonajesActivos(usuarioId: string): Promise<number>
  crearPersonajeConCedula(datos: DatosNuevoPersonaje): Promise<PersonajeConCedula>
  registrarAuditoria(evento: EventoAuditoriaIdentidad): Promise<void>
}

export type TransaccionIdentidad = OperacionesIdentidad

export interface StoreIdentidad extends OperacionesIdentidad {
  transaction<T>(operacion: (tx: TransaccionIdentidad) => Promise<T>): Promise<T>
  listarPersonajesActivos(discordId: string): Promise<PersonajeConCedula[]>
  consultarCedulaPorPersonaje(personajeId: string): Promise<CedulaIdentidad | null>
  personajePerteneceAUsuario(personajeId: string, discordId: string): Promise<boolean>
}

export type AutorizarSegundoPersonaje = (usuario: UsuarioIdentidad) => void

export class ErrorValidacionIdentidad extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErrorValidacionIdentidad'
  }
}

export class ErrorUsuarioNoVerificado extends Error {
  constructor() {
    super('El usuario debe estar verificado para crear personajes.')
    this.name = 'ErrorUsuarioNoVerificado'
  }
}

export class ErrorLimitePersonajes extends Error {
  constructor() {
    super('El usuario ya alcanzó el límite de personajes activos.')
    this.name = 'ErrorLimitePersonajes'
  }
}

export class ErrorAutorizacionSegundoPersonaje extends Error {
  constructor() {
    super('La creación de un segundo personaje requiere autorización del servidor.')
    this.name = 'ErrorAutorizacionSegundoPersonaje'
  }
}

export class ErrorColisionIdentidadUnica extends Error {
  constructor(readonly campo: 'rut' | 'numeroSerie') {
    super(`Colisión al generar un valor único de identidad (${campo}).`)
    this.name = 'ErrorColisionIdentidadUnica'
  }
}
