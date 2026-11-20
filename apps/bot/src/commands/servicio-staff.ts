import { randomUUID } from 'node:crypto'
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  InteractionContextType,
  Message,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  VoiceChannel,
  VoiceState,
  ModalSubmitInteraction,
} from 'discord.js'
import {
  EstadoGrabacionServicioStaff,
  EstadoServicioStaff,
  OrigenGrabacionServicioStaff,
  Prisma,
  TipoActividadServicioStaff,
  db,
} from '@rp-chile/db'
import { config } from '../config'
import { coloresEmbed, crearEmbed } from '../utils/embeds'
import {
  GrabadorSoporte,
  eliminarArchivosGrabacion,
  limitePistasGrabacion,
} from '../utils/soporte-grabacion'
import { reproducirAnuncioSoporte } from '../utils/soporte-tts'
import {
  calcularDuracionMs,
  construirInformeServicioStaff,
  crearServicioStaff,
  formatearDuracion,
  guardarGrabacionServicioStaff,
  guardarInformeServicioStaff,
  guardarPanelServicioStaff,
  cancelarServicioStaffEnEspera,
  marcarGrabacionesStaffInterrumpidas,
  obtenerServicioEnCurso,
  obtenerServicioStaff,
  obtenerServiciosEnCurso,
  registrarMovimientoServicioStaff,
  activarServicioStaff,
  iniciarFinalizacionServicioStaff,
  completarServicioStaff,
} from '../utils/servicio-staff'
import { parsearIdsDiscord } from '../utils/servicio-staff-modelo'
import { reservarCapturaVoz, liberarCapturaVoz } from '../utils/registro-captura-voz'
import {
  construirBienvenidaSoporte,
  ParticipantesSoporte,
  puedeIniciarSoporte,
  tituloResponsableSoporte,
  validarParticipantesSoporte,
} from '../utils/soporte'
import { crearSoporteDesdePanelPrivado } from './soporte'

const canalAsistenciaStaffId = '1571736084558258198'
const canalInformeServicioId = '1573152199251591218'
const comandoData = new SlashCommandBuilder()
  .setName('iniciar-servicio-staff')
  .setDescription('Inicia tu servicio Staff al ingresar a Asistencia Staff')
  .setContexts(InteractionContextType.Guild)

interface GrabacionAsistenciaActiva {
  id: string
  guild: Guild
  canal: VoiceChannel
  grabador: GrabadorSoporte
  participantes: Set<string>
  servicios: Set<string>
  serviciosEnAsistencia: Set<string>
  iniciadaEn: Date
  finalizando: boolean
}

const grabacionesAsistencia = new Map<string, GrabacionAsistenciaActiva>()
const serviciosIniciando = new Set<string>()
const finalizacionesEnCurso = new Set<string>()
const cambiosVozEnCola = new Map<string, Promise<void>>()
const bienvenidasAsistenciaEnCurso = new Set<string>()
let temporizadorPaneles: NodeJS.Timeout | undefined

export const servicioStaff = { data: comandoData, execute: ejecutarIniciarServicio }

async function ejecutarIniciarServicio(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) {
    return i.reply({ content: 'Usa este comando dentro del servidor.', flags: MessageFlags.Ephemeral })
  }
  if (!esStaffAutorizado(i.member)) {
    return i.reply({ content: 'Este comando requiere permisos de Staff.', flags: MessageFlags.Ephemeral })
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral })

  if (!config.grabaciones.directorio) {
    return i.editReply('No se puede iniciar el servicio: falta configurar el volumen persistente de grabaciones.')
  }
  if (!i.channel?.isSendable()) {
    return i.editReply('Necesito un canal de texto donde publicar el aviso institucional del servicio.')
  }

  const asistencia = await i.guild.channels.fetch(canalAsistenciaStaffId)
  if (!asistencia || asistencia.type !== ChannelType.GuildVoice) {
    return i.editReply('El canal de Asistencia Staff configurado no existe o no es un canal de voz válido.')
  }

  const servicioExistente = await obtenerServicioEnCurso(i.guildId, i.user.id)
  if (servicioExistente) {
    return i.editReply(
      `Ya tienes un servicio ${servicioExistente.estado === EstadoServicioStaff.ESPERANDO_VOZ ? 'esperando que ingreses a Asistencia Staff' : 'activo o en proceso de finalización'} (\`${servicioExistente.id}\`).`,
    )
  }

  const dm = await i.user.createDM().catch((error: unknown) => {
    console.error(`[Servicio Staff] No se pudo abrir el DM de ${i.user.id}:`, error)
    return null
  })
  if (!dm) {
    return i.editReply('No pude abrirte un mensaje privado. Activa los DM del servidor e inténtalo nuevamente.')
  }

  let servicio
  try {
    servicio = await crearServicioStaff({
      guildId: i.guildId,
      staffDiscordId: i.user.id,
      staffNombre: i.member.displayName,
      canalAsistenciaId: asistencia.id,
      canalAvisoId: i.channel.id,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return i.editReply('Ya tienes un servicio Staff pendiente o activo.')
    }
    console.error(`[Servicio Staff] No se pudo registrar el servicio de ${i.user.id}:`, error)
    return i.editReply('No se pudo registrar el servicio. Revisa los logs del bot.')
  }

  try {
    const panel = await dm.send({
      embeds: [crearPanelServicio(servicio, [], [], Date.now())],
      components: componentesPanelServicio(servicio),
      allowedMentions: { parse: [] },
    })
    await guardarPanelServicioStaff(servicio.id, dm.id, panel.id)
  } catch (error) {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo crear el panel privado:`, error)
    await db.servicioStaff.delete({ where: { id: servicio.id } }).catch((errorLimpieza: unknown) => {
      console.error(`[Servicio Staff ${servicio.id}] No se pudo retirar el servicio sin panel:`, errorLimpieza)
    })
    return i.editReply('No pude enviar el panel por DM; no se inició el servicio. Revisa tus mensajes privados.')
  }

  await i.editReply(
    `Servicio registrado. Ingresa al canal <#${asistencia.id}>; al detectar tu entrada, el bot se conectará y comenzará el servicio.`,
  )
}

export async function manejarInteraccionServicioStaff(
  i: ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!i.customId.startsWith('servicio-staff:')) return false
  const [prefijo, accion, servicioId] = i.customId.split(':')
  if (prefijo !== 'servicio-staff' || !accion || !servicioId) {
    await i.reply({ content: 'Esta interacción de servicio no es válida.' })
    return true
  }

  const servicio = await obtenerServicioStaff(servicioId)
  if (!servicio || servicio.staffDiscordId !== i.user.id) {
    await i.reply({ content: 'Este servicio no existe o no te pertenece.' })
    return true
  }
  const guild = await i.client.guilds.fetch(servicio.guildId)
  const miembro = await guild.members.fetch(i.user.id)
  if (!esStaffAutorizado(miembro)) {
    await i.reply({ content: 'Tu autorización Staff ya no está vigente; no se modificó el servicio.' })
    return true
  }

  if (i.isButton()) {
    if (accion === 'cancelar') {
      if (servicio.estado !== EstadoServicioStaff.ESPERANDO_VOZ) {
        await i.reply({ content: 'Solo se puede cancelar un servicio que aún espera el ingreso a voz.' })
        return true
      }
      const cancelado = await cancelarServicioStaffEnEspera(servicio.id, new Date())
      if (cancelado.count === 0) {
        await i.reply({ content: 'El servicio cambió de estado; actualiza el panel antes de intentarlo.' })
        return true
      }
      await actualizarPanelPorId(i.client, servicio.id)
      await i.reply({ content: 'Se canceló la espera. No se conectó el bot ni se grabó audio.' })
      return true
    }
    if (accion === 'finalizar') {
      await finalizarServicioDesdePanel(i, servicio)
      return true
    }
    if (accion === 'soporte') {
      if (servicio.estado !== EstadoServicioStaff.ACTIVO) {
        await i.reply({ content: 'El servicio debe estar activo para iniciar un soporte.' })
        return true
      }
      const modal = crearModalSoporte(servicio.id)
      await i.showModal(modal)
      return true
    }
    await i.reply({ content: 'La acción solicitada no es válida.' })
    return true
  }

  if (accion !== 'soporte-formulario') {
    await i.reply({ content: 'La acción solicitada no es válida.' })
    return true
  }
  await procesarModalSoporte(i, servicio)
  return true
}

async function procesarModalSoporte(
  i: ModalSubmitInteraction,
  servicio: NonNullable<Awaited<ReturnType<typeof obtenerServicioStaff>>>,
): Promise<void> {
  if (servicio.estado !== EstadoServicioStaff.ACTIVO) {
    await i.reply({ content: 'El servicio ya no está activo; no se creó ningún soporte.' })
    return
  }

  let participantes: ParticipantesSoporte
  try {
    participantes = {
      reportantes: { usuarios: parsearIdsDiscord(i.fields.getTextInputValue('reportantes')) },
      reportados: { usuarios: parsearIdsDiscord(i.fields.getTextInputValue('reportados')) },
      testigos: { usuarios: parsearIdsDiscord(i.fields.getTextInputValue('testigos')) },
    }
  } catch (error) {
    await i.reply({
      content: error instanceof Error ? error.message : 'Los IDs ingresados no son válidos.',
    })
    return
  }
  const errorValidacion = validarParticipantesSoporte(participantes)
  if (errorValidacion) {
    await i.reply({ content: `${errorValidacion} No se creó ningún canal.` })
    return
  }

  await i.deferReply()
  const guild = await i.client.guilds.fetch(servicio.guildId)
  try {
    const soporte = await crearSoporteDesdePanelPrivado(guild, i.user.id, participantes)
    await i.editReply(
      `Soporte **${soporte.id}** habilitado y asociado al servicio \`${servicio.id}\`.\n` +
      `Sala de reunión: <#${soporte.canalVozId}>\nCanal de evidencias: <#${soporte.canalEvidenciasId}>`,
    )
    await actualizarPanelPorId(i.client, servicio.id)
  } catch (error) {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo crear el soporte desde el panel DM:`, error)
    await i.editReply(
      error instanceof Error
        ? `No se pudo crear el soporte: ${error.message}`
        : 'No se pudo crear el soporte. Revisa los logs del bot.',
    )
  }
}

function crearModalSoporte(servicioId: string): ModalBuilder {
  const campo = (
    id: string,
    etiqueta: string,
    requerido: boolean,
  ) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(etiqueta)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('IDs de Discord o menciones separados por coma')
      .setMaxLength(100)
      .setRequired(requerido),
  )
  return new ModalBuilder()
    .setCustomId(`servicio-staff:soporte-formulario:${servicioId}`)
    .setTitle('Iniciar soporte institucional')
    .addComponents(
      campo('reportantes', 'Personas que reportan (máximo 3)', true),
      campo('reportados', 'Personas reportadas (máximo 3)', true),
      campo('testigos', 'Testigos (opcional, máximo 3)', false),
    )
}

export async function manejarEstadoVozServicioStaff(
  anterior: VoiceState,
  nuevo: VoiceState,
): Promise<void> {
  if (anterior.channelId === nuevo.channelId) return
  const guildId = nuevo.guild.id
  const previo = cambiosVozEnCola.get(guildId) ?? Promise.resolve()
  const operacion = previo
    .catch(() => undefined)
    .then(() => procesarCambioVozServicio(anterior, nuevo))
  cambiosVozEnCola.set(guildId, operacion)
  try {
    await operacion
  } finally {
    if (cambiosVozEnCola.get(guildId) === operacion) cambiosVozEnCola.delete(guildId)
  }
}

async function procesarCambioVozServicio(anterior: VoiceState, nuevo: VoiceState): Promise<void> {
  if (anterior.channelId === canalAsistenciaStaffId && nuevo.channelId !== canalAsistenciaStaffId) {
    bienvenidasAsistenciaEnCurso.delete(`${nuevo.guild.id}:${canalAsistenciaStaffId}:${nuevo.id}`)
  }
  const grabacionEnCanal = grabacionesAsistencia.get(nuevo.guild.id)
  if (
    grabacionEnCanal &&
    nuevo.channelId === grabacionEnCanal.canal.id &&
    anterior.channelId !== nuevo.channelId
  ) {
    await agregarParticipanteServicio(nuevo, grabacionEnCanal)
    await anunciarBienvenidaAsistencia(nuevo.guild, grabacionEnCanal.canal, nuevo.id)
  }

  const servicio = await obtenerServicioEnCurso(nuevo.guild.id, nuevo.id)
  if (!servicio) return
  const estadoAnterior = anterior.channelId
  const estadoNuevo = nuevo.channelId

  if (
    servicio.estado === EstadoServicioStaff.ESPERANDO_VOZ &&
    estadoNuevo === servicio.canalAsistenciaId
  ) {
    await iniciarServicioAlIngresar(servicio.id, nuevo.guild, nuevo.id)
    return
  }

  if (servicio.estado !== EstadoServicioStaff.ACTIVO) return
  if (estadoAnterior === estadoNuevo) return

  const anteriorNombre = describirCanalServicio(servicio, estadoAnterior)
  const nuevoNombre = describirCanalServicio(servicio, estadoNuevo)
  await registrarMovimientoServicioStaff({
    servicioId: servicio.id,
    canalAnteriorId: estadoAnterior,
    canalNuevoId: estadoNuevo,
    detalle: `${anteriorNombre} → ${nuevoNombre}`,
  }).catch((error: unknown) => {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo registrar un cambio de voz:`, error)
  })

  if (estadoAnterior === servicio.canalAsistenciaId && estadoNuevo !== servicio.canalAsistenciaId) {
    await retirarServicioDeGrabacion(servicio.id, nuevo.guild.id)
  }
  if (estadoNuevo === servicio.canalAsistenciaId) {
    await iniciarOAsociarGrabacion(servicio.id, nuevo.guild, nuevo.id, false)
  }
  await actualizarPanelPorId(nuevo.client, servicio.id)
}

function describirCanalServicio(
  servicio: NonNullable<Awaited<ReturnType<typeof obtenerServicioStaff>>>,
  canalId: string | null,
): string {
  if (!canalId) return 'desconexión de voz'
  if (canalId === servicio.canalAsistenciaId) return 'Asistencia Staff'
  const soporte = servicio.actividades.find((actividad) =>
    actividad.tipo === TipoActividadServicioStaff.SOPORTE &&
    actividad.canalNuevoId === canalId,
  )
  if (soporte) return `voz del soporte ${soporte.soporteId}`
  return `otro canal de voz ${canalId}`
}

async function iniciarServicioAlIngresar(servicioId: string, guild: Guild, staffId: string): Promise<void> {
  if (serviciosIniciando.has(servicioId)) return
  serviciosIniciando.add(servicioId)
  try {
    await iniciarOAsociarGrabacion(servicioId, guild, staffId, true)
  } finally {
    serviciosIniciando.delete(servicioId)
  }
}

async function iniciarOAsociarGrabacion(
  servicioId: string,
  guild: Guild,
  staffId: string,
  activarServicio: boolean,
): Promise<void> {
  const servicio = await obtenerServicioStaff(servicioId)
  if (
    !servicio ||
    (servicio.estado !== EstadoServicioStaff.ESPERANDO_VOZ &&
      servicio.estado !== EstadoServicioStaff.ACTIVO)
  ) return
  const directorioGrabaciones = config.grabaciones.directorio
  if (!directorioGrabaciones) {
    await informarErrorInicio(servicio, guild, 'No está configurado el volumen persistente de grabaciones.')
    return
  }

  const miembro = await guild.members.fetch(staffId)
  if (!esStaffAutorizado(miembro)) {
    await informarErrorInicio(servicio, guild, 'Tu autorización Staff cambió; no se inició la grabación.')
    return
  }
  if (miembro.voice.channelId !== servicio.canalAsistenciaId) return
  const canal = await guild.channels.fetch(servicio.canalAsistenciaId)
  if (!canal || canal.type !== ChannelType.GuildVoice) {
    await informarErrorInicio(servicio, guild, 'No se encontró el canal de Asistencia Staff.')
    return
  }

  const canalAviso = await guild.channels.fetch(servicio.canalAvisoId)
  if (!canalAviso?.isSendable()) {
    await informarErrorInicio(servicio, guild, 'No pude publicar el aviso en el canal de texto donde se inició el servicio.')
    return
  }

  const participantes = [...new Set([
    ...[...canal.members.values()]
      .filter((persona) => !persona.user.bot)
      .map((persona) => persona.id),
    staffId,
  ])]
  if (!participantes.length || participantes.length > limitePistasGrabacion) {
    await informarErrorInicio(
      servicio,
      guild,
      participantes.length
        ? `La grabación admite hasta ${limitePistasGrabacion} pistas; hay ${participantes.length} personas en el canal.`
        : 'No se encontraron participantes humanos en el canal para iniciar la captura.',
    )
    return
  }

  const bot = await guild.members.fetchMe()
  const permisos = bot.permissionsIn(canal)
  if (
    !permisos.has(PermissionFlagsBits.ViewChannel) ||
    !permisos.has(PermissionFlagsBits.Connect) ||
    !permisos.has(PermissionFlagsBits.Speak) ||
    !permisos.has(PermissionFlagsBits.MuteMembers)
  ) {
    await informarErrorInicio(servicio, guild, 'El bot necesita Ver canal, Conectar, Hablar y Silenciar miembros en Asistencia Staff.')
    return
  }

  try {
    await canalAviso.send({
      embeds: [crearEmbed(
        activarServicio ? 'Servicio Staff iniciado' : 'Grabación de servicio Staff reanudada',
        activarServicio
          ? `**${servicio.staffNombre}** inició su servicio en <#${canal.id}>. Se realizará una grabación de audio; el aviso también se anunciará por voz.`
          : `La grabación de Asistencia Staff se reanuda para **${servicio.staffNombre}** en <#${canal.id}>.`,
        coloresEmbed.aviso,
      )],
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo publicar el aviso institucional:`, error)
    await informarErrorInicio(servicio, guild, 'No se pudo publicar el aviso visible de grabación.')
    return
  }

  let grabacion = grabacionesAsistencia.get(guild.id)
  if (!grabacion) {
    const grabacionId = randomUUID()
    if (!reservarCapturaVoz(canal.id, grabacionId)) {
      await informarErrorInicio(servicio, guild, 'Ya existe otra captura activa en el canal de Asistencia Staff.')
      return
    }
    let sesionCreada: GrabacionAsistenciaActiva | undefined
    let errorConexion: Error | undefined
    let capturaLista = false
    try {
      const grabador = await GrabadorSoporte.conectar(
        guild,
        canal,
        directorioGrabaciones,
        config.grabaciones.retencionDias,
        grabacionId,
        participantes,
        [],
        {
          conexionError: (error) => {
            errorConexion = error
            console.error(`[Servicio Staff ${servicioId}] Se perdió la conexión de voz:`, error)
            if (capturaLista && sesionCreada) {
              void finalizarGrabacionAsistencia(sesionCreada, EstadoGrabacionServicioStaff.INTERRUMPIDA)
                .catch((errorFinalizacion: unknown) => {
                  console.error(`[Servicio Staff ${servicioId}] No se pudo guardar la interrupción de audio:`, errorFinalizacion)
                })
            }
          },
          primerPaquete: () => undefined,
        },
        'servicio-staff',
      )
      sesionCreada = {
        id: grabacionId,
        guild,
        canal,
        grabador,
        participantes: new Set(participantes),
        servicios: new Set(),
        serviciosEnAsistencia: new Set(),
        iniciadaEn: new Date(),
        finalizando: false,
      }
      const tituloInicial = tituloResponsableSoporte(
        miembro.permissions.has(PermissionFlagsBits.Administrator),
        [...miembro.roles.cache.keys()],
        {
          fundador: config.roles.fundacion,
          juntaAdministrativa: config.roles.juntaAdministrativa,
          admin: config.roles.admin,
          moderador: config.roles.moderador,
        },
      )
      const bienvenidaInicial = construirBienvenidaSoporte(
        miembro.displayName,
        tituloInicial,
      ).replace('Bienvenido al soporte oficial', 'Bienvenido al canal de Asistencia Staff oficial')
      await reproducirAnuncioSoporte(
        canal,
        `${bienvenidaInicial} Atención. Se inicia el servicio de Staff de ${servicio.staffNombre}. Este canal de voz está siendo grabado.`,
        grabador.conexion,
      )
      const inicioCaptura = new Date()
      await grabador.iniciarCaptura(participantes)
      await grabador.actualizarEstado('GRABANDO')
      sesionCreada.iniciadaEn = inicioCaptura
      if (errorConexion) throw errorConexion
      grabacion = sesionCreada
      capturaLista = true
      grabacionesAsistencia.set(guild.id, grabacion)
    } catch (error) {
      console.error(`[Servicio Staff ${servicioId}] No se pudo iniciar la grabación de Asistencia Staff:`, error)
      if (sesionCreada) {
        await sesionCreada.grabador.finalizar().catch((errorFinalizacion: unknown) => {
          console.error(`[Servicio Staff ${servicioId}] No se pudo limpiar la conexión de voz:`, errorFinalizacion)
        })
      }
      liberarCapturaVoz(canal.id, grabacionId)
      await eliminarArchivosGrabacion(directorioGrabaciones, grabacionId).catch((errorLimpieza: unknown) => {
        console.error(`[Servicio Staff ${servicioId}] No se pudieron limpiar los archivos incompletos:`, errorLimpieza)
      })
      await informarErrorInicio(servicio, guild, 'No se pudo iniciar la captura de voz. El servicio sigue esperando; sal y vuelve a entrar a Asistencia Staff después de revisar los logs.')
      return
    }
  } else {
    try {
      await reproducirAnuncioSoporte(
        canal,
        `Atención. ${servicio.staffNombre} inicia su servicio Staff. Este canal de voz continúa siendo grabado.`,
        grabacion.grabador.conexion,
      )
    } catch (error) {
      console.error(`[Servicio Staff ${servicio.id}] No se pudo anunciar el inicio por TTS:`, error)
      await informarErrorInicio(servicio, guild, 'No se pudo reproducir el anuncio TTS; no se inició el servicio.')
      return
    }
  }

  if (!grabacion) return
  const inicio = new Date()
  if (activarServicio) {
    const actualizado = await activarServicioStaff(servicio.id, inicio)
    if (actualizado.count === 0) return
  }

  grabacion.servicios.add(servicio.id)
  grabacion.serviciosEnAsistencia.add(servicio.id)
  await guardarGrabacionServicioStaff({
    servicioId: servicio.id,
    grabacionId: grabacion.id,
    estado: EstadoGrabacionServicioStaff.GRABANDO,
    iniciadoEn: grabacion.iniciadaEn,
  })
  for (const miembroPresente of canal.members.values()) {
    if (!miembroPresente.user.bot && !grabacion.participantes.has(miembroPresente.id)) {
      await notificarYAgregarParticipante(grabacion, miembroPresente.id)
    }
  }
  await actualizarPanelPorId(guild.client, servicio.id)
}

async function anunciarBienvenidaAsistencia(
  guild: Guild,
  canal: VoiceChannel,
  usuarioId: string,
): Promise<void> {
  const clave = `${guild.id}:${canal.id}:${usuarioId}`
  if (bienvenidasAsistenciaEnCurso.has(clave)) return
  bienvenidasAsistenciaEnCurso.add(clave)
  const miembros = [...canal.members.values()].filter((miembro) => !miembro.user.bot)
  if (!miembros.length) return

  const responsable = miembros
    .map((miembro) => {
      const roles = [...miembro.roles.cache.keys()]
      const tieneAdministrador = miembro.permissions.has(PermissionFlagsBits.Administrator)
      let prioridad = 5
      if (config.roles.fundacion && roles.includes(config.roles.fundacion)) prioridad = 1
      else if (config.roles.juntaAdministrativa && roles.includes(config.roles.juntaAdministrativa)) prioridad = 2
      else if (tieneAdministrador || (config.roles.admin && roles.includes(config.roles.admin))) prioridad = 3
      else if (config.roles.moderador && roles.includes(config.roles.moderador)) prioridad = 4
      else if (config.roles.staff && roles.includes(config.roles.staff)) prioridad = 5
      else prioridad = 6
      return { miembro, prioridad, tieneAdministrador, roles }
    })
    .filter(({ prioridad }) => prioridad <= 5)
    .sort((a, b) => a.prioridad - b.prioridad)[0]

  if (!responsable) return
  const titulo = tituloResponsableSoporte(
    responsable.tieneAdministrador,
    responsable.roles,
    {
      fundador: config.roles.fundacion,
      juntaAdministrativa: config.roles.juntaAdministrativa,
      admin: config.roles.admin,
      moderador: config.roles.moderador,
    },
  )
  const grabacion = grabacionesAsistencia.get(guild.id)
  await reproducirAnuncioSoporte(
    canal,
    construirBienvenidaSoporte(responsable.miembro.displayName, titulo).replace(
      'Bienvenido al soporte oficial',
      'Bienvenido al canal de Asistencia Staff oficial',
    ),
    grabacion?.grabador.conexion,
  ).catch((error: unknown) => {
    console.error(`[Servicio Staff ${grabacion?.id ?? 'sin-id'}] No se pudo anunciar la bienvenida:`, error)
  })
}

async function agregarParticipanteServicio(
  estado: VoiceState,
  grabacion: GrabacionAsistenciaActiva,
): Promise<void> {
  if (
    grabacionesAsistencia.get(estado.guild.id) !== grabacion ||
    grabacion.finalizando ||
    estado.channelId !== grabacion.canal.id
  ) return
  const miembro = estado.member ?? await estado.guild.members.fetch(estado.id)
  if (miembro.user.bot) return
  await notificarYAgregarParticipante(grabacion, miembro.id)
}

async function notificarYAgregarParticipante(
  grabacion: GrabacionAsistenciaActiva,
  participanteId: string,
): Promise<void> {
  if (grabacion.participantes.has(participanteId) || grabacion.finalizando) return
  const miembro = await grabacion.guild.members.fetch(participanteId)
  if (miembro.user.bot || miembro.voice.channelId !== grabacion.canal.id) return
  const puedeAgregarPista = grabacion.participantes.size < limitePistasGrabacion
  const aviso = puedeAgregarPista
    ? `Aviso: el canal **${grabacion.canal.name}** está siendo grabado como parte de un servicio Staff. Si permaneces, tu voz se incluirá desde ahora.`
    : `Aviso: el canal **${grabacion.canal.name}** está siendo grabado, pero se alcanzó el límite de ${limitePistasGrabacion} pistas; tu voz no se incluirá.`
  try {
    await miembro.send({ content: aviso, allowedMentions: { parse: [] } })
  } catch (error) {
    console.error(`[Servicio Staff ${grabacion.id}] No se notificó por DM a ${miembro.id}; su pista no se incluirá:`, error)
    return
  }
  if (!puedeAgregarPista) return

  const miembroActual = await grabacion.guild.members.fetch(miembro.id)
  if (
    miembroActual.voice.channelId !== grabacion.canal.id ||
    grabacionesAsistencia.get(grabacion.guild.id) !== grabacion ||
    grabacion.finalizando ||
    grabacion.participantes.has(miembro.id) ||
    grabacion.participantes.size >= limitePistasGrabacion
  ) return

  grabacion.participantes.add(miembro.id)
  grabacion.grabador.manifiesto.participantes = [...new Set([
    ...grabacion.grabador.manifiesto.participantes,
    miembro.id,
  ])]
  try {
    await grabacion.grabador.actualizarEstado('GRABANDO')
    await grabacion.grabador.iniciarCaptura([miembro.id])
  } catch (error) {
    console.error(`[Servicio Staff ${grabacion.id}] No se pudo añadir la pista de ${miembro.id}:`, error)
    await grabacion.grabador.retirarUsuario(miembro.id).catch((errorLimpieza: unknown) => {
      console.error(`[Servicio Staff ${grabacion.id}] No se pudo retirar la pista incompleta de ${miembro.id}:`, errorLimpieza)
    })
    grabacion.participantes.delete(miembro.id)
    grabacion.grabador.manifiesto.participantes =
      grabacion.grabador.manifiesto.participantes.filter((id) => id !== miembro.id)
    await grabacion.grabador.actualizarEstado('GRABANDO').catch((errorManifiesto: unknown) => {
      console.error(`[Servicio Staff ${grabacion.id}] No se pudo actualizar el manifiesto tras el error de pista:`, errorManifiesto)
    })
    await miembro.send({
      content: `El canal **${grabacion.canal.name}** sigue grabándose, pero no se pudo añadir tu pista por un error técnico.`,
      allowedMentions: { parse: [] },
    }).catch((errorAviso: unknown) => {
      console.error(`[Servicio Staff ${grabacion.id}] No se pudo informar el error de pista a ${miembro.id}:`, errorAviso)
    })
  }
}

async function informarErrorInicio(
  servicio: NonNullable<Awaited<ReturnType<typeof obtenerServicioStaff>>>,
  guild: Guild,
  detalle: string,
): Promise<void> {
  await guild.client.users.fetch(servicio.staffDiscordId).then((usuario) =>
    usuario.send(`No se pudo iniciar la grabación de tu servicio Staff: ${detalle}`),
  ).catch((error: unknown) => {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo notificar el error por DM:`, error)
  })
  const canal = await guild.channels.fetch(servicio.canalAvisoId).catch((error: unknown) => {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo recuperar el canal de aviso:`, error)
    return null
  })
  if (canal?.isSendable()) {
    await canal.send({
      embeds: [crearEmbed('Servicio Staff pendiente', detalle, coloresEmbed.error)],
      allowedMentions: { parse: [] },
    }).catch((error: unknown) => {
      console.error(`[Servicio Staff ${servicio.id}] No se pudo publicar el error de inicio:`, error)
    })
  }
}

async function retirarServicioDeGrabacion(servicioId: string, guildId: string): Promise<void> {
  const grabacion = grabacionesAsistencia.get(guildId)
  if (!grabacion) return
  grabacion.serviciosEnAsistencia.delete(servicioId)
  const servicios = await obtenerServiciosEnCurso(guildId)
  const serviciosEnCanal = await Promise.all(servicios
    .filter((servicio) =>
      servicio.estado === EstadoServicioStaff.ACTIVO &&
      servicio.canalAsistenciaId === grabacion.canal.id,
    )
    .map(async (servicio) => {
      const miembro = await grabacion.guild.members.fetch(servicio.staffDiscordId).catch(() => null)
      return miembro?.voice.channelId === grabacion.canal.id ? servicio.id : null
    }))
  grabacion.serviciosEnAsistencia = new Set(serviciosEnCanal.filter((id): id is string => !!id))
  if (grabacion.serviciosEnAsistencia.size === 0) {
    await finalizarGrabacionAsistencia(grabacion, EstadoGrabacionServicioStaff.FINALIZADA)
  }
}

async function finalizarGrabacionAsistencia(
  grabacion: GrabacionAsistenciaActiva,
  estadoDeseado: EstadoGrabacionServicioStaff,
): Promise<void> {
  if (grabacion.finalizando) return
  grabacion.finalizando = true
  if (grabacionesAsistencia.get(grabacion.guild.id) === grabacion) {
    grabacionesAsistencia.delete(grabacion.guild.id)
  }
  liberarCapturaVoz(grabacion.canal.id, grabacion.id)
  let estado = estadoDeseado
  let finalizadoEn = new Date()
  try {
    const resultado = await grabacion.grabador.finalizar()
    finalizadoEn = resultado.manifiesto.finalizadaEn
      ? new Date(resultado.manifiesto.finalizadaEn)
      : finalizadoEn
    if (estadoDeseado === EstadoGrabacionServicioStaff.FINALIZADA && !resultado.mezclaPath) {
      estado = EstadoGrabacionServicioStaff.SIN_AUDIO
    }
    if (resultado.mezclaPath) {
      await Promise.all([...grabacion.servicios].map(async (servicioId) => {
        const servicio = await obtenerServicioStaff(servicioId)
        if (!servicio) return
        try {
          const usuario = await grabacion.guild.client.users.fetch(servicio.staffDiscordId)
          await usuario.send({
            content: `Grabación finalizada del servicio Staff \`${servicio.id}\` en **${grabacion.canal.name}**.`,
            files: [new AttachmentBuilder(resultado.mezclaPath!, {
              name: `servicio-staff-${servicio.id}-mezcla.ogg`,
            })],
            allowedMentions: { parse: [] },
          })
        } catch (error) {
          console.error(`[Servicio Staff ${servicio.id}] No se pudo enviar la grabación por DM:`, error)
        }
      }))
    }
  } catch (error) {
    estado = EstadoGrabacionServicioStaff.ERROR
    console.error(`[Servicio Staff ${grabacion.id}] No se pudo finalizar la captura:`, error)
  }

  await Promise.all([...grabacion.servicios].map((servicioId) =>
    guardarGrabacionServicioStaff({
      servicioId,
      grabacionId: grabacion.id,
      estado,
      iniciadoEn: grabacion.iniciadaEn,
      finalizadoEn,
    }).catch((error: unknown) => {
      console.error(`[Servicio Staff ${servicioId}] No se pudo actualizar la referencia de grabación ${grabacion.id}:`, error)
    }),
  ))
  await Promise.all([...grabacion.servicios].map((servicioId) =>
    actualizarPanelPorId(grabacion.guild.client, servicioId),
  ))
}

async function editarRespuestaFinalizacion(i: ButtonInteraction, contenido: string): Promise<void> {
  try {
    await i.editReply(contenido)
  } catch (error) {
    const codigo = (error as { code?: number }).code
    if (codigo !== 10008) {
      console.error('[Servicio Staff] No se pudo editar la respuesta de finalización:', error)
    }
    await i.followUp({ content: contenido, flags: MessageFlags.Ephemeral }).catch((errorAlternativo: unknown) => {
      console.error('[Servicio Staff] No se pudo enviar la respuesta alternativa de finalización:', errorAlternativo)
    })
  }
}

async function finalizarServicioDesdePanel(
  i: ButtonInteraction,
  servicio: NonNullable<Awaited<ReturnType<typeof obtenerServicioStaff>>>,
): Promise<void> {
  if (servicio.estado === EstadoServicioStaff.FINALIZADO) {
    await i.reply({ content: 'Este servicio ya fue finalizado.' })
    return
  }
  if (
    servicio.estado !== EstadoServicioStaff.ACTIVO &&
    servicio.estado !== EstadoServicioStaff.FINALIZANDO
  ) {
    await i.reply({ content: 'El servicio aún no ha comenzado; ingresa primero a Asistencia Staff.' })
    return
  }
  if (finalizacionesEnCurso.has(servicio.id)) {
    await i.reply({ content: 'La finalización ya está en curso.' })
    return
  }
  finalizacionesEnCurso.add(servicio.id)
  await i.deferReply()
  try {
    const finalizadoEn = servicio.finalizadoEn ?? new Date()
    const inicioFinalizacion = await iniciarFinalizacionServicioStaff(servicio.id, finalizadoEn)
    if (inicioFinalizacion.count === 0) {
      throw new Error('El servicio cambió de estado y otra interacción está gestionando su finalización.')
    }
    const grabacion = grabacionesAsistencia.get(servicio.guildId)
    if (grabacion?.servicios.has(servicio.id)) {
      grabacion.serviciosEnAsistencia.delete(servicio.id)
      const otrosEnCanal = await obtenerServiciosEnCurso(servicio.guildId)
      const idsEnCanal = await Promise.all(otrosEnCanal
        .filter((otro) =>
          otro.id !== servicio.id &&
          otro.estado === EstadoServicioStaff.ACTIVO &&
          otro.canalAsistenciaId === grabacion.canal.id,
        )
        .map(async (otro) => {
          const miembro = await grabacion.guild.members.fetch(otro.staffDiscordId).catch(() => null)
          return miembro?.voice.channelId === grabacion.canal.id ? otro.id : null
        }))
      grabacion.serviciosEnAsistencia = new Set(idsEnCanal.filter((id): id is string => !!id))
      if (grabacion.serviciosEnAsistencia.size === 0) {
        await finalizarGrabacionAsistencia(grabacion, EstadoGrabacionServicioStaff.FINALIZADA)
      }
    }

    const actualizado = await obtenerServicioStaff(servicio.id)
    if (!actualizado || !actualizado.iniciadoEn) {
      throw new Error('El registro de servicio no contiene una hora de inicio.')
    }
    const informe = construirInformeServicioStaff({
      nombre: actualizado.staffNombre,
      discordId: actualizado.staffDiscordId,
      iniciadoEn: actualizado.iniciadoEn,
      finalizadoEn,
      actividades: actualizado.actividades,
      grabaciones: actualizado.grabaciones,
    })
    const guild = await i.client.guilds.fetch(actualizado.guildId)
    const canalInforme = await guild.channels.fetch(canalInformeServicioId)
    if (!canalInforme?.isSendable()) {
      throw new Error(`El canal institucional ${canalInformeServicioId} no existe o no admite mensajes.`)
    }
    const bot = await guild.members.fetchMe()
    const permisos = bot.permissionsIn(canalInforme)
    if (
      !permisos.has(PermissionFlagsBits.ViewChannel) ||
      !permisos.has(PermissionFlagsBits.SendMessages) ||
      !permisos.has(PermissionFlagsBits.EmbedLinks)
    ) {
      throw new Error(`El bot no tiene permisos para publicar el informe en ${canalInformeServicioId}.`)
    }

    let mensajeInforme: Message | undefined
    if (actualizado.informeMensajeId) {
      mensajeInforme = await canalInforme.messages.fetch(actualizado.informeMensajeId).catch((error: unknown) => {
        console.error(`[Servicio Staff ${servicio.id}] No se pudo recuperar el informe publicado:`, error)
        return undefined
      })
    }
    if (!mensajeInforme) {
      const embed = crearEmbed('INFORME DE SERVICIO STAFF', undefined, coloresEmbed.principal)
      embed.addFields(
        { name: 'IDENTIFICACIÓN DEL STAFF', value: informe.identificacion },
        { name: 'RESUMEN DEL SERVICIO', value: informe.resumen },
        { name: 'ACTIVIDADES REALIZADAS', value: informe.actividades },
        { name: 'REGISTRO DE GRABACIONES', value: informe.grabaciones },
        { name: 'ESTADO DEL SERVICIO', value: informe.estado },
      )
      mensajeInforme = await canalInforme.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      })
      await guardarInformeServicioStaff(actualizado.id, canalInforme.id, mensajeInforme.id)
    }

    const completado = await completarServicioStaff(actualizado.id, finalizadoEn)
    if (completado.count === 0) {
      const estadoActual = await obtenerServicioStaff(actualizado.id)
      if (estadoActual?.estado !== EstadoServicioStaff.FINALIZADO) {
        throw new Error('El informe se publicó, pero no se pudo persistir el estado final del servicio.')
      }
    }
    await actualizarPanelPorId(i.client, actualizado.id)
    await editarRespuestaFinalizacion(i, `Servicio finalizado. El informe institucional quedó publicado en <#${canalInforme.id}>.`)
  } catch (error) {
    console.error(`[Servicio Staff ${servicio.id}] No se pudo finalizar o publicar el informe:`, error)
    await actualizarPanelPorId(i.client, servicio.id)
    await editarRespuestaFinalizacion(i, 'No se pudo completar la finalización. El servicio quedó pendiente para reintentar; revisa los logs del bot.')
  } finally {
    finalizacionesEnCurso.delete(servicio.id)
  }
}

function componentesPanelServicio(
  servicio: { id: string; estado: EstadoServicioStaff },
) {
  const finalizado = servicio.estado === EstadoServicioStaff.FINALIZADO
  const cancelado = servicio.estado === EstadoServicioStaff.CANCELADO
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`servicio-staff:finalizar:${servicio.id}`)
        .setLabel('Finalizar servicio')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(finalizado || cancelado || servicio.estado === EstadoServicioStaff.ESPERANDO_VOZ),
      new ButtonBuilder()
        .setCustomId(`servicio-staff:soporte:${servicio.id}`)
        .setLabel('Iniciar soporte')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(servicio.estado !== EstadoServicioStaff.ACTIVO),
      new ButtonBuilder()
        .setCustomId(`servicio-staff:cancelar:${servicio.id}`)
        .setLabel('Cancelar espera')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(servicio.estado !== EstadoServicioStaff.ESPERANDO_VOZ),
    ),
  ]
}

function crearPanelServicio(
  servicio: {
    id: string
    staffNombre: string
    staffDiscordId: string
    estado: EstadoServicioStaff
    iniciadoEn: Date | null
  },
  actividades: Array<{
    titulo: string
    detalle: string | null
    iniciadoEn: Date
    soporteId: string | null
    tipo: TipoActividadServicioStaff
  }>,
  grabaciones: Array<{
    estado: EstadoGrabacionServicioStaff
    origen: OrigenGrabacionServicioStaff
  }>,
  ahora: number,
) {
  const inicio = servicio.iniciadoEn
  const transcurrido = inicio ? formatearDuracion(calcularDuracionMs(inicio, new Date(ahora))) : 'Aún no iniciado'
  const soportes = actividades.filter((actividad) => actividad.tipo === TipoActividadServicioStaff.SOPORTE)
  const grabacionesActivas = grabaciones.filter((grabacion) =>
    grabacion.estado === EstadoGrabacionServicioStaff.GRABANDO,
  )
  const estadoGrabacion = grabacionesActivas.length
    ? grabacionesActivas.map((grabacion) =>
      grabacion.origen === OrigenGrabacionServicioStaff.SOPORTE
        ? 'soporte'
        : 'Asistencia Staff',
    ).join(' y ')
    : grabaciones.some((grabacion) =>
      grabacion.estado === EstadoGrabacionServicioStaff.PREPARANDO,
    )
      ? 'Esperando autorización de grabación de soporte'
      : 'Sin captura activa'
  const ultimasActividades = actividades.slice(-5).map((actividad) =>
    `• ${actividad.titulo}${actividad.soporteId ? ` \`${actividad.soporteId}\`` : ''}${actividad.detalle ? ` · ${actividad.detalle}` : ''}`,
  ).join('\n') || 'Sin actividades registradas.'
  const descripcion = [
    `**Staff:** ${servicio.staffNombre} (<@${servicio.staffDiscordId}>)`,
    `**Estado:** ${etiquetaEstadoServicio(servicio.estado)}`,
    `**Inicio:** ${inicio ? inicio.toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : 'Esperando ingreso a Asistencia Staff'}`,
    `**Tiempo transcurrido:** ${transcurrido}`,
    `**Grabación:** ${estadoGrabacion}`,
    `**Soportes atendidos:** ${soportes.length}`,
    '',
    '**Actividades recientes**',
    ultimasActividades,
  ].join('\n').slice(0, 4_000)
  return crearEmbed('Panel privado de servicio Staff', descripcion, coloresEmbed.principal)
}

function etiquetaEstadoServicio(estado: EstadoServicioStaff): string {
  switch (estado) {
    case EstadoServicioStaff.ESPERANDO_VOZ: return 'Esperando ingreso a Asistencia Staff'
    case EstadoServicioStaff.ACTIVO: return 'Activo'
    case EstadoServicioStaff.FINALIZANDO: return 'Finalización pendiente'
    case EstadoServicioStaff.FINALIZADO: return 'Finalizado'
    case EstadoServicioStaff.CANCELADO: return 'Cancelado antes de iniciar'
  }
}

async function actualizarPanelPorId(client: Client, servicioId: string): Promise<void> {
  const servicio = await obtenerServicioStaff(servicioId)
  if (!servicio?.panelCanalId || !servicio.panelMensajeId) return
  try {
    const canal = await client.channels.fetch(servicio.panelCanalId)
    if (!canal?.isSendable()) throw new Error('El canal privado del panel no está disponible.')
    const mensaje = await canal.messages.fetch(servicio.panelMensajeId)
    await mensaje.edit({
      embeds: [crearPanelServicio(servicio, servicio.actividades, servicio.grabaciones, Date.now())],
      components: componentesPanelServicio(servicio),
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Servicio Staff ${servicioId}] No se pudo actualizar el panel DM:`, error)
  }
}

async function actualizarTodosLosPaneles(client: Client): Promise<void> {
  const servicios = await obtenerServiciosEnCurso(config.guildId)
  await Promise.all(servicios.map((servicio) => actualizarPanelPorId(client, servicio.id)))
}

export async function inicializarServiciosStaff(client: Client): Promise<void> {
  await marcarGrabacionesStaffInterrumpidas(config.guildId)
  const servicios = await obtenerServiciosEnCurso(config.guildId)
  for (const servicio of servicios) {
    await actualizarPanelPorId(client, servicio.id)
    if (
      servicio.estado === EstadoServicioStaff.FINALIZANDO ||
      servicio.estado === EstadoServicioStaff.FINALIZADO
    ) continue
    const guild = await client.guilds.fetch(servicio.guildId)
    const miembro = await guild.members.fetch(servicio.staffDiscordId).catch((error: unknown) => {
      console.error(`[Servicio Staff ${servicio.id}] No se pudo recuperar al Staff tras el reinicio:`, error)
      return null
    })
    if (miembro?.voice.channelId === servicio.canalAsistenciaId) {
      await iniciarOAsociarGrabacion(
        servicio.id,
        guild,
        servicio.staffDiscordId,
        servicio.estado === EstadoServicioStaff.ESPERANDO_VOZ,
      )
    }
  }
  if (!temporizadorPaneles) {
    temporizadorPaneles = setInterval(() => {
      void actualizarTodosLosPaneles(client).catch((error: unknown) => {
        console.error('[Servicio Staff] No se pudieron actualizar los paneles activos:', error)
      })
    }, 60_000)
    temporizadorPaneles.unref()
  }
}

function esStaffAutorizado(miembro: GuildMember): boolean {
  return puedeIniciarSoporte(
    miembro.permissions.has(PermissionFlagsBits.Administrator),
    [...miembro.roles.cache.keys()],
    {
      staff: config.roles.staff,
      moderador: config.roles.moderador,
      admin: config.roles.admin,
    },
  )
}
