import { randomUUID } from 'node:crypto'
import {
  AttachmentBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  InteractionContextType,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  VoiceChannel,
} from 'discord.js'
import { config } from '../config'
import { crearEmbed, coloresEmbed } from '../utils/embeds'
import { comoComponentsV2, editarComponentsV2 } from '../utils/components-v2'
import {
  eliminarArchivosGrabacion,
  GrabadorSoporte,
  limitePistasGrabacion,
} from '../utils/soporte-grabacion'
import { reproducirAnuncioSoporte } from '../utils/soporte-tts'

const efimero = MessageFlags.Ephemeral
const comandoGuild = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)

const grabarData = comandoGuild('grabar', 'Anuncia por voz e inicia la grabación del canal de voz actual')
const pararGrabacionData = comandoGuild('parar-grabacion', 'Detiene la grabación y envía el audio por mensaje privado')

interface GrabacionDirecta {
  id: string
  guild: Guild
  canalVoz: VoiceChannel
  solicitanteId: string
  participantes: string[]
  directorioGrabaciones: string
  aviso: Message
  grabador: GrabadorSoporte
  finalizando: boolean
}

const grabacionesActivas = new Map<string, GrabacionDirecta>()
const grabacionesIniciandose = new Set<string>()

export const grabacionDirecta = [
  { data: grabarData, execute: ejecutarGrabar },
  { data: pararGrabacionData, execute: ejecutarPararGrabacion },
]

async function ejecutarGrabar(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) {
    return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  }
  if (!esStaff(i)) {
    return i.reply({ content: 'Este comando requiere permisos de staff.', flags: efimero })
  }
  await i.deferReply({ flags: efimero })

  const directorioGrabaciones = config.grabaciones.directorio
  if (!directorioGrabaciones) {
    return i.editReply('La grabación no está disponible: falta configurar el volumen persistente.')
  }
  if (grabacionesActivas.has(i.guildId) || grabacionesIniciandose.has(i.guildId)) {
    return i.editReply('Ya hay una grabación activa o en preparación en este servidor.')
  }
  grabacionesIniciandose.add(i.guildId)
  let aviso: Message | undefined
  let grabador: GrabadorSoporte | undefined
  let activa: GrabacionDirecta | undefined
  let errorConexion: Error | undefined
  let capturaLista = false
  const grabacionId = randomUUID()

  try {
    if (!i.channel?.isSendable()) {
      return await i.editReply('No puedo publicar el aviso de grabación en este canal.')
    }

    const canalVoz = i.member.voice.channel
    if (!canalVoz || canalVoz.type !== ChannelType.GuildVoice) {
      return await i.editReply('Debes estar conectado a un canal de voz normal para iniciar la grabación.')
    }
    const permisosBot = (await i.guild.members.fetchMe()).permissionsIn(canalVoz)
    if (
      !permisosBot.has(PermissionFlagsBits.ViewChannel) ||
      !permisosBot.has(PermissionFlagsBits.Connect) ||
      !permisosBot.has(PermissionFlagsBits.Speak) ||
      !permisosBot.has(PermissionFlagsBits.MuteMembers)
    ) {
      return await i.editReply('Necesito Ver canal, Conectar, Hablar y Silenciar miembros para anunciar e iniciar la grabación.')
    }

    const participantes = [...canalVoz.members.values()]
      .filter((miembro) => !miembro.user.bot)
      .map((miembro) => miembro.id)
    if (!participantes.length) {
      return await i.editReply('No hay participantes humanos en el canal de voz.')
    }
    if (participantes.length > limitePistasGrabacion) {
      return await i.editReply(`Este sistema admite hasta ${limitePistasGrabacion} participantes por grabación.`)
    }

    aviso = await i.channel.send(comoComponentsV2({
      embeds: [crearEmbed(
        'Aviso de grabación de audio',
        `Se anunciará por voz el inicio de una grabación en <#${canalVoz.id}>. La captura incluirá las pistas de quienes están presentes al comenzar.\n\nParticipantes: ${participantes.map((id) => `<@${id}>`).join(', ')}`,
        coloresEmbed.aviso,
      )],
      allowedMentions: { users: participantes, parse: [] },
    }))

    await reproducirAnuncioSoporte(
      canalVoz,
      'Atención. Las voces de las personas presentes en este canal serán grabadas desde ahora. El staff puede detener la grabación con el comando correspondiente.',
    )

    grabador = await GrabadorSoporte.conectar(
      i.guild,
      canalVoz,
      directorioGrabaciones,
      config.grabaciones.retencionDias,
      grabacionId,
      participantes,
      [],
      {
        conexionError: (error) => {
          errorConexion = error
          console.error(`[Grabación ${grabacionId}] Se perdió la conexión de voz:`, error)
          if (capturaLista && activa) {
            void finalizarYEnviarPorDM(activa).catch((errorFinalizacion: unknown) => {
              console.error(`[Grabación ${grabacionId}] No se pudo cerrar tras perder la conexión:`, errorFinalizacion)
            })
          }
        },
        primerPaquete: () => undefined,
      },
      'directa',
    )

    activa = {
      id: grabacionId,
      guild: i.guild,
      canalVoz,
      solicitanteId: i.user.id,
      participantes,
      directorioGrabaciones,
      aviso,
      grabador,
      finalizando: false,
    }

    if (errorConexion) throw errorConexion
    await grabador.iniciarCaptura(participantes)
    if (errorConexion) throw errorConexion
    await grabador.actualizarEstado('PAUSADA')
    if (errorConexion) throw errorConexion

    await actualizarAviso(
      aviso,
      'Grabación iniciada',
      `La captura está activa en **${canalVoz.name}**. Para detenerla, usa \`/parar-grabacion\`.\n\nPistas incluidas: ${participantes.map((id) => `<@${id}>`).join(', ')}`,
      coloresEmbed.exito,
    )
    if (errorConexion) throw errorConexion

    grabacionesActivas.set(i.guildId, activa)
    capturaLista = true
  } catch (error) {
    console.error(`[Grabación ${grabacionId}] No se pudo iniciar la captura:`, error)
    if (activa && grabacionesActivas.get(i.guildId) === activa) {
      grabacionesActivas.delete(i.guildId)
    }
    if (grabador) {
      await grabador.finalizar().catch((errorFinalizacion: unknown) => {
        console.error(`[Grabación ${grabacionId}] No se pudo limpiar el grabador:`, errorFinalizacion)
      })
    }
    await eliminarArchivosGrabacion(directorioGrabaciones, grabacionId).catch((errorLimpieza: unknown) => {
      console.error(`[Grabación ${grabacionId}] No se pudieron limpiar los archivos:`, errorLimpieza)
    })
    if (aviso) {
      await actualizarAviso(
        aviso,
        'Grabación no iniciada',
        'No se pudo completar el aviso o preparar la captura. No se conservará audio.',
        coloresEmbed.error,
      )
    }
    return i.editReply('No se pudo iniciar la grabación. Revisa los logs del bot.')
  } finally {
    grabacionesIniciandose.delete(i.guildId)
  }

  return i.editReply('Grabación iniciada. Usa `/parar-grabacion` para detenerla y recibir el audio por DM.')
}

async function actualizarAviso(
  mensaje: Message,
  titulo: string,
  descripcion: string,
  color: number,
): Promise<void> {
  await editarComponentsV2(mensaje, {
    embeds: [crearEmbed(titulo, descripcion, color)],
    allowedMentions: { parse: [] },
  }).catch((error: unknown) => {
    console.error('[Grabación directa] No se pudo actualizar el aviso:', error)
  })
}

async function ejecutarPararGrabacion(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) {
    return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  }
  if (!esStaff(i)) {
    return i.reply({ content: 'Este comando requiere permisos de staff.', flags: efimero })
  }
  await i.deferReply({ flags: efimero })
  const activa = grabacionesActivas.get(i.guildId)
  if (!activa && grabacionesIniciandose.has(i.guildId)) {
    return i.editReply('La grabación todavía se está preparando; aún no hay una captura que detener.')
  }
  if (!activa) return i.editReply('No hay una grabación activa en este servidor.')

  try {
    const resultado = await finalizarYEnviarPorDM(activa)
    if (resultado === 'sin-audio') {
      return i.editReply('La grabación terminó, pero no se recibió audio. No se envió ningún archivo.')
    }
    return i.editReply(`Grabación detenida. El audio se envió por DM a <@${activa.solicitanteId}>.`)
  } catch (error) {
    console.error(`[Grabación ${activa.id}] No se pudo detener o enviar el audio por DM:`, error)
    return i.editReply('La grabación terminó, pero no se pudo enviar el audio por DM. Comprueba que esa cuenta acepte mensajes privados.')
  }
}

async function finalizarYEnviarPorDM(activa: GrabacionDirecta): Promise<'enviado' | 'sin-audio'> {
  if (activa.finalizando) throw new Error('La finalización de la grabación ya está en curso.')
  activa.finalizando = true
  if (grabacionesActivas.get(activa.guild.id) === activa) grabacionesActivas.delete(activa.guild.id)
  try {
    const resultado = await activa.grabador.finalizar()
    if (!resultado.mezclaPath) {
      await actualizarAviso(
        activa.aviso,
        'Grabación detenida',
        'La captura terminó, pero no se recibió audio para enviar.',
        coloresEmbed.neutro,
      )
      return 'sin-audio'
    }
    const solicitante = await activa.guild.client.users.fetch(activa.solicitanteId)
    await solicitante.send({
      content: `Grabación de voz finalizada en **${activa.canalVoz.name}**. Pistas incluidas: ${activa.participantes.map((id) => `<@${id}>`).join(', ')}.`,
      files: [new AttachmentBuilder(resultado.mezclaPath, {
        name: `grabacion-${activa.id}.ogg`,
      })],
      allowedMentions: { parse: [] },
    })
    await actualizarAviso(
      activa.aviso,
      'Grabación finalizada',
      `El audio se envió por DM a <@${activa.solicitanteId}>.`,
      coloresEmbed.neutro,
    )
    return 'enviado'
  } catch (error) {
    await actualizarAviso(
      activa.aviso,
      'Grabación finalizada con inconvenientes',
      'No se pudo completar o entregar el audio. Se intentará eliminar la copia local.',
      coloresEmbed.error,
    )
    throw error
  } finally {
    await eliminarArchivosGrabacion(activa.directorioGrabaciones, activa.id).catch((error: unknown) => {
      console.error(`[Grabación ${activa.id}] No se pudieron eliminar los archivos locales tras finalizar:`, error)
    })
  }
}

function esStaff(i: ChatInputCommandInteraction): boolean {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  if (!i.inCachedGuild()) return false
  return [
    process.env.ROL_STAFF_ID,
    process.env.ROL_MODERADOR_ID,
    process.env.ROL_SOPORTE_ID,
    process.env.ROL_ADMIN_ID,
  ].some((id) => !!id && i.member.roles.cache.has(id))
}
