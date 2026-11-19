import type { Prisma } from '@rp-chile/db'
import type { db as dbCompartida } from '@rp-chile/db'
import { ErrorColisionIdentidadUnica } from '../types.js'
import type {
  DatosNuevoPersonaje,
  EventoAuditoriaIdentidad,
  OperacionesIdentidad,
  PerfilDiscord,
  PersonajeConCedula,
  StoreIdentidad,
  TransaccionIdentidad,
  UsuarioIdentidad,
} from '../types.js'

type ClientePrismaCompartido = typeof dbCompartida
type ClientePrismaDatos = Pick<
  Prisma.TransactionClient,
  'usuario' | 'personaje' | 'cedula' | 'auditoria' | '$queryRaw'
>

export function crearStoreIdentidad(cliente: ClientePrismaCompartido): StoreIdentidad {
  const operaciones = crearOperaciones(cliente)
  return {
    ...operaciones,
    transaction: <T>(operacion: (tx: TransaccionIdentidad) => Promise<T>) =>
      cliente.$transaction((tx) => operacion(crearOperaciones(tx))),
    listarPersonajesActivos: (discordId) => cliente.personaje.findMany({
      where: { activo: true, usuario: { discordId } },
      include: { cedula: true },
      orderBy: { creadoEn: 'asc' },
    }),
    consultarCedulaPorPersonaje: (personajeId) => cliente.cedula.findUnique({
      where: { personajeId },
    }),
    personajePerteneceAUsuario: async (personajeId, discordId) => {
      const personaje = await cliente.personaje.findFirst({
        where: { id: personajeId, usuario: { discordId } },
        select: { id: true },
      })
      return personaje !== null
    },
  }
}

function crearOperaciones(cliente: ClientePrismaDatos): OperacionesIdentidad {
  return {
    bloquearCreacionPersonaje: async (discordId) => {
      await cliente.$queryRaw<{ lock: string }[]>`
        SELECT pg_advisory_xact_lock(hashtext(${`rp-chile:identity:personajes:${discordId}`}))::text AS lock
      `
    },
    upsertUsuarioPerfil: (perfil: PerfilDiscord) => cliente.usuario.upsert({
      where: { discordId: perfil.discordId },
      update: {
        username: perfil.username,
        ...(perfil.avatar !== undefined ? { avatar: perfil.avatar } : {}),
      },
      create: {
        discordId: perfil.discordId,
        username: perfil.username,
        avatar: perfil.avatar ?? null,
      },
    }),
    obtenerUsuarioPorDiscordId: (discordId) => cliente.usuario.findUnique({
      where: { discordId },
    }),
    contarPersonajesActivos: (usuarioId) => cliente.personaje.count({
      where: { usuarioId, activo: true },
    }),
    crearPersonajeConCedula: (datos: DatosNuevoPersonaje) =>
      crearPersonajeConCedula(cliente, datos),
    registrarAuditoria: (evento: EventoAuditoriaIdentidad) =>
      cliente.auditoria.create({
        data: {
          actorId: evento.actorId,
          accion: evento.accion,
          entidad: evento.entidad,
          entidadId: evento.entidadId,
          ...(evento.detalle ? { detalle: evento.detalle } : {}),
        },
      }).then(() => undefined),
  }
}

async function crearPersonajeConCedula(
  cliente: ClientePrismaDatos,
  datos: DatosNuevoPersonaje,
): Promise<PersonajeConCedula> {
  try {
    return await cliente.personaje.create({
      data: {
        usuarioId: datos.usuarioId,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        rut: datos.rut,
        fechaNacimiento: datos.fechaNacimiento,
        cedula: {
          create: {
            numeroSerie: datos.numeroSerie,
            venceEn: datos.venceEn,
            robloxUsername: datos.robloxUsername,
          },
        },
      },
      include: { cedula: true },
    })
  } catch (error) {
    const campo = campoUnicoIdentidad(error)
    if (campo) throw new ErrorColisionIdentidadUnica(campo)
    throw error
  }
}

function campoUnicoIdentidad(error: unknown): ErrorColisionIdentidadUnica['campo'] | undefined {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') return undefined
  if (!('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('target' in error.meta)) {
    return undefined
  }
  const target = error.meta.target
  const campos = (Array.isArray(target) ? target.join(' ') : String(target)).toLocaleLowerCase('en')
  if (campos.includes('numeroserie')) return 'numeroSerie'
  if (campos.includes('rut')) return 'rut'
  return undefined
}
