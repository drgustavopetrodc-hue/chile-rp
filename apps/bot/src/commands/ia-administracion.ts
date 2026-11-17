import { randomUUID } from 'node:crypto'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  GuildMember,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  Role,
} from 'discord.js'
import { config } from '../config'
import { coloresEmbed, crearEmbed } from '../utils/embeds'
import { comoComponentsV2 } from '../utils/components-v2'

type Intencion =
  | 'ban'
  | 'unban'
  | 'kick'
  | 'timeout'
  | 'crearRol'
  | 'editarRol'
  | 'eliminarRol'
  | 'agregarRol'
  | 'quitarRol'
  | 'crearCanal'
  | 'renombrarCanal'
  | 'eliminarCanal'
  | 'permisoCanal'
  | 'eliminarMensajes'
  | 'fijarMensaje'

interface OperacionAdministrativa {
  titulo: string
  detalle: string
  ejecutar: (confirmacion: Message) => Promise<string>
}

interface ConfirmacionPendiente {
  usuarioId: string
  servidorId: string
  venceEn: number
  mensaje: Message
  ejecutar: OperacionAdministrativa['ejecutar']
}

const confirmacionesPendientes = new Map<string, ConfirmacionPendiente>()
const tiempoConfirmacionMs = 2 * 60_000
const permisosProtegidos = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.MentionEveryone,
]
const rolesProtegidos = [
  config.roles.fundacion,
  config.roles.juntaAdministrativa,
  config.roles.staff,
  config.roles.admin,
  config.roles.moderador,
  config.roles.soporte,
  config.roles.noVerificado,
  config.roles.policia,
  config.roles.segundoPersonaje,
]
const rolesNoEliminables = [...rolesProtegidos, config.roles.ciudadano]

function normalizar(texto: string) {
  return texto
    .toLocaleLowerCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[¿?¡!.,\s]+/, '')
    .trim()
}

function limpiarPrefijo(texto: string) {
  return texto
    .replace(/^[\s¿?¡!.,]*(?:por favor[, ]*|puedes\s+|podrias\s+|quiero que\s+|necesito que\s+)/i, '')
    .trim()
}

function detectarIntencion(texto: string): Intencion | undefined {
  let comando = normalizar(texto)
  if (/^(?:como|por que|quien|quienes|cuando|donde|que|cual|cuales|puedo)\b/.test(comando)) return undefined
  comando = comando.replace(/^(?:por favor[, ]*|puedes\s+|podrias\s+|quiero que\s+|necesito que\s+)/, '')

  if (/^(?:desbanea|desbanear|unban)\b/.test(comando)) return 'unban'
  if (/^(?:ban|banea|banear|banealo|baneala)\b/.test(comando)) return 'ban'
  if (/^(?:expulsa|expulsar|kick)\b/.test(comando)) return 'kick'
  if (/^(?:timeout|silencia|silenciar|aplica timeout)\b/.test(comando)) return 'timeout'
  if (/^(?:permite|permitir|da permiso|dar permiso|deniega|denegar|bloquea|quita|quitar|revoca|revocar)\b.*\b(?:permiso|ver|escribir|historial|conectar|hablar)\b/.test(comando)) {
    return 'permisoCanal'
  }
  if (/^(?:crea|crear|crees)\b.*\brol\b/.test(comando)) return 'crearRol'
  if (/^(?:renombra|renombrar|edita|editar|cambia)\b.*\brol\b/.test(comando)) return 'editarRol'
  if (/^(?:elimina|eliminar|borra|borrar)\b.*\brol\b/.test(comando)) return 'eliminarRol'
  if (/^(?:quita|quitar|remueve|remover|retira|retirar|saca|asigna|asignar|agrega|agregar|anade|anadir|pon|poner|da|dar|dale|des)\b.*\brol\b/.test(comando)) {
    return /^(?:quita|quitar|remueve|remover|retira|retirar|saca)\b/.test(comando) ? 'quitarRol' : 'agregarRol'
  }
  if (/^(?:crea|crear|crees)\b.*\b(?:canal|categoria)\b/.test(comando)) return 'crearCanal'
  if (/^(?:renombra|renombrar|edita|editar)\b.*\b(?:canal|categoria)\b/.test(comando)) return 'renombrarCanal'
  if (/^(?:elimina|eliminar|borra|borrar)\b.*\b(?:canal|categoria)\b/.test(comando)) return 'eliminarCanal'
  if (/^(?:elimina|eliminar|borra|borrar|limpia|limpiar)\b.*\bmensajes?\b/.test(comando)) return 'eliminarMensajes'
  if (/^(?:fija|fijar|ancla|anclar)\b.*\bmensaje\b/.test(comando)) return 'fijarMensaje'
  return undefined
}

function estaAutorizado(miembro: GuildMember) {
  return [config.roles.fundacion, config.roles.juntaAdministrativa]
    .some((id) => !!id && miembro.roles.cache.has(id))
}

function textoSeguro(texto: string) {
  return texto.replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@[!&]?\d+>/g, '[mención]')
}

async function responder(mensaje: Message, titulo: string, descripcion: string, color: number = coloresEmbed.principal) {
  await mensaje.reply(comoComponentsV2({
    embeds: [crearEmbed(titulo, descripcion, color)],
    allowedMentions: { repliedUser: false, parse: [] },
  }))
}

function unaPersona(mensaje: Message, botId: string) {
  const usuarios = [...mensaje.mentions.users.values()].filter((usuario) => usuario.id !== botId)
  if (usuarios.length !== 1) throw new Error('Menciona exactamente a una persona.')
  return usuarios[0]!
}

function unRol(mensaje: Message) {
  const roles = [...mensaje.mentions.roles.values()]
  if (roles.length !== 1) throw new Error('Menciona exactamente un rol.')
  const rol = roles[0]!
  if (rol.id === mensaje.guildId || rol.managed) throw new Error('Ese rol no se puede administrar manualmente.')
  return rol
}

function unCanal(mensaje: Message) {
  const canales = [...mensaje.mentions.channels.values()]
  if (canales.length !== 1) throw new Error('Menciona exactamente un canal o una categoría.')
  const canal = canales[0]!
  if (!('guildId' in canal) || !('name' in canal) || typeof canal.name !== 'string') {
    throw new Error('Menciona un canal de este servidor.')
  }
  return canal
}

function nombreDesde(texto: string, marcador: RegExp) {
  const coincidencia = marcador.exec(texto)
  const nombre = coincidencia ? texto.slice(coincidencia.index + coincidencia[0].length) : ''
  const limpio = nombre.replace(/^[\s"'“]+|[\s"'”.,!?]+$/g, '').trim()
  if (!limpio || limpio.length > 100) throw new Error('Indica un nombre de entre 1 y 100 caracteres.')
  return limpio
}

function nombreCanalDesde(texto: string, marcador: RegExp) {
  const nombre = nombreDesde(texto, marcador)
    .toLocaleLowerCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!nombre || nombre.length > 100) throw new Error('El nombre del canal no es válido.')
  return nombre
}

function razon(mensaje: Message) {
  return `Solicitud confirmada por ${mensaje.author.tag} (${mensaje.author.id}); mensaje ${mensaje.id}`.slice(0, 480)
}

function rolAdministrativo(rol: Role) {
  return permisosProtegidos.some((permiso) => rol.permissions.has(permiso))
}

function rolNoAdministrable(rol: Role) {
  return rol.id === rol.guild.id || rol.managed || rolAdministrativo(rol) || rolesProtegidos.includes(rol.id)
}

function rolNoEliminable(rol: Role) {
  return rolNoAdministrable(rol) || rolesNoEliminables.includes(rol.id)
}

function crearOperacion(mensaje: Message, texto: string, intencion: Intencion, botId: string): OperacionAdministrativa {
  const guild = mensaje.guild!
  switch (intencion) {
    case 'ban': {
      const usuario = unaPersona(mensaje, botId)
      if (usuario.id === mensaje.author.id || usuario.id === guild.ownerId) throw new Error('No puedes vetarte a ti ni al propietario del servidor.')
      return {
        titulo: 'Vetar a una persona',
        detalle: `Se aplicará un veto permanente a **${textoSeguro(usuario.tag)}**.`,
        ejecutar: async () => {
          const objetivo = await guild.members.fetch(usuario.id)
          if (!objetivo.bannable) throw new Error('El bot no puede vetar a esa persona por permisos o jerarquía.')
          await objetivo.ban({ reason: razon(mensaje) })
          return `Veto aplicado a **${textoSeguro(usuario.tag)}**.`
        },
      }
    }
    case 'unban': {
      const idTexto = texto.replace(/<@!?(\d+)>/g, '').match(/\b\d{17,20}\b/)?.[0]
      if (!idTexto) throw new Error('Indica el ID de Discord de la persona vetada.')
      return {
        titulo: 'Retirar un veto',
        detalle: `Se retirará el veto de la cuenta con ID \`${idTexto}\`.`,
        ejecutar: async () => {
          await guild.members.unban(idTexto, razon(mensaje))
          return `Veto retirado para \`${idTexto}\`.`
        },
      }
    }
    case 'kick': {
      const usuario = unaPersona(mensaje, botId)
      if (usuario.id === mensaje.author.id || usuario.id === guild.ownerId) throw new Error('No puedes expulsarte a ti ni al propietario del servidor.')
      return {
        titulo: 'Expulsar a una persona',
        detalle: `Se expulsará a **${textoSeguro(usuario.tag)}** del servidor.`,
        ejecutar: async () => {
          const objetivo = await guild.members.fetch(usuario.id)
          if (!objetivo.kickable) throw new Error('El bot no puede expulsar a esa persona por permisos o jerarquía.')
          await objetivo.kick(razon(mensaje))
          return `**${textoSeguro(usuario.tag)}** fue expulsado del servidor.`
        },
      }
    }
    case 'timeout': {
      const usuario = unaPersona(mensaje, botId)
      if (usuario.id === mensaje.author.id || usuario.id === guild.ownerId) throw new Error('No puedes aplicarte timeout a ti ni al propietario del servidor.')
      const duracion = texto.match(/\b(\d+)\s*(s|segundos?|m|minutos?|h|horas?|d|d[ií]as?)\b/i)
      if (!duracion) throw new Error('Indica la duración: por ejemplo `10 minutos`, `2 horas` o `1 día`.')
      const cantidad = Number(duracion[1])
      const unidad = duracion[2]!.toLocaleLowerCase('es-CL')
      const multiplicador = unidad.startsWith('s') ? 1_000 : unidad.startsWith('m') ? 60_000 : unidad.startsWith('h') ? 3_600_000 : 86_400_000
      const milisegundos = cantidad * multiplicador
      if (!Number.isSafeInteger(milisegundos) || milisegundos < 60_000 || milisegundos > 28 * 86_400_000) {
        throw new Error('La duración debe ser de entre 1 minuto y 28 días.')
      }
      return {
        titulo: 'Aplicar timeout',
        detalle: `Se aplicará timeout a **${textoSeguro(usuario.tag)}** por **${duracion[0]}**.`,
        ejecutar: async () => {
          const objetivo = await guild.members.fetch(usuario.id)
          if (!objetivo.moderatable) throw new Error('El bot no puede aplicar timeout por permisos o jerarquía.')
          await objetivo.timeout(milisegundos, razon(mensaje))
          return `Timeout aplicado a **${textoSeguro(usuario.tag)}** por **${duracion[0]}**.`
        },
      }
    }
    case 'crearRol': {
      const nombre = nombreDesde(texto, /(?:crea|crear|crees)\s+(?:un\s+)?rol\s+/i)
      return {
        titulo: 'Crear un rol',
        detalle: `Se creará el rol **${textoSeguro(nombre)}** sin permisos administrativos.`,
        ejecutar: async () => {
          const rol = await guild.roles.create({ name: nombre, permissions: [], reason: razon(mensaje) })
          return `Rol **${textoSeguro(rol.name)}** creado. No se le asignaron permisos.`
        },
      }
    }
    case 'editarRol': {
      const rol = unRol(mensaje)
      if (rolAdministrativo(rol)) throw new Error('No se editan roles con permisos administrativos o de moderación.')
      const color = texto.match(/\bcolor\s+#?([0-9a-f]{6})\b/i)?.[1]
      const nuevoNombre = color ? undefined : nombreDesdeDespuesDeMencion(texto, rol.id)
      return {
        titulo: color ? 'Cambiar color del rol' : 'Renombrar un rol',
        detalle: color
          ? `Se cambiará el color del rol **${textoSeguro(rol.name)}**.`
          : `El rol **${textoSeguro(rol.name)}** pasará a llamarse **${textoSeguro(nuevoNombre!)}**.`,
        ejecutar: async () => {
          const actual = await guild.roles.fetch(rol.id)
          if (!actual?.editable) throw new Error('El bot no puede editar ese rol por permisos o jerarquía.')
          if (color) await actual.edit({ color: Number.parseInt(color, 16), reason: razon(mensaje) })
          else await actual.setName(nuevoNombre!, razon(mensaje))
          return color
            ? `Color cambiado para **${textoSeguro(actual.name)}**.`
            : `Rol renombrado a **${textoSeguro(nuevoNombre!)}**.`
        },
      }
    }
    case 'eliminarRol': {
      const rol = unRol(mensaje)
      if (rolNoEliminable(rol)) throw new Error('Ese rol está protegido y no se puede eliminar mediante una mención.')
      return {
        titulo: 'Eliminar un rol',
        detalle: `Se eliminará el rol **${textoSeguro(rol.name)}** del servidor.`,
        ejecutar: async () => {
          const actual = await guild.roles.fetch(rol.id)
          if (!actual?.editable) throw new Error('El bot no puede eliminar ese rol por permisos o jerarquía.')
          await actual.delete(razon(mensaje))
          return `Rol **${textoSeguro(rol.name)}** eliminado.`
        },
      }
    }
    case 'agregarRol':
    case 'quitarRol': {
      const usuario = unaPersona(mensaje, botId)
      if (usuario.id === mensaje.author.id) throw new Error('No puedes asignarte o quitarte roles mediante esta función.')
      const rol = unRol(mensaje)
      if (rolNoAdministrable(rol)) throw new Error('Ese rol está protegido y no se puede asignar ni quitar mediante una mención.')
      const agregar = intencion === 'agregarRol'
      return {
        titulo: agregar ? 'Asignar un rol' : 'Quitar un rol',
        detalle: `Se ${agregar ? 'asignará' : 'quitará'} **${textoSeguro(rol.name)}** a **${textoSeguro(usuario.tag)}**.`,
        ejecutar: async () => {
          const [objetivo, actual] = await Promise.all([guild.members.fetch(usuario.id), guild.roles.fetch(rol.id)])
          if (!actual?.editable || !objetivo.manageable) throw new Error('El bot no puede modificar ese miembro o rol por permisos o jerarquía.')
          if (agregar && objetivo.roles.cache.has(rol.id)) return `**${textoSeguro(usuario.tag)}** ya tiene **${textoSeguro(rol.name)}**.`
          if (!agregar && !objetivo.roles.cache.has(rol.id)) return `**${textoSeguro(usuario.tag)}** no tiene **${textoSeguro(rol.name)}**.`
          if (agregar) await objetivo.roles.add(actual, razon(mensaje))
          else await objetivo.roles.remove(actual, razon(mensaje))
          return `Rol **${textoSeguro(rol.name)}** ${agregar ? 'asignado a' : 'quitado a'} **${textoSeguro(usuario.tag)}**.`
        },
      }
    }
    case 'crearCanal': {
      const tipo = /categoria/.test(normalizar(texto))
        ? ChannelType.GuildCategory
        : /\bvoz\b/.test(normalizar(texto))
          ? ChannelType.GuildVoice
          : ChannelType.GuildText
      const marcador = tipo === ChannelType.GuildCategory
        ? /(?:crea|crear|crees)\s+(?:una?\s+)?categor[ií]a\s+/i
        : /(?:crea|crear|crees)\s+(?:un\s+)?canal\s+(?:de\s+)?(?:texto|voz)\s+/i
      const nombre = nombreCanalDesde(texto, marcador)
      return {
        titulo: 'Crear canal o categoría',
        detalle: `Se creará ${tipo === ChannelType.GuildCategory ? 'la categoría' : 'el canal'} **#${textoSeguro(nombre)}**.`,
        ejecutar: async () => {
          const canal = await guild.channels.create({ name: nombre, type: tipo, reason: razon(mensaje) })
          return `${tipo === ChannelType.GuildCategory ? 'Categoría' : 'Canal'} **${textoSeguro(canal.name)}** creado: ${canal}.`
        },
      }
    }
    case 'renombrarCanal': {
      const canal = unCanal(mensaje)
      const nombre = nombreDesdeDespuesDeMencion(texto, canal.id)
      return {
        titulo: 'Renombrar canal',
        detalle: `**${textoSeguro(canal.name)}** pasará a llamarse **${textoSeguro(nombre)}**.`,
        ejecutar: async () => {
          const actual = await guild.channels.fetch(canal.id)
          if (!actual || !('name' in actual) || !('setName' in actual) || !actual.manageable) {
            throw new Error('El bot no puede editar ese canal por permisos.')
          }
          await actual.setName(nombre, razon(mensaje))
          return `Canal renombrado a **${textoSeguro(nombre)}**.`
        },
      }
    }
    case 'eliminarCanal': {
      const canal = unCanal(mensaje)
      if (canal.id === mensaje.channelId) throw new Error('Para eliminar este canal, pide la acción desde otro canal.')
      if ([
        config.canales.categoriaTickets,
        config.canales.logAdministracion,
        config.canales.logModeracion,
        config.canales.casosModeracion,
        config.canales.revision,
      ].includes(canal.id)) throw new Error('Ese canal está protegido porque el bot lo usa para registros del servidor.')
      return {
        titulo: 'Eliminar canal o categoría',
        detalle: `Se eliminará **${textoSeguro(canal.name)}**. Si es una categoría, sus canales quedarán sin categoría. Esta acción no se puede deshacer.`,
        ejecutar: async () => {
          const actual = await guild.channels.fetch(canal.id)
          if (!actual || !('name' in actual) || !('deletable' in actual) || !actual.deletable) {
            throw new Error('El bot no puede eliminar ese canal por permisos.')
          }
          const nombre = actual.name
          await actual.delete(razon(mensaje))
          return `Canal o categoría **${textoSeguro(nombre)}** eliminado.`
        },
      }
    }
    case 'permisoCanal': {
      const normalizado = normalizar(texto)
      const esDenegacion = /^(?:deniega|denegar|bloquea|quita|quitar|revoca|revocar)\b/.test(normalizado)
      const permiso =
        /\b(?:enviar mensajes|escribir)\b/.test(normalizado) ? 'SendMessages' :
          /\bhistorial\b/.test(normalizado) ? 'ReadMessageHistory' :
            /\bconectar\b/.test(normalizado) ? 'Connect' :
              /\bhablar\b/.test(normalizado) ? 'Speak' :
                /\bver\b/.test(normalizado) ? 'ViewChannel' : undefined
      if (!permiso) throw new Error('Permisos admitidos: ver canal, enviar mensajes, historial, conectar o hablar.')
      const bit = permiso === 'ViewChannel' ? PermissionFlagsBits.ViewChannel
        : permiso === 'SendMessages' ? PermissionFlagsBits.SendMessages
          : permiso === 'ReadMessageHistory' ? PermissionFlagsBits.ReadMessageHistory
            : permiso === 'Connect' ? PermissionFlagsBits.Connect
              : PermissionFlagsBits.Speak
      const canales = [...mensaje.mentions.channels.values()]
      const rol = unRol(mensaje)
      if (canales.length === 0) {
        if (rolAdministrativo(rol)) throw new Error('No se cambian permisos base de roles administrativos o de moderación.')
        return {
          titulo: esDenegacion ? 'Quitar permiso al rol' : 'Dar permiso al rol',
          detalle: `Se ${esDenegacion ? 'quitará' : 'dará'} **${permisoTexto(permiso)}** al rol **${textoSeguro(rol.name)}**.`,
          ejecutar: async () => {
            const actual = await guild.roles.fetch(rol.id)
            if (!actual?.editable) throw new Error('El bot no puede editar ese rol por permisos o jerarquía.')
            const permisos = new PermissionsBitField(actual.permissions.bitfield)
            if (esDenegacion && !permisos.has(bit)) return `El rol **${textoSeguro(actual.name)}** ya no tenía ese permiso.`
            if (!esDenegacion && permisos.has(bit)) return `El rol **${textoSeguro(actual.name)}** ya tenía ese permiso.`
            if (esDenegacion) permisos.remove(bit)
            else permisos.add(bit)
            await actual.edit({ permissions: permisos, reason: razon(mensaje) })
            return `Permiso **${permisoTexto(permiso)}** ${esDenegacion ? 'quitado al' : 'dado al'} rol **${textoSeguro(actual.name)}**.`
          },
        }
      }
      if (canales.length !== 1) throw new Error('Menciona exactamente un canal.')
      const canal = unCanal(mensaje)
      if (rolAdministrativo(rol)) throw new Error('No se cambian permisos de canal para roles administrativos o de moderación.')
      return {
        titulo: esDenegacion ? 'Denegar permiso en canal' : 'Permitir acceso en canal',
        detalle: `Se ${esDenegacion ? 'denegará' : 'permitirá'} **${permisoTexto(permiso)}** para **${textoSeguro(rol.name)}** en **${textoSeguro(canal.name)}**.`,
        ejecutar: async () => {
          const actual = await guild.channels.fetch(canal.id)
          const actualRol = await guild.roles.fetch(rol.id)
          if (!actual || !('permissionOverwrites' in actual) || !actual.manageable || !actualRol?.editable) {
            throw new Error('El bot no puede cambiar los permisos de ese canal o rol.')
          }
          const permitir = !esDenegacion
          const cambios = permiso === 'ViewChannel' ? { ViewChannel: permitir }
            : permiso === 'SendMessages' ? { SendMessages: permitir }
              : permiso === 'ReadMessageHistory' ? { ReadMessageHistory: permitir }
                : permiso === 'Connect' ? { Connect: permitir }
                  : { Speak: permitir }
          await actual.permissionOverwrites.edit(actualRol, cambios, { reason: razon(mensaje) })
          return `Permiso **${permisoTexto(permiso)}** ${permitir ? 'permitido' : 'denegado'} para **${textoSeguro(actualRol.name)}** en **${textoSeguro(actual.name)}**.`
        },
      }
    }
    case 'eliminarMensajes': {
      const cantidad = Number(texto.match(/\b(\d+)\s+mensajes?\b/i)?.[1])
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw new Error('Indica cuántos mensajes recientes eliminar (de 1 a 50).')
      const canal = mensaje.channel
      if (!('name' in canal) || typeof canal.name !== 'string' || !('messages' in canal) || !('bulkDelete' in canal)) {
        throw new Error('Esta acción solo funciona en canales de texto.')
      }
      return {
        titulo: 'Eliminar mensajes',
        detalle: `Se eliminarán hasta **${cantidad}** mensajes recientes de **${textoSeguro(canal.name)}**, excluyendo esta solicitud y su confirmación.`,
        ejecutar: async (confirmacion) => {
          const lote = await canal.messages.fetch({ limit: Math.min(100, cantidad + 5) })
          const objetivos = [...lote.values()]
            .filter((m) => m.id !== mensaje.id && m.id !== confirmacion.id)
            .slice(0, cantidad)
          if (!objetivos.length) return 'No hay mensajes recientes que eliminar.'
          if (objetivos.length === 1) {
            await objetivos[0]!.delete()
            return 'Eliminado **1** mensaje reciente.'
          }
          const eliminados = await canal.bulkDelete(objetivos.map((m) => m.id), true)
          return `Eliminados **${eliminados.size}** mensajes recientes.`
        },
      }
    }
    case 'fijarMensaje': {
      const enlace = texto.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i)
      const canalId = mensaje.channelId
      if (!canalId) throw new Error('No se pudo identificar el canal de esta solicitud.')
      if (enlace && enlace[2] !== canalId) throw new Error('El enlace debe apuntar a un mensaje de este mismo canal.')
      const idMensaje = enlace?.[3] ?? texto.replace(/<@!?(\d+)>/g, '').match(/\b\d{17,20}\b/)?.[0]
      if (!idMensaje) throw new Error('Indica el enlace o ID del mensaje que quieres fijar.')
      const canal = mensaje.channel
      if (!('name' in canal) || typeof canal.name !== 'string' || !('messages' in canal)) {
        throw new Error('Esta acción solo funciona en canales de texto.')
      }
      return {
        titulo: 'Fijar mensaje',
        detalle: `Se fijará el mensaje \`${idMensaje}\` en **${textoSeguro(canal.name)}**.`,
        ejecutar: async () => {
          const objetivo = await canal.messages.fetch(idMensaje)
          if (!objetivo.pinnable) throw new Error('No se puede fijar ese mensaje.')
          await objetivo.pin(razon(mensaje))
          return 'Mensaje fijado.'
        },
      }
    }
  }
}

function nombreDesdeDespuesDeMencion(texto: string, id: string) {
  const mention = new RegExp(`<[@#!&]*${id}>`)
  const match = mention.exec(texto)
  if (!match) throw new Error('Menciona el rol o canal que quieres editar.')
  const resto = texto.slice(match.index + match[0].length).replace(/^\s*(?:a|como|por)\s+/i, '')
  const entreComillas = resto.match(/["“]([^"”]{1,100})["”]/)?.[1]
  const nombre = (entreComillas ?? resto).replace(/^[\s"'“]+|[\s"'”.,!?]+$/g, '').trim()
  if (!nombre || nombre.length > 100) throw new Error('Indica el nuevo nombre entre comillas, por ejemplo `"Nuevo nombre"`.')
  return nombre
}

function permisoTexto(permiso: string) {
  const nombres: Record<string, string> = {
    ViewChannel: 'ver canal',
    SendMessages: 'enviar mensajes',
    ReadMessageHistory: 'ver historial',
    Connect: 'conectar',
    Speak: 'hablar',
  }
  return nombres[permiso] ?? permiso
}

function barrerConfirmacionesVencidas() {
  const ahora = Date.now()
  for (const [id, pendiente] of confirmacionesPendientes) {
    if (pendiente.venceEn <= ahora) confirmacionesPendientes.delete(id)
  }
}

export async function manejarSolicitudAdministrativa(mensaje: Message, texto: string, botId: string): Promise<boolean> {
  const intencion = detectarIntencion(texto)
  if (!intencion) return false
  if (mensaje.webhookId) {
    await responder(mensaje, 'Acción no permitida', 'Las acciones administrativas solo se aceptan desde mensajes directos de miembros.', coloresEmbed.error)
    return true
  }
  if (!mensaje.guild || !mensaje.member || !estaAutorizado(mensaje.member)) {
    await responder(mensaje, 'Acción no autorizada', 'Solo miembros de Fundación o Junta Administrativa pueden solicitar acciones administrativas.', coloresEmbed.error)
    return true
  }

  let operacion: OperacionAdministrativa
  try {
    operacion = crearOperacion(mensaje, limpiarPrefijo(texto), intencion, botId)
  } catch (error) {
    const detalle = error instanceof Error ? error.message : 'Revisa la solicitud y vuelve a intentarlo.'
    await responder(mensaje, 'Solicitud incompleta', detalle, coloresEmbed.aviso)
    return true
  }

  barrerConfirmacionesVencidas()
  const id = randomUUID()
  const fila = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ia-admin:confirmar:${id}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ia-admin:cancelar:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  )
  try {
    const confirmacion = await mensaje.reply(comoComponentsV2({
      content: `<@${mensaje.author.id}>`,
      embeds: [crearEmbed('Confirmación administrativa', `${operacion.detalle}\n\nConfirma en los próximos 2 minutos para ejecutarlo.`)],
      components: [fila],
      allowedMentions: { users: [mensaje.author.id], parse: [] },
    }))
    confirmacionesPendientes.set(id, {
      usuarioId: mensaje.author.id,
      servidorId: mensaje.guild.id,
      venceEn: Date.now() + tiempoConfirmacionMs,
      mensaje: confirmacion,
      ejecutar: operacion.ejecutar,
    })
  } catch (error) {
    console.error('[IA administración] No se pudo enviar la confirmación:', error)
    await responder(mensaje, 'No se pudo confirmar la acción', 'No pude publicar los botones de confirmación. Revisa los permisos del bot en este canal.', coloresEmbed.error)
  }
  return true
}

export async function manejarConfirmacionAdministrativa(interaccion: ButtonInteraction): Promise<boolean> {
  const [prefijo, accion, id] = interaccion.customId.split(':')
  if (prefijo !== 'ia-admin' || !id || (accion !== 'confirmar' && accion !== 'cancelar')) return false
  barrerConfirmacionesVencidas()
  const pendiente = confirmacionesPendientes.get(id)
  if (!pendiente) {
    await interaccion.reply({ content: 'Esta confirmación venció o ya fue utilizada.', flags: MessageFlags.Ephemeral })
    return true
  }
  if (
    interaccion.user.id !== pendiente.usuarioId ||
    !interaccion.inCachedGuild() ||
    interaccion.guildId !== pendiente.servidorId ||
    !estaAutorizado(interaccion.member)
  ) {
    await interaccion.reply({
      content: 'Solo quien solicitó la acción, mientras conserve su autorización, puede confirmarla.',
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  confirmacionesPendientes.delete(id)
  if (accion === 'cancelar') {
    await interaccion.update(comoComponentsV2({
      content: `<@${interaccion.user.id}>`,
      embeds: [crearEmbed('Acción cancelada', 'No se realizó ningún cambio.', coloresEmbed.neutro)],
      allowedMentions: { users: [interaccion.user.id], parse: [] },
    }))
    return true
  }

  await interaccion.deferUpdate()
  try {
    const resultado = await pendiente.ejecutar(pendiente.mensaje)
    await interaccion.editReply(comoComponentsV2({
      content: `<@${interaccion.user.id}>`,
      embeds: [crearEmbed('Acción ejecutada', resultado, coloresEmbed.exito)],
      allowedMentions: { users: [interaccion.user.id], parse: [] },
    }))
  } catch (error) {
    console.error('[IA administración] Falló una acción confirmada:', error)
    const detalle = error instanceof Error ? error.message : 'Revisa los permisos del bot y la jerarquía de roles.'
    await interaccion.editReply(comoComponentsV2({
      content: `<@${interaccion.user.id}>`,
      embeds: [crearEmbed('No se pudo ejecutar la acción', textoSeguro(detalle), coloresEmbed.error)],
      allowedMentions: { users: [interaccion.user.id], parse: [] },
    }))
  }
  return true
}
