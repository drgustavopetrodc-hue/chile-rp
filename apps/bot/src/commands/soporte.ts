import { randomUUID } from 'node:crypto'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  AttachmentBuilder,
  CategoryChannel,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  NewsChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextChannel,
  User,
  UserSelectMenuBuilder,
  VoiceChannel,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
} from 'discord.js'
import { db, Prisma } from '@rp-chile/db'
import { config } from '../config'
import { coloresEmbed, crearEmbed } from '../utils/embeds'
import { comoComponentsV2 } from '../utils/components-v2'
import { asegurarUsuario } from '../utils/usuarios'
import {
  construirBienvenidaSoporte,
  normalizarSufijoCanalSoporte,
  obtenerIdsAccesoSoporte,
  obtenerIdsUsuariosParaMover,
  puedeEliminarTrasRetirarConsentimiento,
  puedeIniciarSoporte,
  crearPermisosCanalSoporte,
  tituloResponsableSoporte,
  validarParticipantesSoporte,
} from '../utils/soporte'
import type { ParticipantesSoporte, PermisoCanalSoporte, SeleccionGrupoSoporte } from '../utils/soporte'
import {
  crearConsentimientosPendientes,
  eliminarContenidoAudioGrabacion,
  eliminarArchivosGrabacion,
  existeArchivoCompleto,
  GrabadorSoporte,
  guardarManifiestoGrabacion,
  leerManifiestoGrabacion,
  limitePistasGrabacion,
  listarManifiestosGrabacion,
  listarManifiestosVencidos,
  obtenerRutaArchivoGrabacion,
  recuperarManifiestosInterrumpidos,
  verificarOgg,
} from '../utils/soporte-grabacion'
import type {
  ConsentimientoGrabacion,
  EstadoConsentimientoSoporte,
  EstadoGrabacionSoporte,
  ManifiestoGrabacionSoporte,
  MensajeGrabacionLog,
} from '../utils/soporte-grabacion'
import { anunciosTtsSoporte, reproducirAnuncioSoporte, VOZ_TTS_SOPORTE } from '../utils/soporte-tts'
import {
  actualizarGrabacionSoporteEnServicioStaff,
  cerrarSoporteEnServicioStaff,
  registrarSoporteEnServicioActivo,
} from '../utils/servicio-staff'

const efimero = MessageFlags.Ephemeral
const duracionInactividadMs = 14 * 60_000
const duracionConfirmacionEliminacionMs = 5 * 60_000
const maximoOverwritesDiscord = 1_000

type CampoParticipantes = keyof ParticipantesSoporte
type EstadoSoporte = 'ABIERTO' | 'CERRADO' | 'ERROR'
type ResultadoMovimiento = 'MOVIDO' | 'NO_CONECTADO' | 'SIN_PERMISOS' | 'ERROR'

interface MovimientoParticipante {
  usuarioId: string
  resultado: ResultadoMovimiento
  error: string | null
}

interface GrupoSoportePersistido {
  usuarios: string[]
  rolId: string | null
}

interface RegistroSoporte {
  id: string
  guildId: string
  ejecutorId: string
  abiertoEn: string
  estado: EstadoSoporte
  reportantes: GrupoSoportePersistido
  reportados: GrupoSoportePersistido
  testigos: GrupoSoportePersistido
  rolesSupervision: string[]
  canalVozId: string
  canalEvidenciasId: string
  mensajeInicialId: string | null
  mensajesLog: MensajeGrabacionLog[]
  grabacion: EstadoGrabacionSoporte
  consentimientos: ConsentimientoGrabacion[]
  grabacionIniciadaEn: string | null
  grabacionFinalizadaEn: string | null
  grabacionVenceEn: string | null
  movimientos: MovimientoParticipante[]
  movimientosPendientes: boolean
  cerradoEn: string | null
  cerradoPorId: string | null
  canalesEliminados: { voz: boolean; evidencias: boolean } | null
}

interface SesionSoporte {
  id: string
  guildId: string
  ejecutorId: string
  participantes: ParticipantesSoporte
  revisado: boolean
  venceEn: number
  creando: boolean
}

interface ConfirmacionEliminacion {
  soporteId: string
  ejecutorId: string
  venceEn: number
}

interface ConfirmacionEliminacionGrabacion {
  soporteId: string
  ejecutorId: string
  venceEn: number
}

interface PreparacionSoporte {
  categoria: CategoryChannel
  bot: GuildMember
  miembrosParticipantes: Map<string, GuildMember>
  overwritesVoz: PermisoCanalSoporte[]
  overwritesTexto: PermisoCanalSoporte[]
  rolesParticipantes: string[]
  rolesSupervision: string[]
}

const sesiones = new Map<string, SesionSoporte>()
const confirmacionesEliminacion = new Map<string, ConfirmacionEliminacion>()
const confirmacionesGrabacion = new Map<string, ConfirmacionEliminacionGrabacion>()
const grabadoresSoporte = new Map<string, GrabadorSoporte>()
const registrosSoporteActivos = new Map<string, RegistroSoporte>()
const guildsSoporteActivos = new Map<string, Guild>()
const cierresEnCurso = new Set<string>()
const eliminacionesEnCurso = new Set<string>()
const eliminacionesGrabacionEnCurso = new Set<string>()
const finalizacionesGrabacion = new Map<string, Promise<RegistroSoporte>>()
const colasOperacionesSoporte = new Map<string, Promise<void>>()
let temporizadorRetencionGrabaciones: NodeJS.Timeout | undefined

export const soporteData = new SlashCommandBuilder()
  .setName('soporte')
  .setDescription('Inicia un soporte institucional privado')
  .setContexts(InteractionContextType.Guild)

export const soporte = { data: soporteData, execute: ejecutarSoporte }

export function hayGrabacionSoporteActiva(guildId: string): boolean {
  return [...grabadoresSoporte.keys()].some((soporteId) =>
    guildsSoporteActivos.get(soporteId)?.id === guildId,
  )
}

async function ejecutarSoporte(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) {
    return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  }

  await i.deferReply({ flags: efimero })
  const ejecutor = await i.guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(ejecutor)) {
    return i.editReply({
      content: 'Solo el Staff, Moderación o Administración autorizada puede iniciar un soporte.',
    })
  }

  limpiarSesionesExpiradas()
  const sesion: SesionSoporte = {
    id: randomUUID(),
    guildId: i.guildId,
    ejecutorId: i.user.id,
    participantes: {
      reportantes: { usuarios: [] },
      reportados: { usuarios: [] },
      testigos: { usuarios: [] },
    },
    revisado: false,
    venceEn: Date.now() + duracionInactividadMs,
    creando: false,
  }
  sesiones.set(sesion.id, sesion)

  return i.editReply({
    content: contenidoPanelPrincipal(sesion),
    components: componentesPanelPrincipal(sesion),
    allowedMentions: { parse: [] },
  })
}

export async function manejarInteraccionSoporte(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
) {
  if (!i.customId.startsWith('soporte:')) return
  if (!i.inCachedGuild()) {
    return i.reply({ content: 'Esta interacción solo está disponible dentro del servidor.', flags: efimero })
  }

  const partes = i.customId.split(':')
  if (partes[1] === 'wizard') {
    return manejarInteraccionAsistente(i, partes)
  }

  const guild = i.guild
  if (!guild) {
    return i.reply({ content: 'Esta interacción ya no está disponible en el servidor.', flags: efimero })
  }
  if (partes[1] === 'control') return manejarControlSoporte(i, partes)
  if (partes[1] === 'consentimiento') return manejarConsentimientoGrabacion(i, partes)
  if (partes[1] === 'grabacion-log') return manejarControlGrabacionLog(i, partes)
  if (partes[1] === 'eliminar-grabacion') return manejarConfirmacionEliminacionGrabacion(i, partes)
  if (partes[1] === 'eliminar') return manejarConfirmacionEliminacion(i, partes)
}

async function manejarInteraccionAsistente(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  const guild = i.guild
  if (!guild) {
    return i.reply({ content: 'Esta interacción ya no está disponible en el servidor.', flags: efimero })
  }
  limpiarSesionesExpiradas()
  const sesionId = partes[2]
  const sesion = sesiones.get(sesionId)
  await i.deferUpdate()

  if (!sesion || sesion.guildId !== i.guildId || sesion.ejecutorId !== i.user.id || sesion.venceEn <= Date.now()) {
    sesiones.delete(sesionId)
    return i.editReply({
      content: 'La sesión del formulario expiró o ya no está disponible. No se creó ningún canal.',
      components: [],
      allowedMentions: { parse: [] },
    })
  }

  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    sesiones.delete(sesionId)
    return i.editReply({
      content: 'Tu autorización cambió. Se canceló el formulario y no se creó ningún canal.',
      components: [],
      allowedMentions: { parse: [] },
    })
  }
  if (i.isUserSelectMenu()) return procesarSeleccionUsuarios(i, sesion, partes)
  if (i.isRoleSelectMenu()) return procesarSeleccionRol(i, guild, sesion, partes)
  return procesarBotonAsistente(i, guild, sesion, partes)
}

async function procesarSeleccionUsuarios(
  i: UserSelectMenuInteraction,
  sesion: SesionSoporte,
  partes: string[],
) {
  const campo = campoParticipantes(partes[4])
  if (!campo || partes[3] !== 'usuarios') {
    return i.editReply({ content: 'La selección no es válida.', components: [] })
  }

  const grupo = sesion.participantes[campo]
  if (grupo.rolId) {
    return i.followUp({
      content: 'Ya seleccionaste un rol para este campo. Primero limpia esa selección para elegir usuarios.',
      flags: efimero,
    })
  }

  grupo.usuarios = [...new Set(i.values)]
  sesion.revisado = false
  return i.editReply({
    content: contenidoPanelPrincipal(sesion),
    components: componentesPanelPrincipal(sesion),
    allowedMentions: { parse: [] },
  })
}

async function procesarSeleccionRol(
  i: RoleSelectMenuInteraction,
  guild: Guild,
  sesion: SesionSoporte,
  partes: string[],
) {
  const campo = campoParticipantes(partes[4])
  if (!campo || campo === 'testigos' || partes[3] !== 'rol') {
    return i.editReply({ content: 'La selección de rol no es válida para este campo.', components: [] })
  }

  const grupo = sesion.participantes[campo]
  if (grupo.usuarios.length) {
    return i.followUp({
      content: 'Ya seleccionaste usuarios para este campo. Primero limpia esa selección para elegir un rol.',
      flags: efimero,
    })
  }

  const rolId = i.values[0]
  const rol = await guild.roles.fetch(rolId)
  if (!rol || rol.id === i.guildId || rol.managed) {
    return i.followUp({
      content: 'El rol seleccionado no es válido para este soporte.',
      flags: efimero,
    })
  }

  grupo.rolId = rol.id
  sesion.revisado = false
  return i.editReply({
    content: contenidoPanelPrincipal(sesion),
    components: componentesPanelPrincipal(sesion),
    allowedMentions: { parse: [] },
  })
}

async function procesarBotonAsistente(
  i: ButtonInteraction,
  guild: Guild,
  sesion: SesionSoporte,
  partes: string[],
) {
  const accion = partes[3]
  const campo = campoParticipantes(partes[4])

  if (accion === 'cancelar') {
    sesiones.delete(sesion.id)
    return i.editReply({
      content: 'Se canceló el formulario. No se creó ningún canal.',
      components: [],
      allowedMentions: { parse: [] },
    })
  }

  if (accion === 'revisar') {
    const errorValidacion = validarParticipantesSoporte(sesion.participantes)
    if (errorValidacion) {
      return i.editReply({
        content: `${errorValidacion}\n\n${contenidoPanelPrincipal(sesion)}`,
        components: componentesPanelPrincipal(sesion),
        allowedMentions: { parse: [] },
      })
    }

    const ejecutor = await guild.members.fetch(i.user.id)
    if (!esPersonalAutorizado(ejecutor)) {
      sesiones.delete(sesion.id)
      return i.editReply({
        content: 'Tu autorización cambió. Se canceló el formulario y no se creó ningún canal.',
        components: [],
      })
    }
    try {
      await prepararSoporte(guild, ejecutor.id, sesion.participantes)
    } catch (error) {
      if (!(error instanceof ErrorConfiguracionSoporte)) {
        console.error(`[Soporte] Falló la validación previa a la confirmación de ${ejecutor.id}:`, error)
      }
      return i.editReply({
        content: `${mensajeErrorCreacionSoporte(error)}\n\n${contenidoPanelPrincipal(sesion)}`,
        components: componentesPanelPrincipal(sesion),
        allowedMentions: { parse: [] },
      })
    }
    sesion.revisado = true
    return i.editReply({
      content: contenidoRevisionSoporte(sesion),
      components: componentesRevisionSoporte(sesion),
      allowedMentions: { parse: [] },
    })
  }

  if (accion === 'confirmar') {
    if (!sesion.revisado) {
      return i.editReply({
        content: 'Primero revisa los participantes y los permisos. Aún no se creó ningún canal.',
        components: componentesPanelPrincipal(sesion),
        allowedMentions: { parse: [] },
      })
    }
    if (sesion.creando) return
    const errorValidacion = validarParticipantesSoporte(sesion.participantes)
    if (errorValidacion) {
      return i.editReply({
        content: `${errorValidacion}\n\n${contenidoPanelPrincipal(sesion)}`,
        components: componentesPanelPrincipal(sesion),
        allowedMentions: { parse: [] },
      })
    }

    const ejecutor = await guild.members.fetch(i.user.id)
    if (!esPersonalAutorizado(ejecutor)) {
      sesiones.delete(sesion.id)
      return i.editReply({
        content: 'Tu autorización cambió. Se canceló el formulario y no se creó ningún canal.',
        components: [],
      })
    }

    sesion.creando = true
    sesiones.delete(sesion.id)
    return completarCreacionSoporte(i, guild, ejecutor.user, sesion)
  }

  if (accion === 'abrir' && campo) {
    return i.editReply({
      content: contenidoPanelCampo(sesion, campo),
      components: componentesPanelCampo(sesion, campo),
      allowedMentions: { parse: [] },
    })
  }

  if (accion === 'limpiar' && campo) {
    sesion.participantes[campo].usuarios = []
    sesion.participantes[campo].rolId = undefined
    sesion.revisado = false
    return i.editReply({
      content: contenidoPanelPrincipal(sesion),
      components: componentesPanelPrincipal(sesion),
      allowedMentions: { parse: [] },
    })
  }

  if (accion === 'volver') {
    return i.editReply({
      content: contenidoPanelPrincipal(sesion),
      components: componentesPanelPrincipal(sesion),
      allowedMentions: { parse: [] },
    })
  }
}

function contenidoPanelPrincipal(sesion: SesionSoporte) {
  const resumen = [
    `**Personas que reportan:** ${resumenGrupo(sesion.participantes.reportantes)}`,
    `**Personas reportadas:** ${resumenGrupo(sesion.participantes.reportados)}`,
    `**Testigos:** ${resumenGrupo(sesion.participantes.testigos)}`,
    `**Moderador responsable:** <@${sesion.ejecutorId}>`,
  ].join('\n')
  const expiracion = Math.floor(sesion.venceEn / 1000)
  return [
    '## Soporte institucional — participantes',
    'Selecciona los participantes. Los reportantes y reportados son obligatorios; los testigos son opcionales.',
    '',
    resumen,
    '',
    `El formulario vence <t:${expiracion}:R>. Primero se validarán los permisos; la creación requiere una confirmación final.`,
  ].join('\n')
}

function componentesPanelPrincipal(sesion: SesionSoporte) {
  const validar = validarParticipantesSoporte(sesion.participantes)
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:abrir:reportantes`)
        .setLabel('Personas que reportan')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:abrir:reportados`)
        .setLabel('Personas reportadas')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:abrir:testigos`)
        .setLabel('Testigos')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:revisar`)
        .setLabel('Revisar y validar')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!!validar || sesion.creando),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:cancelar`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger),
    ),
  ]
}

function contenidoRevisionSoporte(sesion: SesionSoporte) {
  return [
    '## Confirmación final del soporte',
    'Los participantes pertenecen al servidor y la categoría, los roles institucionales y los permisos requeridos están disponibles.',
    'Aún no se ha creado ningún canal. Al confirmar se crearán exactamente un canal de voz y uno de evidencias.',
    '',
    `**Personas que reportan:** ${resumenGrupo(sesion.participantes.reportantes)}`,
    `**Personas reportadas:** ${resumenGrupo(sesion.participantes.reportados)}`,
    `**Testigos:** ${resumenGrupo(sesion.participantes.testigos)}`,
    `**Moderador responsable:** <@${sesion.ejecutorId}>`,
  ].join('\n')
}

function componentesRevisionSoporte(sesion: SesionSoporte) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:confirmar`)
        .setLabel('Confirmar y crear soporte')
        .setStyle(ButtonStyle.Success)
        .setDisabled(sesion.creando),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:volver`)
        .setLabel('Modificar participantes')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:cancelar`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger),
    ),
  ]
}

function contenidoPanelCampo(sesion: SesionSoporte, campo: CampoParticipantes) {
  const nombres: Record<CampoParticipantes, string> = {
    reportantes: 'Personas que reportan',
    reportados: 'Personas reportadas',
    testigos: 'Testigos',
  }
  const permiteRol = campo !== 'testigos'
  return [
    `## Seleccionar ${nombres[campo].toLowerCase()}`,
    permiteRol
      ? 'Elige hasta tres usuarios o un único rol. No se pueden combinar usuarios y rol.'
      : 'Elige hasta tres usuarios; este campo es opcional y no admite roles.',
    `Selección actual: ${resumenGrupo(sesion.participantes[campo])}`,
  ].join('\n')
}

function componentesPanelCampo(sesion: SesionSoporte, campo: CampoParticipantes) {
  const componentes: ActionRowBuilder<import('discord.js').MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<import('discord.js').MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:usuarios:${campo}`)
        .setPlaceholder('Selecciona hasta tres usuarios')
        .setMinValues(1)
        .setMaxValues(3),
    ),
  ]
  if (campo !== 'testigos') {
    componentes.push(
      new ActionRowBuilder<import('discord.js').MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`soporte:wizard:${sesion.id}:rol:${campo}`)
          .setPlaceholder('Selecciona un único rol')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
  }
  componentes.push(
    new ActionRowBuilder<import('discord.js').MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:limpiar:${campo}`)
        .setLabel('Limpiar selección')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`soporte:wizard:${sesion.id}:volver`)
        .setLabel('Volver')
        .setStyle(ButtonStyle.Primary),
    ),
  )
  return componentes
}

function campoParticipantes(valor: string | undefined): CampoParticipantes | undefined {
  if (valor === 'reportantes' || valor === 'reportados' || valor === 'testigos') return valor
  return undefined
}

function resumenGrupo(grupo: SeleccionGrupoSoporte): string {
  if (grupo.rolId) return `<@&${grupo.rolId}>`
  if (grupo.usuarios.length) return grupo.usuarios.map((id) => `<@${id}>`).join(', ')
  return 'Sin seleccionar'
}

async function completarCreacionSoporte(
  i: ButtonInteraction,
  guild: Guild,
  ejecutor: User,
  sesion: SesionSoporte,
) {
  try {
    const registro = await crearSoporteConAviso(guild, ejecutor, sesion.participantes)
    return i.editReply({
      content:
        `Soporte **${registro.id}** habilitado.\n` +
        `Sala de reunión: <#${registro.canalVozId}>\n` +
        `Canal de evidencias: <#${registro.canalEvidenciasId}>`,
      components: [],
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Soporte] No se pudo habilitar el soporte para ${ejecutor.id}:`, error)
    return i.editReply({
      content: mensajeErrorCreacionSoporte(error),
      components: [],
      allowedMentions: { parse: [] },
    })
  }
}

export async function crearSoporteDesdePanelPrivado(
  guild: Guild,
  ejecutorId: string,
  participantes: ParticipantesSoporte,
): Promise<{ id: string; canalVozId: string; canalEvidenciasId: string }> {
  const ejecutor = await guild.members.fetch(ejecutorId)
  if (!esPersonalAutorizado(ejecutor)) {
    throw new Error('Solo el Staff, Moderación o Administración autorizada puede iniciar un soporte.')
  }
  const registro = await crearSoporteConAviso(guild, ejecutor.user, participantes)
  return {
    id: registro.id,
    canalVozId: registro.canalVozId,
    canalEvidenciasId: registro.canalEvidenciasId,
  }
}

async function crearSoporteConAviso(
  guild: Guild,
  ejecutor: User,
  participantes: ParticipantesSoporte,
): Promise<RegistroSoporte> {
  const { registro } = await crearSoporte(guild, ejecutor, participantes)
  const anuncioInicial = registro.grabacion === 'ESPERANDO CONSENTIMIENTO'
    ? anunciosTtsSoporte.inicioConConsentimiento
    : anunciosTtsSoporte.inicioSinGrabacion
  await anunciarEnSoporte(guild, registro, anuncioInicial, 'inicio')
  await actualizarMensajeSoporte(guild, registro).catch((error: unknown) => {
    console.error(`[Soporte ${registro.id}] No se pudieron habilitar los controles tras el anuncio inicial:`, error)
  })
  return registro
}

async function prepararSoporte(
  guild: Guild,
  ejecutorId: string,
  participantes: ParticipantesSoporte,
): Promise<PreparacionSoporte> {
  const errorValidacion = validarParticipantesSoporte(participantes)
  if (errorValidacion) throw new ErrorConfiguracionSoporte(errorValidacion)

  const categoria = await guild.channels.fetch(config.canales.categoriaSoportes).catch((error: unknown) => {
    if (codigoDiscord(error) === 10003) {
      throw new ErrorConfiguracionSoporte(
        'La categoría institucional de soportes no existe o no es accesible.',
      )
    }
    throw error
  })
  if (!categoria || categoria.type !== ChannelType.GuildCategory) {
    throw new ErrorConfiguracionSoporte(
      'La categoría institucional de soportes no existe o no es una categoría válida.',
    )
  }

  const bot = await guild.members.fetchMe()
  if (!bot.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new ErrorConfiguracionSoporte(
      'Al bot le falta el permiso **Gestionar canales** para habilitar el soporte.',
    )
  }
  if (!bot.permissionsIn(categoria).has(PermissionFlagsBits.ViewChannel)) {
    throw new ErrorConfiguracionSoporte(
      'El bot no puede ver la categoría institucional de soportes.',
    )
  }

  const rolesSupervision = await validarRolesSupervision(guild)
  const rolesParticipantes = await validarRolesParticipantes(guild, participantes)
  const miembrosParticipantes = await validarMiembrosParticipantes(guild, participantes, ejecutorId)
  const idsAcceso = obtenerIdsAccesoSoporte(participantes, ejecutorId, [
    ...rolesSupervision,
    ...rolesParticipantes,
  ])
  const overwritesVoz = crearPermisosCanalSoporte(guild.id, bot.id, idsAcceso, 'voz')
  const overwritesTexto = crearPermisosCanalSoporte(guild.id, bot.id, idsAcceso, 'texto')
  if (overwritesVoz.length > maximoOverwritesDiscord || overwritesTexto.length > maximoOverwritesDiscord) {
    throw new ErrorConfiguracionSoporte(
      'La cantidad de participantes y roles supera el límite de permisos de Discord.',
    )
  }

  return {
    categoria,
    bot,
    miembrosParticipantes,
    overwritesVoz,
    overwritesTexto,
    rolesParticipantes,
    rolesSupervision,
  }
}

async function crearSoporte(
  guild: Guild,
  ejecutor: User,
  participantes: ParticipantesSoporte,
): Promise<{ registro: RegistroSoporte }> {
  const id = randomUUID()
  const abiertoEn = new Date().toISOString()
  const actor = await asegurarUsuario(ejecutor)
  let canalVoz: VoiceChannel | undefined
  let canalEvidencias: TextChannel | undefined
  let registro: RegistroSoporte | undefined
  let mensajeInicial: import('discord.js').Message | undefined
  let preparacion: PreparacionSoporte | undefined
  let grabador: GrabadorSoporte | undefined

  try {
    preparacion = await prepararSoporte(guild, ejecutor.id, participantes)

    const sufijo = obtenerSufijoInicial(
      guild,
      participantes,
      preparacion.miembrosParticipantes,
      preparacion.rolesParticipantes,
    )
    const motivo = `Apertura del soporte ${id} por ${ejecutor.tag}`
    const canalVozCreado = await guild.channels.create({
      name: `🔊・soporte-${sufijo}`,
      type: ChannelType.GuildVoice,
      parent: preparacion.categoria.id,
      permissionOverwrites: preparacion.overwritesVoz,
      reason: motivo,
    })
    canalVoz = canalVozCreado
    const canalEvidenciasCreado = await guild.channels.create({
      name: `・soporte-${sufijo}`,
      type: ChannelType.GuildText,
      parent: preparacion.categoria.id,
      permissionOverwrites: preparacion.overwritesTexto,
      reason: motivo,
    })
    canalEvidencias = canalEvidenciasCreado

    verificarPermisosCanal(canalVozCreado, preparacion.overwritesVoz, guild.id)
    verificarPermisosCanal(canalEvidenciasCreado, preparacion.overwritesTexto, guild.id)
    if (canalVozCreado.parentId !== preparacion.categoria.id ||
        canalEvidenciasCreado.parentId !== preparacion.categoria.id) {
      throw new ErrorConfiguracionSoporte(
        'Discord no ubicó ambos canales dentro de la categoría institucional configurada.',
      )
    }

    const idsConsentimiento = [...new Set([
      ...participantes.reportantes.usuarios,
      ...participantes.reportados.usuarios,
      ...participantes.testigos.usuarios,
      ejecutor.id,
    ])]
    const consentimientos = crearConsentimientosPendientes(idsConsentimiento)
    registro = {
      id,
      guildId: guild.id,
      ejecutorId: ejecutor.id,
      abiertoEn,
      estado: 'ABIERTO',
      reportantes: serializarGrupo(participantes.reportantes),
      reportados: serializarGrupo(participantes.reportados),
      testigos: serializarGrupo(participantes.testigos),
      rolesSupervision: preparacion.rolesSupervision,
      canalVozId: canalVozCreado.id,
      canalEvidenciasId: canalEvidenciasCreado.id,
      mensajeInicialId: null,
      mensajesLog: [],
      grabacion: 'NO DISPONIBLE',
      consentimientos: [],
      grabacionIniciadaEn: null,
      grabacionFinalizadaEn: null,
      grabacionVenceEn: null,
      movimientos: [],
      movimientosPendientes: true,
      cerradoEn: null,
      cerradoPorId: null,
      canalesEliminados: null,
    }

    try {
      grabador = await GrabadorSoporte.conectar(
        guild,
        canalVozCreado,
        config.grabaciones.directorio,
        config.grabaciones.retencionDias,
        id,
        idsConsentimiento,
        consentimientos,
        {
          conexionError: (error) => {
            void manejarErrorGrabacion(id, guild, actor.id, error).catch((errorInterno: unknown) => {
              console.error(`[Soporte ${id}] No se pudo contener un error de captura:`, errorInterno)
            })
          },
          primerPaquete: (discordId) => manejarPrimerPaqueteGrabacion(id, guild, discordId),
        },
      )
      registro.grabacion = 'ESPERANDO CONSENTIMIENTO'
      registro.consentimientos = consentimientos
      grabadoresSoporte.set(id, grabador)
      registrosSoporteActivos.set(id, registro)
    } catch (error) {
      registro.grabacion = config.grabaciones.directorio ? 'ERROR' : 'NO DISPONIBLE'
      registro.consentimientos = []
      console.error(`[Soporte ${id}] La grabación no está disponible; el soporte continuará sin captura:`, error)
    }
    guildsSoporteActivos.set(id, guild)

    mensajeInicial = await canalEvidenciasCreado.send({
      embeds: [crearEmbedSoporte(registro)],
      components: componentesControlesSoporte(registro, true, true),
      allowedMentions: { parse: [] },
    })
    registro.mensajeInicialId = mensajeInicial.id
    await registrarEventoSoporte(actor.id, registro, 'apertura', {
      canales: { voz: canalVozCreado.id, evidencias: canalEvidenciasCreado.id },
    })
    if (grabador) {
      await registrarEventoGrabacion(guild, actor.id, registro, 'grabacion.esperando_consentimiento', {
        participantes: consentimientos.map(({ discordId }) => discordId),
      })
    } else {
      await registrarEventoGrabacion(guild, actor.id, registro, 'grabacion.no_disponible', {
        error: 'El almacenamiento persistente o la conexión de voz no está disponible.',
      })
    }
  } catch (error) {
    grabadoresSoporte.delete(id)
    registrosSoporteActivos.delete(id)
    guildsSoporteActivos.delete(id)
    if (grabador) grabador.conexion.destroy()
    if (config.grabaciones.directorio) {
      await eliminarArchivosGrabacion(config.grabaciones.directorio ?? '', id).catch((errorLimpieza: unknown) => {
        console.error(`[Soporte ${id}] No se pudo limpiar el almacenamiento parcial:`, errorLimpieza)
      })
    }
    const limpieza = await limpiarCanalesParciales(canalEvidencias, canalVoz, id)
    await registrarErrorCreacionSoporte(actor.id, {
      id,
      guildId: guild.id,
      ejecutorId: ejecutor.id,
      abiertoEn,
      participantes: {
        reportantes: serializarGrupo(participantes.reportantes),
        reportados: serializarGrupo(participantes.reportados),
        testigos: serializarGrupo(participantes.testigos),
      },
      canales: {
        voz: canalVoz?.id ?? null,
        evidencias: canalEvidencias?.id ?? null,
      },
      limpieza,
      error: mensajeSeguro(error),
    }).catch((errorAuditoria: unknown) => {
      console.error(`[Soporte ${id}] No se pudo registrar el fallo de creación:`, errorAuditoria)
    })
    throw error
  }

  if (!canalVoz || !canalEvidencias || !registro || !mensajeInicial || !preparacion) {
    throw new Error('El soporte no alcanzó un estado inicial válido.')
  }

  const bot = preparacion.bot
  const miembrosParticipantes = preparacion.miembrosParticipantes
  const usuariosIndividuales = obtenerIdsUsuariosParaMover(participantes, ejecutor.id)
  await registrarSoporteEnServicioActivo({
    guildId: guild.id,
    staffDiscordId: ejecutor.id,
    soporteId: registro.id,
    canalVozId: registro.canalVozId,
    abiertoEn: new Date(registro.abiertoEn),
    estadoGrabacion: registro.grabacion,
  }).catch((error: unknown) => {
    console.error(`[Soporte ${registro.id}] No se pudo asociar el soporte al servicio Staff:`, error)
  })
  for (const usuarioId of usuariosIndividuales) {
    const miembro = miembrosParticipantes.get(usuarioId)
    if (!miembro || !miembro.voice.channel) {
      registro.movimientos.push({ usuarioId, resultado: 'NO_CONECTADO', error: null })
      continue
    }

    try {
      const puedeMover = bot.permissionsIn(canalVoz).has(PermissionFlagsBits.MoveMembers) &&
        bot.permissionsIn(miembro.voice.channel).has(PermissionFlagsBits.MoveMembers)
      if (!puedeMover) {
        registro.movimientos.push({ usuarioId, resultado: 'SIN_PERMISOS', error: null })
        continue
      }

      await miembro.voice.setChannel(canalVoz, `Incorporación al soporte ${id}`)
      registro.movimientos.push({ usuarioId, resultado: 'MOVIDO', error: null })
    } catch (error) {
      registro.movimientos.push({
        usuarioId,
        resultado: 'ERROR',
        error: mensajeSeguro(error),
      })
      console.error(`[Soporte ${id}] No se pudo mover al participante ${usuarioId}:`, error)
    }
  }
  registro.movimientosPendientes = false

  await registrarEventoSoporte(actor.id, registro, 'incorporacion_finalizada', {
    movimientos: registro.movimientos,
  }).catch((error: unknown) => {
    console.error(`[Soporte ${id}] No se pudo auditar el resultado de incorporación:`, error)
  })
  for (const movimiento of registro.movimientos) {
    await registrarEventoSoporte(actor.id, registro, 'movimiento_participante', {
      participanteId: movimiento.usuarioId,
      resultado: movimiento.resultado,
      error: movimiento.error,
    }).catch((error: unknown) => {
      console.error(`[Soporte ${id}] No se pudo auditar el movimiento de ${movimiento.usuarioId}:`, error)
    })
  }

  try {
    await mensajeInicial.edit({
      embeds: [crearEmbedSoporte(registro)],
      components: componentesControlesSoporte(registro, true, true),
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Soporte ${id}] No se pudo actualizar el resumen de incorporación:`, error)
    await registrarEventoSoporte(actor.id, registro, 'error_actualizacion_mensaje', {
      error: mensajeSeguro(error),
    }).catch((errorAuditoria: unknown) => {
      console.error(`[Soporte ${id}] No se pudo auditar el error de actualización:`, errorAuditoria)
    })
  }
  return { registro }
}

function esPersonalAutorizado(miembro: GuildMember): boolean {
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

async function anunciarBienvenidaSoporte(
  guild: Guild,
  registro: RegistroSoporte,
): Promise<void> {
  try {
    const responsable = await guild.members.fetch(registro.ejecutorId)
    const titulo = tituloResponsableSoporte(
      responsable.permissions.has(PermissionFlagsBits.Administrator),
      [...responsable.roles.cache.keys()],
      {
        fundador: config.roles.fundacion,
        juntaAdministrativa: config.roles.juntaAdministrativa,
        admin: config.roles.admin,
        moderador: config.roles.moderador,
      },
    )
    await anunciarEnSoporte(
      guild,
      registro,
      construirBienvenidaSoporte(responsable.displayName, titulo),
      'bienvenida_usuario',
    )
  } catch (error) {
    console.error(`[Soporte ${registro.id}] No se pudo preparar el saludo de bienvenida:`, error)
  }
}

async function validarRolesSupervision(guild: Guild): Promise<string[]> {
  const ids = [...new Set([
    config.roles.staff,
    config.roles.moderador,
    config.roles.admin,
    config.roles.soporte,
    config.roles.fundacion,
    config.roles.juntaAdministrativa,
  ].filter((id): id is string => !!id))]

  for (const id of ids) {
    const rol = await guild.roles.fetch(id).catch((error: unknown) => {
      if (codigoDiscord(error) === 10011) return null
      throw error
    })
    if (!rol || rol.id === guild.id || rol.managed) {
      throw new ErrorConfiguracionSoporte(
        `El rol institucional configurado \`${id}\` no existe o no puede recibir permisos de soporte.`,
      )
    }
  }
  return ids
}

async function validarRolesParticipantes(
  guild: Guild,
  participantes: ParticipantesSoporte,
): Promise<string[]> {
  const ids = [...new Set([
    participantes.reportantes.rolId,
    participantes.reportados.rolId,
  ].filter((id): id is string => !!id))]
  for (const id of ids) {
    const rol = await guild.roles.fetch(id).catch((error: unknown) => {
      if (codigoDiscord(error) === 10011) return null
      throw error
    })
    if (!rol || rol.id === guild.id || rol.managed) {
      throw new ErrorConfiguracionSoporte(
        'Uno de los roles seleccionados ya no pertenece al servidor o no puede recibir acceso.',
      )
    }
  }
  return ids
}

async function validarMiembrosParticipantes(
  guild: Guild,
  participantes: ParticipantesSoporte,
  moderadorId: string,
): Promise<Map<string, GuildMember>> {
  const ids = obtenerIdsUsuariosParaMover(participantes, moderadorId)
  const miembros = new Map<string, GuildMember>()
  for (const id of ids) {
    const miembro = await guild.members.fetch(id).catch((error: unknown) => {
      if (codigoDiscord(error) === 10007) return null
      throw error
    })
    if (!miembro || miembro.user.bot) {
      throw new ErrorConfiguracionSoporte(
        'Uno de los participantes seleccionados ya no pertenece al servidor o no es válido.',
      )
    }
    miembros.set(id, miembro)
  }
  return miembros
}

function verificarPermisosCanal(
  canal: VoiceChannel | TextChannel,
  esperados: readonly PermisoCanalSoporte[],
  everyoneId: string,
) {
  const esperadosPorId = new Map(esperados.map((overwrite) => [overwrite.id, overwrite]))
  const actuales = canal.permissionOverwrites.cache
  if (actuales.size !== esperadosPorId.size) {
    throw new ErrorConfiguracionSoporte(
      `Discord no aplicó la lista completa de permisos en el canal ${canal.id}.`,
    )
  }

  for (const [id, esperado] of esperadosPorId) {
    const actual = actuales.get(id)
    if (!actual) {
      throw new ErrorConfiguracionSoporte(
        `Falta un permiso de acceso esperado para el canal ${canal.id}.`,
      )
    }
    const allowEsperado = new PermissionsBitField(esperado.allow).bitfield
    const denyEsperado = new PermissionsBitField(esperado.deny).bitfield
    if (actual.allow.bitfield !== allowEsperado || actual.deny.bitfield !== denyEsperado) {
      throw new ErrorConfiguracionSoporte(
        `Discord no confirmó los permisos privados del canal ${canal.id}.`,
      )
    }
  }

  const everyone = actuales.get(everyoneId)
  if (!everyone?.deny.has(PermissionFlagsBits.ViewChannel)) {
    throw new ErrorConfiguracionSoporte(
      `El canal ${canal.id} no denegó el acceso a @everyone.`,
    )
  }
}

function obtenerSufijoInicial(
  guild: Guild,
  participantes: ParticipantesSoporte,
  miembros: Map<string, import('discord.js').GuildMember>,
  roles: readonly string[],
): string {
  const primerUsuario = participantes.reportantes.usuarios[0]
  if (primerUsuario) {
    return normalizarSufijoCanalSoporte(miembros.get(primerUsuario)?.displayName ?? 'usuario')
  }
  const rol = roles.find((id) => id === participantes.reportantes.rolId)
  return normalizarSufijoCanalSoporte(
    rol ? guild.roles.cache.get(rol)?.name ?? `rol-${rol.slice(-6)}` : 'usuario',
  )
}

function serializarGrupo(grupo: SeleccionGrupoSoporte): GrupoSoportePersistido {
  return { usuarios: [...grupo.usuarios], rolId: grupo.rolId ?? null }
}

async function registrarEventoSoporte(
  actorId: string | null,
  registro: RegistroSoporte,
  evento: string,
  detalles: Record<string, unknown> = {},
): Promise<string[]> {
  const detalle = JSON.parse(JSON.stringify({
    evento,
    soporte: registro,
    ...detalles,
  })) as Prisma.InputJsonValue
  await db.auditoria.create({
    data: {
      actorId,
      accion: `soporte.${evento}`,
      entidad: 'Soporte',
      entidadId: registro.id,
      detalle,
    },
  })
  const guild = guildsSoporteActivos.get(registro.id)
  return guild
    ? publicarEventoSoporteEnLogs(guild, actorId, registro, evento, detalles)
    : []
}

async function registrarErrorCreacionSoporte(
  actorId: string,
  detalles: {
    id: string
    guildId: string
    ejecutorId: string
    abiertoEn: string
    participantes: {
      reportantes: GrupoSoportePersistido
      reportados: GrupoSoportePersistido
      testigos: GrupoSoportePersistido
    }
    canales: { voz: string | null; evidencias: string | null }
    limpieza: { voz: boolean; evidencias: boolean }
    error: string
  },
) {
  const detalle = JSON.parse(JSON.stringify(detalles)) as Prisma.InputJsonValue
  await db.auditoria.create({
    data: {
      actorId,
      accion: 'soporte.creacion_fallida',
      entidad: 'Soporte',
      entidadId: detalles.id,
      detalle,
    },
  })
}

async function limpiarCanalesParciales(
  evidencias: TextChannel | undefined,
  voz: VoiceChannel | undefined,
  soporteId: string,
) {
  const resultado = { voz: !voz, evidencias: !evidencias }
  if (evidencias) {
    try {
      await evidencias.delete(`Limpieza del soporte incompleto ${soporteId}`)
      resultado.evidencias = true
    } catch (error) {
      console.error(`[Soporte ${soporteId}] No se pudo limpiar el canal de evidencias:`, error)
    }
  }
  if (voz) {
    try {
      await voz.delete(`Limpieza del soporte incompleto ${soporteId}`)
      resultado.voz = true
    } catch (error) {
      console.error(`[Soporte ${soporteId}] No se pudo limpiar el canal de voz:`, error)
    }
  }
  return resultado
}

function crearEmbedSoporte(registro: RegistroSoporte) {
  const movimientos = registro.movimientosPendientes
    ? 'La incorporación inicial de participantes está en curso.'
    : registro.movimientos.length
    ? registro.movimientos.map((movimiento) => {
      const estado = movimiento.resultado === 'MOVIDO'
        ? 'incorporado a la sala'
        : movimiento.resultado === 'NO_CONECTADO'
          ? 'no estaba conectado a voz'
          : movimiento.resultado === 'SIN_PERMISOS'
            ? 'no se pudo mover: faltan permisos'
            : 'no se pudo mover; se notificará al Staff'
      return `• <@${movimiento.usuarioId}>: ${estado}.`
    }).join('\n')
    : 'No se seleccionaron participantes individuales para mover.'
  const descripción = [
    'Se ha habilitado este espacio para atender el asunto reportado. Las pruebas, documentos y antecedentes relacionados deberán adjuntarse en este canal. La información del procedimiento deberá mantenerse dentro de este espacio institucional.',
    '',
    `Sala de reunión: <#${registro.canalVozId}>`,
    'Adjunta imágenes, capturas, vídeos o documentos y agrega una explicación relacionada con cada antecedente. Discord aplicará los límites de tamaño de archivo del servidor.',
    '',
    'La audiencia puede grabarse únicamente con consentimiento explícito e individual. Aceptar, rechazar o retirar el consentimiento se realiza con los botones; permanecer en el canal no equivale a aceptar.',
    '',
    '**Incorporación inicial a voz**',
    movimientos,
    ...(registro.movimientos.some((movimiento) => movimiento.resultado === 'SIN_PERMISOS')
      ? ['', 'El bot no cuenta con todos los permisos necesarios para mover a los participantes conectados. El Staff puede incorporarlos manualmente.']
      : []),
  ].join('\n')

  return crearEmbed('SOPORTE INSTITUCIONAL — CHILE RP', descripción, coloresEmbed.principal)
    .addFields(
      { name: 'Identificador', value: `\`${registro.id}\``, inline: false },
      { name: 'Personas que reportan', value: resumenGrupo(registro.reportantes), inline: true },
      { name: 'Personas reportadas', value: resumenGrupo(registro.reportados), inline: true },
      { name: 'Testigos', value: resumenGrupo(registro.testigos), inline: true },
      { name: 'Moderador responsable', value: `<@${registro.ejecutorId}>`, inline: true },
      {
        name: 'Roles de supervisión',
        value: registro.rolesSupervision.map((id) => `<@&${id}>`).join(', ') || 'Ninguno',
        inline: false,
      },
      { name: 'Apertura', value: fechaHoraSoporte(registro.abiertoEn), inline: true },
      { name: 'Estado', value: registro.estado, inline: true },
      {
        name: 'Estado de grabación',
        value: `${registro.grabacion}\n${textoEstadoGrabacion(registro.grabacion)}`,
        inline: true,
      },
      { name: 'Consentimientos', value: resumenConsentimientos(registro.consentimientos), inline: false },
    )
}

function componentesControlesSoporte(
  registro: RegistroSoporte,
  deshabilitados = false,
  consentimientoDeshabilitado = false,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:finalizar`)
        .setLabel('Finalizar soporte')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(deshabilitados || registro.estado !== 'ABIERTO'),
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:canales`)
        .setLabel('Cerrar canales')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(deshabilitados),
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:consultar`)
        .setLabel('Consultar información')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(deshabilitados),
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:grabacion`)
        .setLabel('Estado de grabación')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(deshabilitados),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:detener-grabacion`)
        .setLabel('Finalizar grabación')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(
          deshabilitados ||
          !['ESPERANDO CONSENTIMIENTO', 'GRABANDO', 'PAUSADA'].includes(registro.grabacion),
        ),
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:acceder-grabacion`)
        .setLabel('Acceder a la grabación')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(deshabilitados || registro.grabacion !== 'FINALIZADA'),
      new ButtonBuilder()
        .setCustomId(`soporte:control:${registro.id}:eliminar-grabacion`)
        .setLabel('Eliminar grabación')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          deshabilitados ||
          !['FINALIZADA', 'ERROR'].includes(registro.grabacion) ||
          !registro.grabacionVenceEn,
        ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`soporte:consentimiento:${registro.id}:aceptar`)
        .setLabel('Consiento la grabación')
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          deshabilitados ||
          consentimientoDeshabilitado ||
          !registro.consentimientos.some(({ estado }) => estado === 'PENDIENTE') ||
          !['ESPERANDO CONSENTIMIENTO', 'PAUSADA'].includes(registro.grabacion),
        ),
      new ButtonBuilder()
        .setCustomId(`soporte:consentimiento:${registro.id}:rechazar`)
        .setLabel('No consiento')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(
          deshabilitados ||
          consentimientoDeshabilitado ||
          !registro.consentimientos.some(({ estado }) => estado === 'PENDIENTE') ||
          !['ESPERANDO CONSENTIMIENTO', 'PAUSADA'].includes(registro.grabacion),
        ),
      new ButtonBuilder()
        .setCustomId(`soporte:consentimiento:${registro.id}:retirar`)
        .setLabel('Retirar consentimiento')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          deshabilitados ||
          consentimientoDeshabilitado ||
          !registro.consentimientos.some(({ estado }) => estado === 'ACEPTADO') ||
          !['ESPERANDO CONSENTIMIENTO', 'GRABANDO', 'PAUSADA'].includes(registro.grabacion),
        ),
    ),
  ]
}

function resumenConsentimientos(consentimientos: readonly ConsentimientoGrabacion[]): string {
  if (!consentimientos.length) return 'No solicitados: la grabación no está disponible.'
  return consentimientos.map(({ discordId, estado }) =>
    `• <@${discordId}>: ${estado}`,
  ).join('\n')
}

async function anunciarEnSoporte(
  guild: Guild,
  registro: RegistroSoporte,
  texto: string,
  tipo: string,
): Promise<void> {
  try {
    const canalVoz = await guild.channels.fetch(registro.canalVozId)
    if (!canalVoz || canalVoz.type !== ChannelType.GuildVoice) {
      throw new Error('El canal de voz del soporte no está disponible para reproducir TTS.')
    }
    const grabador = grabadoresSoporte.get(registro.id)
    await reproducirAnuncioSoporte(
      canalVoz,
      texto,
      grabador?.conexion,
      grabador
        ? (rutaOgg, inicioMonotono) => grabador.registrarAudioBot(rutaOgg, inicioMonotono)
        : undefined,
    )
    await registrarEventoSoporte(null, registro, 'anuncio_tts_reproducido', {
      tipo,
      proveedor: 'Microsoft Edge Read Aloud',
      voz: VOZ_TTS_SOPORTE,
    }).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo auditar el anuncio TTS:`, error)
    })
  } catch (error) {
    console.error(`[Soporte ${registro.id}] No se pudo reproducir el anuncio TTS (${tipo}):`, error)
    await registrarEventoSoporte(null, registro, 'anuncio_tts_error', {
      tipo,
      voz: VOZ_TTS_SOPORTE,
      error: mensajeSeguro(error),
    }).catch((errorAuditoria: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo auditar el fallo TTS:`, errorAuditoria)
    })
    try {
      const canalTexto = await guild.channels.fetch(registro.canalEvidenciasId)
      if (canalTexto?.type === ChannelType.GuildText) {
        await canalTexto.send({
          content: `**Aviso institucional (anuncio de voz no disponible):** ${texto}`,
          allowedMentions: { parse: [] },
        })
      }
    } catch (errorNotificacion) {
      console.error(`[Soporte ${registro.id}] Tampoco se pudo publicar el aviso TTS en texto:`, errorNotificacion)
    }
  }
}

function fechaHoraSoporte(fecha: string) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(new Date(fecha))
}

function textoEstadoGrabacion(estado: EstadoGrabacionSoporte): string {
  if (estado === 'ESPERANDO CONSENTIMIENTO') {
    return 'No se captura audio hasta que cada participante acepte individualmente.'
  }
  if (estado === 'PAUSADA') {
    return 'La captura está detenida temporalmente o espera a que un participante autorizado se conecte.'
  }
  if (estado === 'NO DISPONIBLE') return 'El soporte continúa sin grabación.'
  if (estado === 'ERROR') return 'La captura falló; el soporte continúa sin grabación activa.'
  if (estado === 'FINALIZADA') return 'La captura terminó; consulta la fecha de vencimiento.'
  return 'Captura activa tras recibir y decodificar audio.'
}

async function manejarConsentimientoGrabacion(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  if (!i.isButton()) return
  await i.deferUpdate()
  const soporteId = partes[2]
  return ejecutarEnColaSoporte(soporteId, async () => {
  const guild = i.guild
  const accion = partes[3]
  const registro = registrosSoporteActivos.get(soporteId) ?? await leerRegistroSoporte(soporteId)
  const grabador = grabadoresSoporte.get(soporteId)
  if (!guild || !registro || !grabador || registro.guildId !== i.guildId ||
      i.channelId !== registro.canalEvidenciasId) {
    return i.followUp({
      content: 'La solicitud de consentimiento ya no está disponible. El soporte puede continuar sin grabación.',
      flags: efimero,
    })
  }
  if (
    accion !== 'retirar' &&
    !['ESPERANDO CONSENTIMIENTO', 'PAUSADA'].includes(registro.grabacion)
  ) {
    return i.followUp({
      content: `No se puede cambiar el consentimiento mientras la grabación está en estado ${registro.grabacion}.`,
      flags: efimero,
    })
  }

  const consentimiento = registro.consentimientos.find(({ discordId }) => discordId === i.user.id)
  if (!consentimiento) {
    return i.followUp({
      content: 'No puedes responder por otra persona ni aceptar en nombre de un participante.',
      flags: efimero,
    })
  }

  let estado: EstadoConsentimientoSoporte
  if (accion === 'aceptar' && consentimiento.estado === 'PENDIENTE') {
    estado = 'ACEPTADO'
  } else if (accion === 'rechazar' && consentimiento.estado === 'PENDIENTE') {
    estado = 'RECHAZADO'
  } else if (accion === 'retirar' && consentimiento.estado === 'ACEPTADO') {
    estado = 'RETIRADO'
  } else {
    return i.followUp({
      content: 'La acción no coincide con tu estado de consentimiento actual.',
      flags: efimero,
    })
  }

  const actor = await asegurarUsuario(i.user)
  const actualizadoEn = new Date().toISOString()
  registro.consentimientos = registro.consentimientos.map((actual) =>
    actual.discordId === i.user.id
      ? { ...actual, estado, actualizadoEn }
      : actual,
  )
  grabador.manifiesto.consentimientos = registro.consentimientos
  await grabador.actualizarConsentimientos(registro.consentimientos)
  registrosSoporteActivos.set(soporteId, registro)
  const canalesRetiroRegistrado = await registrarEventoGrabacion(
    guild,
    actor.id,
    registro,
    `consentimiento_${estado.toLowerCase()}`,
    {
    participanteId: i.user.id,
    estado,
    actualizadoEn,
    },
  )
  await actualizarMensajeSoporte(guild, registro).catch((error: unknown) => {
    console.error(`[Soporte ${soporteId}] No se pudo actualizar el consentimiento en el expediente:`, error)
  })

  if (estado === 'RECHAZADO') {
    const actualizado = await detenerGrabacionSoporte(
      guild,
      actor.id,
      registro,
      'consentimiento_rechazado',
    )
    await anunciarEnSoporte(
      guild,
      actualizado,
      anunciosTtsSoporte.consentimientoRechazado,
      'consentimiento_rechazado',
    )
    return i.followUp({
      content: 'Se registró tu rechazo. No se iniciará o reanudará la grabación; el soporte continúa.',
      flags: efimero,
    })
  }

  if (estado === 'RETIRADO') {
    const actualizado = await detenerGrabacionSoporte(
      guild,
      actor.id,
      registro,
      'consentimiento_retirado',
    )
    await anunciarEnSoporte(
      guild,
      actualizado,
      anunciosTtsSoporte.consentimientoRetirado,
      'consentimiento_retirado',
    )
    const cierre = await cerrarSoportePorRetiroConsentimiento(
      guild,
      actor.id,
      actualizado,
      i.user.id,
      canalesRetiroRegistrado,
    )
    return i.followUp({
      content: cierre.canalesEliminados
        ? `Se retiró tu consentimiento. La captura se detuvo y el soporte \`${soporteId}\` se cerró; se registró el evento y se eliminaron sus canales.`
        : cierre.cerrado && !cierre.eliminacionIntentada
          ? `Se retiró tu consentimiento y el soporte \`${soporteId}\` se cerró. Conservé los canales para proteger la evidencia porque no se pudo confirmar su registro completo en los logs institucionales.`
          : cierre.cerrado
            ? `Se cerró el soporte \`${soporteId}\`, pero no se pudieron eliminar ambos canales. El resultado quedó en los registros institucionales.`
            : `Se detuvo la captura, pero no se pudo persistir el cierre del soporte \`${soporteId}\`. Los canales se conservaron y se notificó el error.`,
      flags: efimero,
    })
  }

  await sincronizarGrabacionConConsentimientos(guild, actor.id, registro)
  return i.followUp({
    content: 'Tu consentimiento quedó registrado. La grabación solo iniciará si todos los participantes aceptan.',
    flags: efimero,
  })
  }).catch(async (error: unknown) => {
    console.error(`[Soporte ${soporteId}] No se pudo persistir un cambio de consentimiento:`, error)
    if (i.guild && grabadoresSoporte.has(soporteId)) {
      await manejarErrorGrabacion(soporteId, i.guild, null, error).catch((errorInterno: unknown) => {
        console.error(`[Soporte ${soporteId}] No se pudo detener tras fallar el registro de consentimiento:`, errorInterno)
      })
    }
    await i.followUp({
      content: 'No se pudo guardar el consentimiento de forma segura. La grabación se detuvo; el soporte puede continuar sin grabación.',
      flags: efimero,
    }).catch((errorRespuesta: unknown) => {
      const codigo = typeof errorRespuesta === 'object' && errorRespuesta !== null && 'code' in errorRespuesta
        ? (errorRespuesta as { code?: number }).code
        : undefined
      if (![10003, 10008, 10062].includes(codigo ?? 0)) throw errorRespuesta
    })
  })
}

async function ejecutarEnColaSoporte<T>(soporteId: string, operacion: () => Promise<T>): Promise<T> {
  const anterior = colasOperacionesSoporte.get(soporteId) ?? Promise.resolve()
  let liberar: () => void = () => undefined
  const turno = new Promise<void>((resolveTurno) => { liberar = resolveTurno })
  const siguiente = anterior.catch(() => undefined).then(() => turno)
  colasOperacionesSoporte.set(soporteId, siguiente)
  await anterior.catch(() => undefined)
  try {
    return await operacion()
  } finally {
    liberar()
    if (colasOperacionesSoporte.get(soporteId) === siguiente) {
      colasOperacionesSoporte.delete(soporteId)
    }
  }
}

async function sincronizarGrabacionConConsentimientos(
  guild: Guild,
  actorId: string | null,
  registro: RegistroSoporte,
): Promise<void> {
  const grabador = grabadoresSoporte.get(registro.id)
  if (!grabador) return
  const consentimientoPendiente = registro.consentimientos.some(({ estado }) => estado !== 'ACEPTADO')
  if (consentimientoPendiente) {
    if (registro.grabacion === 'GRABANDO') {
      grabador.pausarCaptura()
      registro.grabacion = 'PAUSADA'
      await grabador.actualizarEstado('PAUSADA')
      await registrarEventoGrabacion(guild, actorId, registro, 'grabacion.pausada', {
        motivo: 'Falta consentimiento explícito de todos los participantes.',
      })
      await actualizarMensajeSoporte(guild, registro)
    }
    return
  }

  const canal = await guild.channels.fetch(registro.canalVozId)
  if (!canal || canal.type !== ChannelType.GuildVoice) {
    await manejarErrorGrabacion(
      registro.id,
      guild,
      actorId,
      new Error('El canal de voz ya no está disponible.'),
    )
    return
  }

  const conectados = [...canal.members.values()]
    .filter((miembro) => !miembro.user.bot)
    .map((miembro) => miembro.id)
  const aceptados = new Set(
    registro.consentimientos
      .filter(({ estado }) => estado === 'ACEPTADO')
      .map(({ discordId }) => discordId),
  )
  const nuevos = conectados.filter((discordId) => !aceptados.has(discordId))
  if (nuevos.length) {
    grabador.pausarCaptura()
    const agregados = crearConsentimientosPendientes(nuevos)
    registro.consentimientos = [...registro.consentimientos, ...agregados]
    registro.grabacion = grabador.manifiesto.iniciadaEn ? 'PAUSADA' : 'ESPERANDO CONSENTIMIENTO'
    await grabador.actualizarConsentimientos(registro.consentimientos)
    await grabador.actualizarEstado(registro.grabacion)
    registrosSoporteActivos.set(registro.id, registro)
    await registrarEventoGrabacion(guild, actorId, registro, 'participantes_pendientes', {
      participantes: nuevos,
      motivo: 'Participantes presentes en voz sin consentimiento.',
    })
    await actualizarMensajeSoporte(guild, registro)
    return
  }

  const idsAceptadosEnVoz = conectados.filter((discordId) => aceptados.has(discordId))
  if (idsAceptadosEnVoz.length === 0) {
    registro.grabacion = 'PAUSADA'
    await grabador.actualizarEstado('PAUSADA')
    registrosSoporteActivos.set(registro.id, registro)
    await registrarEventoGrabacion(guild, actorId, registro, 'grabacion.esperando_participantes', {
      participantesConConsentimiento: registro.consentimientos.map(({ discordId }) => discordId),
      aviso: 'Todos consintieron; la captura aún no inicia porque nadie autorizado está conectado a voz.',
    })
    await actualizarMensajeSoporte(guild, registro)
    return
  }
  const esReanudacion = registro.grabacion === 'PAUSADA' &&
    grabador.manifiesto.iniciadaEn !== null
  try {
    if (esReanudacion) await grabador.reanudarCaptura(idsAceptadosEnVoz)
    else await grabador.iniciarCaptura(idsAceptadosEnVoz)
    registro.grabacion = 'PAUSADA'
    await grabador.actualizarEstado('PAUSADA')
    registrosSoporteActivos.set(registro.id, registro)
    await registrarEventoGrabacion(
      guild,
      actorId,
      registro,
      esReanudacion ? 'grabacion.reanudada' : 'grabacion.consentimientos_completos',
      {
        participantesConConsentimiento: registro.consentimientos.map(({ discordId }) => discordId),
        participantesConectados: idsAceptadosEnVoz,
        aviso: 'El estado GRABANDO se mostrará solo después de recibir y decodificar un paquete Opus.',
      },
    )
    await actualizarMensajeSoporte(guild, registro)
  } catch (error) {
    await manejarErrorGrabacion(registro.id, guild, actorId, error)
  }
}

export async function manejarEstadoVozSoporte(
  estadoAnterior: import('discord.js').VoiceState,
  estadoNuevo: import('discord.js').VoiceState,
): Promise<void> {
  const miembro = estadoNuevo.member ?? estadoAnterior.member
  if (!miembro || miembro.user.bot) return
  const canalSoporteId = estadoNuevo.channelId ?? estadoAnterior.channelId
  if (!canalSoporteId) return

  for (const registro of registrosSoporteActivos.values()) {
    if (
      registro.canalVozId !== canalSoporteId ||
      registro.estado !== 'ABIERTO' ||
      !grabadoresSoporte.has(registro.id)
    ) continue

    await ejecutarEnColaSoporte(registro.id, async () => {
      if (!grabadoresSoporte.has(registro.id) || registro.estado !== 'ABIERTO') return
      const entro = estadoNuevo.channelId === canalSoporteId &&
        estadoAnterior.channelId !== canalSoporteId
      const salio = estadoAnterior.channelId === canalSoporteId &&
        estadoNuevo.channelId !== canalSoporteId
      const grabador = grabadoresSoporte.get(registro.id)
      if (!grabador) return

      if (entro) {
        await anunciarBienvenidaSoporte(estadoNuevo.guild, registro)
        let consentimiento = registro.consentimientos.find(({ discordId }) => discordId === miembro.id)
        if (!consentimiento) {
          if (registro.consentimientos.length >= limitePistasGrabacion) {
            await manejarErrorGrabacion(
              registro.id,
              estadoNuevo.guild,
              null,
              new Error(`El soporte superó el máximo seguro de ${limitePistasGrabacion} participantes de audio.`),
            )
            return
          }
          consentimiento = {
            discordId: miembro.id,
            estado: 'PENDIENTE',
            actualizadoEn: new Date().toISOString(),
          }
          registro.consentimientos.push(consentimiento)
          grabador.pausarCaptura()
          registro.grabacion = grabador.manifiesto.iniciadaEn ? 'PAUSADA' : 'ESPERANDO CONSENTIMIENTO'
          await grabador.actualizarConsentimientos(registro.consentimientos)
          await grabador.actualizarEstado(registro.grabacion)
          await registrarEventoGrabacion(estadoNuevo.guild, null, registro, 'participante_pendiente', {
            participanteId: miembro.id,
            motivo: 'Una persona ingresó al canal de voz y debe consentir antes de grabar.',
          })
          await actualizarMensajeSoporte(estadoNuevo.guild, registro)
          return
        }

        if (consentimiento.estado === 'ACEPTADO') {
          await sincronizarGrabacionConConsentimientos(estadoNuevo.guild, null, registro)
        } else {
          grabador.pausarCaptura()
          registro.grabacion = grabador.manifiesto.iniciadaEn ? 'PAUSADA' : 'ESPERANDO CONSENTIMIENTO'
          await grabador.actualizarEstado(registro.grabacion)
          await actualizarMensajeSoporte(estadoNuevo.guild, registro)
        }
      } else if (salio) {
        await grabador.retirarUsuario(miembro.id)
      }
    })
  }
}

async function manejarPrimerPaqueteGrabacion(
  soporteId: string,
  guild: Guild,
  participanteId: string,
): Promise<void> {
  const grabador = grabadoresSoporte.get(soporteId)
  const registro = registrosSoporteActivos.get(soporteId)
  if (
    !grabador ||
    !registro ||
    registro.estado !== 'ABIERTO' ||
    !grabador.estaCapturando ||
    grabador.manifiesto.estado !== 'GRABANDO'
  ) return
  registro.grabacion = 'GRABANDO'
  registro.grabacionIniciadaEn = grabador.manifiesto.iniciadaEn
  await grabador.actualizarEstado('GRABANDO')
  registrosSoporteActivos.set(soporteId, registro)
  await registrarEventoGrabacion(guild, null, registro, 'grabacion.iniciada', {
    primerEmisorId: participanteId,
    iniciadaEn: registro.grabacionIniciadaEn,
    comprobacion: 'Se recibió y decodificó un paquete Opus; se escribió PCM a la pista del participante.',
  })
  await actualizarMensajeSoporte(guild, registro)
  await anunciarEnSoporte(
    guild,
    registro,
    anunciosTtsSoporte.grabacionActiva,
    'grabacion_activa',
  )
}

async function manejarErrorGrabacion(
  soporteId: string,
  guild: Guild,
  actorId: string | null,
  error: unknown,
): Promise<void> {
  const registro = registrosSoporteActivos.get(soporteId) ?? await leerRegistroSoporte(soporteId)
  if (!registro || registro.estado !== 'ABIERTO') return
  const grabador = grabadoresSoporte.get(soporteId)
  if (!grabador) return
  const actualizado = await detenerGrabacionSoporte(
    guild,
    actorId,
    registro,
    'error',
    mensajeSeguro(error),
  )
  if (actualizado.grabacion === 'NO DISPONIBLE') {
    actualizado.grabacion = 'ERROR'
    actualizado.grabacionFinalizadaEn = new Date().toISOString()
    await registrarEventoGrabacion(guild, actorId, actualizado, 'grabacion.error', {
      error: mensajeSeguro(error),
    })
  }
  try {
    const canal = await guild.channels.fetch(registro.canalEvidenciasId)
    if (canal?.type === ChannelType.GuildText) {
      await canal.send({
        content: 'La captura de audio se detuvo por un error. El soporte permanece abierto sin grabación activa; el Staff autorizado fue notificado.',
        allowedMentions: { parse: [] },
      })
    }
  } catch (errorNotificacion) {
    console.error(`[Soporte ${soporteId}] No se pudo avisar del fallo en el canal de evidencias:`, errorNotificacion)
  }
  await anunciarEnSoporte(guild, actualizado, anunciosTtsSoporte.errorGrabacion, 'error_grabacion')
  await actualizarMensajeSoporte(guild, actualizado).catch((errorActualizacion: unknown) => {
    console.error(`[Soporte ${soporteId}] No se pudo actualizar el estado de grabación:`, errorActualizacion)
  })
}

async function detenerGrabacionSoporte(
  guild: Guild,
  actorId: string | null,
  registro: RegistroSoporte,
  evento: string,
  error?: string,
): Promise<RegistroSoporte> {
  const enCurso = finalizacionesGrabacion.get(registro.id)
  if (enCurso) return enCurso

  const operacion = (async () => {
    const grabador = grabadoresSoporte.get(registro.id)
    if (!grabador) return registro
    let actualizado = registro
    try {
      const resultado = await grabador.finalizar()
      actualizado = {
        ...registro,
        grabacion: resultado.manifiesto.estado,
        grabacionIniciadaEn: resultado.manifiesto.iniciadaEn,
        grabacionFinalizadaEn: resultado.manifiesto.finalizadaEn,
        grabacionVenceEn: resultado.manifiesto.venceEn,
        consentimientos: resultado.manifiesto.consentimientos,
      }
      registrosSoporteActivos.set(registro.id, actualizado)
      await registrarEventoGrabacion(guild, actorId, actualizado, `grabacion.${evento}`, {
        finalizadaEn: actualizado.grabacionFinalizadaEn,
        error: error ?? null,
      })
      if (resultado.manifiesto.estado === 'FINALIZADA' && resultado.mezclaPath) {
        const publicacion = await publicarGrabacionEnLogs(
          guild,
          actualizado,
          resultado.mezclaPath,
          resultado.pistas,
          async (mensaje) => {
            actualizado.mensajesLog.push(mensaje)
            registrosSoporteActivos.set(registro.id, actualizado)
            const erroresPersistencia: unknown[] = []
            await grabador.registrarMensajesLog([mensaje]).catch((error: unknown) => {
              erroresPersistencia.push(error)
            })
            await registrarEventoGrabacion(guild, actorId, actualizado, 'grabacion.adjunto_publicado', {
              mensajeLog: mensaje,
            }).catch((error: unknown) => { erroresPersistencia.push(error) })
            if (erroresPersistencia.length === 2) throw erroresPersistencia[0]
          },
        )
        actualizado.mensajesLog = publicacion.mensajes
        registrosSoporteActivos.set(registro.id, actualizado)
        await registrarEventoGrabacion(guild, actorId, actualizado, 'grabacion.archivos_publicados', {
          mensajesLog: publicacion.mensajes,
          publicadoEnCanales: [...new Set(publicacion.mensajes.map(({ canalId }) => canalId))],
          errores: publicacion.errores,
        })
      }
      await actualizarMensajeSoporte(guild, actualizado)
      return actualizado
    } catch (errorFinalizacion) {
      const actualizadoError: RegistroSoporte = {
        ...actualizado,
        grabacion: 'ERROR',
        grabacionFinalizadaEn: new Date().toISOString(),
        grabacionVenceEn: null,
      }
      registrosSoporteActivos.set(registro.id, actualizadoError)
      await registrarEventoGrabacion(guild, actorId, actualizadoError, 'grabacion.error', {
        eventoSolicitado: evento,
        error: mensajeSeguro(errorFinalizacion),
      })
      await actualizarMensajeSoporte(guild, actualizadoError).catch((errorActualizacion: unknown) => {
        console.error(`[Soporte ${registro.id}] No se pudo actualizar la tarjeta tras el error de audio:`, errorActualizacion)
      })
      return actualizadoError
    } finally {
      grabadoresSoporte.delete(registro.id)
      finalizacionesGrabacion.delete(registro.id)
    }
  })()
  finalizacionesGrabacion.set(registro.id, operacion)
  return operacion
}

async function registrarEventoGrabacion(
  guild: Guild | undefined,
  actorId: string | null,
  registro: RegistroSoporte,
  evento: string,
  detalles: Record<string, unknown> = {},
): Promise<string[]> {
  if (guild) guildsSoporteActivos.set(registro.id, guild)
  await actualizarGrabacionSoporteEnServicioStaff({
    soporteId: registro.id,
    estadoGrabacion: registro.grabacion,
    iniciadoEn: registro.grabacionIniciadaEn ? new Date(registro.grabacionIniciadaEn) : null,
    finalizadoEn: registro.grabacionFinalizadaEn ? new Date(registro.grabacionFinalizadaEn) : null,
  }).catch((error: unknown) => {
    console.error(`[Soporte ${registro.id}] No se pudo actualizar su grabación vinculada al servicio Staff:`, error)
  })
  return registrarEventoSoporte(actorId, registro, evento, detalles)
}

async function publicarEventoSoporteEnLogs(
  guild: Guild,
  actorId: string | null,
  registro: RegistroSoporte,
  evento: string,
  detalles: Record<string, unknown>,
): Promise<string[]> {
  const contenido = [
    `## Soporte · ${evento}`,
    `**Identificador:** \`${registro.id}\``,
    `**Estado de grabación:** ${registro.grabacion}`,
    `**Actor interno:** ${actorId ?? 'sistema'}`,
    `**Detalles:** ${JSON.stringify(detalles).replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 1200) || '—'}`,
    `**Fecha:** ${fechaHoraSoporte(new Date().toISOString())}`,
  ].join('\n')
  const resultados = await Promise.all([...new Set([
    config.canales.logModeracion,
    config.canales.logAdministracion,
  ])].map(async (canalId) => {
    try {
      const canal = await obtenerCanalLogSeguro(guild, canalId, false)
      if (!canal) return undefined
      await canal.send(comoComponentsV2({
        content: contenido,
        allowedMentions: { parse: [] },
      }))
      return canalId
    } catch (error) {
      console.error(`[Soporte ${registro.id}] No se pudo registrar ${evento} en el canal de logs ${canalId}:`, error)
      return undefined
    }
  }))
  return resultados.filter((canalId): canalId is string => !!canalId)
}

async function obtenerCanalLogSeguro(
  guild: Guild,
  canalId: string,
  requiereAdjuntos = true,
): Promise<TextChannel | NewsChannel | undefined> {
  const canal = await guild.channels.fetch(canalId).catch((error: unknown) => {
    console.error(`[Soporte] No se pudo acceder al canal de logs ${canalId}:`, error)
    return null
  })
  if (
    !canal ||
    (canal.type !== ChannelType.GuildText && canal.type !== ChannelType.GuildAnnouncement)
  ) return undefined

  const bot = await guild.members.fetchMe()
  const permisosBot = bot.permissionsIn(canal)
  if (
    !permisosBot.has(PermissionFlagsBits.ViewChannel) ||
    !permisosBot.has(PermissionFlagsBits.SendMessages) ||
    (requiereAdjuntos && !permisosBot.has(PermissionFlagsBits.AttachFiles))
  ) return undefined
  return canal
}

async function publicarGrabacionEnLogs(
  guild: Guild,
  registro: RegistroSoporte,
  mezclaPath: string,
  pistas: Array<{ discordId: string; path: string }>,
  alPublicar: (mensaje: MensajeGrabacionLog) => Promise<void>,
): Promise<{ mensajes: MensajeGrabacionLog[]; errores: string[] }> {
  const mensajes: MensajeGrabacionLog[] = []
  const errores: string[] = []
  for (const canalId of [...new Set([
    config.canales.logModeracion,
    config.canales.logAdministracion,
  ])]) {
    const canal = await obtenerCanalLogSeguro(guild, canalId)
    if (!canal) {
      const error = `Se omitió publicar audio en ${canalId}: el canal no es texto/anuncio o el bot no tiene permisos para verlo, enviar o adjuntar archivos.`
      errores.push(error)
      console.error(`[Soporte ${registro.id}] ${error}`)
      continue
    }
    try {
      const mensajeMezcla = await canal.send(comoComponentsV2({
        content: `Grabación finalizada del soporte \`${registro.id}\`. Vence: ${registro.grabacionVenceEn ? fechaHoraSoporte(registro.grabacionVenceEn) : 'sin fecha'}.`,
        files: [
          new AttachmentBuilder(mezclaPath, { name: `soporte-${registro.id}-mezcla.ogg` }),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`soporte:grabacion-log:${registro.id}:acceder`)
              .setLabel('Acceder a la grabación')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`soporte:grabacion-log:${registro.id}:eliminar`)
              .setLabel('Eliminar grabación')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
        allowedMentions: { parse: [] },
      }))
      const referenciaMezcla = { canalId, mensajeId: mensajeMezcla.id }
      mensajes.push(referenciaMezcla)
      await alPublicar(referenciaMezcla)
      if (pistas.length) {
        const mensajePistas = await canal.send(comoComponentsV2({
          content: `Pistas individuales del soporte \`${registro.id}\` (IDs de Discord).`,
          files: pistas.map(({ discordId, path }) =>
            new AttachmentBuilder(path, { name: `soporte-${registro.id}-participante-${discordId}.ogg` }),
          ),
          allowedMentions: { parse: [] },
        }))
        const referenciaPistas = { canalId, mensajeId: mensajePistas.id }
        mensajes.push(referenciaPistas)
        await alPublicar(referenciaPistas)
      }
    } catch (error) {
      errores.push(`No se pudieron publicar todos los audios en ${canalId}: ${mensajeSeguro(error)}`)
      console.error(`[Soporte ${registro.id}] No se pudieron publicar todos los audios en ${canalId}:`, error)
    }
  }
  return { mensajes, errores }
}

async function enviarGrabacionEfimera(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  guild: Guild,
  registro: RegistroSoporte,
) {
  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    return i.followUp({ content: 'No tienes autorización para acceder a grabaciones.', flags: efimero })
  }
  if (registro.grabacion !== 'FINALIZADA' || !config.grabaciones.directorio) {
    return i.followUp({ content: 'No hay una grabación finalizada disponible para este soporte.', flags: efimero })
  }
  const manifiesto = await leerManifiestoGrabacion(config.grabaciones.directorio, registro.id)
  if (!manifiesto?.mezcla) {
    return i.followUp({ content: 'El archivo no está disponible en el almacenamiento persistente.', flags: efimero })
  }
  const actor = await asegurarUsuario(i.user)
  await registrarEventoGrabacion(guild, actor.id, registro, 'grabacion.acceso', {
    autorizadoPorId: i.user.id,
    accesoEn: new Date().toISOString(),
  })

  const rutaMezcla = obtenerRutaArchivoGrabacion(
    config.grabaciones.directorio,
    registro.id,
    manifiesto.mezcla,
  )
  if (!await existeArchivoCompleto(rutaMezcla)) {
    return marcarGrabacionInvalida(i, guild, registro, new Error('La mezcla está ausente o incompleta.'), actor.id)
  }
  try {
    await verificarOgg(rutaMezcla)
  } catch (error) {
    return marcarGrabacionInvalida(i, guild, registro, error, actor.id)
  }
  try {
    await i.followUp({
      content: `Mezcla de audio · soporte \`${registro.id}\``,
      files: [new AttachmentBuilder(rutaMezcla, { name: `soporte-${registro.id}-mezcla.ogg` })],
      flags: efimero,
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Soporte ${registro.id}] Discord no permitió entregar la mezcla a Staff:`, error)
    return i.followUp({
      content: 'Discord no permitió entregar el archivo (posible límite de tamaño o permisos). La grabación sigue conservada; revisa los canales de logs seguros.',
      flags: efimero,
      allowedMentions: { parse: [] },
    })
  }

  const pistas = manifiesto.pistas
    .map(({ discordId, archivo }) => ({
      discordId,
      path: obtenerRutaArchivoGrabacion(config.grabaciones.directorio!, registro.id, archivo),
    }))
  const validas: AttachmentBuilder[] = []
  const pistasInvalidas: string[] = []
  for (const pista of pistas) {
    try {
      if (!await existeArchivoCompleto(pista.path)) {
        pistasInvalidas.push(pista.discordId)
        continue
      }
      await verificarOgg(pista.path)
      validas.push(new AttachmentBuilder(pista.path, {
        name: `soporte-${registro.id}-participante-${pista.discordId}.ogg`,
      }))
    } catch (error) {
      pistasInvalidas.push(pista.discordId)
      console.error(`[Soporte ${registro.id}] La pista de ${pista.discordId} está dañada:`, error)
    }
  }
  if (pistasInvalidas.length) {
    await registrarEventoGrabacion(guild, actor.id, registro, 'grabacion.pistas_dañadas', {
      participantes: pistasInvalidas,
    })
  }
  if (validas.length) {
    try {
      await i.followUp({
        content: `Pistas individuales de audio · soporte \`${registro.id}\``,
        files: validas,
        flags: efimero,
        allowedMentions: { parse: [] },
      })
    } catch (error) {
      console.error(`[Soporte ${registro.id}] No se pudieron entregar las pistas individuales a Staff:`, error)
      await i.followUp({
        content: 'No se pudieron entregar una o más pistas individuales (posible límite de tamaño). La mezcla sí se envió y los originales siguen conservados.',
        flags: efimero,
        allowedMentions: { parse: [] },
      })
    }
  }
}

async function marcarGrabacionInvalida(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  guild: Guild,
  registro: RegistroSoporte,
  error: unknown,
  actorId: string | null,
) {
  const actualizado: RegistroSoporte = { ...registro, grabacion: 'ERROR' }
  registrosSoporteActivos.set(registro.id, actualizado)
  if (config.grabaciones.directorio) {
    try {
      const manifiesto = await leerManifiestoGrabacion(config.grabaciones.directorio, registro.id)
      if (manifiesto) {
        manifiesto.estado = 'ERROR'
        await guardarManifiestoGrabacion(config.grabaciones.directorio, manifiesto)
      }
    } catch (errorPersistencia) {
      console.error(`[Soporte ${registro.id}] No se pudo marcar el manifiesto con error de integridad:`, errorPersistencia)
    }
  }
  await registrarEventoGrabacion(guild, actorId, actualizado, 'grabacion.archivo_invalido', {
    error: mensajeSeguro(error),
  })
  await actualizarMensajeSoporte(guild, actualizado).catch((errorActualizacion: unknown) => {
    console.error(`[Soporte ${registro.id}] No se pudo actualizar el estado de integridad:`, errorActualizacion)
  })
  return i.followUp({
    content: 'La grabación no pasó la verificación de integridad; no se envió ningún archivo. Staff fue notificado y la retención sigue vigente.',
    flags: efimero,
  })
}

async function manejarControlGrabacionLog(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  if (!i.isButton()) return
  await i.deferUpdate()
  const guild = i.guild
  const soporteId = partes[2]
  const accion = partes[3]
  if (
    !guild ||
    ![config.canales.logModeracion, config.canales.logAdministracion].includes(i.channelId ?? '')
  ) {
    return i.followUp({ content: 'Este control solo está disponible en los canales institucionales de logs.', flags: efimero })
  }
  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    return i.followUp({ content: 'No tienes autorización para administrar grabaciones.', flags: efimero })
  }
  const registro = await leerRegistroSoporte(soporteId)
  if (!registro || registro.guildId !== guild.id) {
    return i.followUp({ content: 'No se encontró el expediente de soporte.', flags: efimero })
  }
  guildsSoporteActivos.set(registro.id, guild)
  if (accion === 'acceder') return enviarGrabacionEfimera(i, guild, registro)
  if (accion === 'eliminar') return iniciarConfirmacionEliminacionGrabacion(i, registro)
}

async function iniciarConfirmacionEliminacionGrabacion(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  registro: RegistroSoporte,
) {
  if (!i.isButton()) return
  const nonce = crearNonceConfirmacion()
  confirmacionesGrabacion.set(nonce, {
    soporteId: registro.id,
    ejecutorId: i.user.id,
    venceEn: Date.now() + duracionConfirmacionEliminacionMs,
  })
  return i.followUp({
    content:
      `Vas a eliminar los archivos de audio del soporte \`${registro.id}\` y sus mensajes adjuntos en ambos canales de logs. ` +
      'El registro de auditoría en la base de datos se conservará. ¿Confirmas?',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`soporte:eliminar-grabacion:${registro.id}:${nonce}:confirmar`)
          .setLabel('Confirmar eliminación')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`soporte:eliminar-grabacion:${registro.id}:${nonce}:cancelar`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: efimero,
    allowedMentions: { parse: [] },
  })
}

function crearNonceConfirmacion(): string {
  return randomUUID().replace(/-/g, '').slice(0, 22)
}

async function manejarConfirmacionEliminacionGrabacion(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  if (!i.isButton()) return
  await i.deferUpdate()
  const guild = i.guild
  const soporteId = partes[2]
  const nonce = partes[3]
  const accion = partes[4]
  const confirmacion = confirmacionesGrabacion.get(nonce)
  if (
    !guild ||
    !confirmacion ||
    confirmacion.soporteId !== soporteId ||
    confirmacion.ejecutorId !== i.user.id ||
    confirmacion.venceEn <= Date.now()
  ) {
    confirmacionesGrabacion.delete(nonce)
    return i.editReply({
      content: 'La confirmación expiró o ya no está disponible. No se eliminó ningún archivo.',
      components: [],
    })
  }
  if (accion === 'cancelar') {
    confirmacionesGrabacion.delete(nonce)
    return i.editReply({ content: 'Se canceló la eliminación; los archivos se conservaron.', components: [] })
  }
  if (accion !== 'confirmar') {
    return i.editReply({ content: 'La confirmación no es válida.', components: [] })
  }

  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    confirmacionesGrabacion.delete(nonce)
    return i.editReply({
      content: 'Tu autorización cambió. No se eliminó ningún archivo.',
      components: [],
    })
  }
  if (eliminacionesGrabacionEnCurso.has(soporteId)) {
    return i.editReply({ content: 'La eliminación de esta grabación ya está en curso.', components: [] })
  }
  eliminacionesGrabacionEnCurso.add(soporteId)
  confirmacionesGrabacion.delete(nonce)
  try {
    const registro = await leerRegistroSoporte(soporteId)
    if (
      !registro ||
      registro.guildId !== guild.id ||
      !['FINALIZADA', 'ERROR'].includes(registro.grabacion) ||
      !registro.grabacionVenceEn
    ) {
      return i.editReply({
        content: 'No existe una grabación finalizada para eliminar.',
        components: [],
      })
    }
    const actor = await asegurarUsuario(i.user)
    const resultado = await eliminarGrabacionSoporte(guild, actor.id, registro, false)
    return i.editReply({
      content: resultado.completo
        ? `Se eliminaron los archivos de \`${soporteId}\`. La auditoría se conservó.`
        : `Se eliminaron los archivos locales de \`${soporteId}\`, pero algunos adjuntos de logs no pudieron borrarse y quedarán pendientes de reintento. La auditoría se conservó.`,
      components: [],
    })
  } catch (error) {
    console.error(`[Soporte ${soporteId}] Falló la eliminación manual de la grabación:`, error)
    return i.editReply({
      content: 'No se pudo completar la eliminación. No se borró el registro de auditoría.',
      components: [],
    })
  } finally {
    eliminacionesGrabacionEnCurso.delete(soporteId)
  }
}

async function eliminarGrabacionSoporte(
  guild: Guild | undefined,
  actorId: string | null,
  registro: RegistroSoporte,
  automatica: boolean,
): Promise<{ completo: boolean; actualizado: RegistroSoporte }> {
  if (!config.grabaciones.directorio) {
    throw new Error('SOPORTE_GRABACIONES_DIR no está configurado.')
  }
  const manifiesto = await leerManifiestoGrabacion(config.grabaciones.directorio, registro.id)
  const evento = automatica ? 'grabacion.eliminacion_automatica' : 'grabacion.eliminacion_manual'
  await registrarEventoGrabacion(guild, actorId, registro, `${evento}_iniciada`, {
    motivo: automatica ? 'Retención vencida.' : 'Solicitud confirmada por Staff.',
    venceEn: manifiesto?.venceEn ?? registro.grabacionVenceEn,
  })

  const mensajesPendientes: MensajeGrabacionLog[] = []
  const mensajesLog = [...new Map(
    [...(manifiesto?.mensajesLog ?? []), ...registro.mensajesLog]
      .map((mensaje) => [`${mensaje.canalId}:${mensaje.mensajeId}`, mensaje] as const),
  ).values()]
  for (const mensaje of mensajesLog) {
    if (!guild) {
      mensajesPendientes.push(mensaje)
      continue
    }
    try {
      const canal = await guild.channels.fetch(mensaje.canalId).catch((error: unknown) => {
        if (codigoDiscord(error) === 10003) return null
        throw error
      })
      if (!canal) continue
      if (canal.type !== ChannelType.GuildText) {
        mensajesPendientes.push(mensaje)
        continue
      }
      const existente = await canal.messages.fetch(mensaje.mensajeId).catch((error: unknown) => {
        if (codigoDiscord(error) === 10008) return null
        if (codigoDiscord(error) === 10003) return null
        throw error
      })
      if (existente) await existente.delete()
    } catch (error) {
      mensajesPendientes.push(mensaje)
      console.error(`[Soporte ${registro.id}] No se pudo eliminar el adjunto de logs ${mensaje.mensajeId}:`, error)
    }
  }

  if (manifiesto) {
    await eliminarContenidoAudioGrabacion(config.grabaciones.directorio, manifiesto)
    manifiesto.mensajesLog = mensajesPendientes
    manifiesto.estado = 'NO DISPONIBLE'
    manifiesto.venceEn = mensajesPendientes.length
      ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      : manifiesto.venceEn
    if (mensajesPendientes.length) {
      await guardarManifiestoGrabacion(config.grabaciones.directorio, manifiesto)
    } else {
      await eliminarArchivosGrabacion(config.grabaciones.directorio, registro.id)
    }
  } else {
    await eliminarArchivosGrabacion(config.grabaciones.directorio, registro.id)
  }

  const actualizado: RegistroSoporte = {
    ...registro,
    grabacion: 'NO DISPONIBLE',
    grabacionVenceEn: null,
    mensajesLog: mensajesPendientes,
  }
  registrosSoporteActivos.set(registro.id, actualizado)
  await registrarEventoGrabacion(guild, actorId, actualizado, evento, {
    eliminadoEn: new Date().toISOString(),
    mensajesPendientes,
    auditoriaConservada: true,
  })
  if (guild) {
    await actualizarMensajeSoporte(guild, actualizado).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo actualizar el estado tras eliminar audio:`, error)
    })
  }
  return { completo: mensajesPendientes.length === 0, actualizado }
}

async function manejarControlSoporte(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  const guild = i.guild
  if (!guild) {
    return i.reply({ content: 'Esta interacción ya no está disponible en el servidor.', flags: efimero })
  }
  if (!i.isButton()) return
  await i.deferUpdate()
  const soporteId = partes[2]
  const accion = partes[3]
  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    return i.followUp({ content: 'No tienes autorización para administrar este soporte.', flags: efimero })
  }

  const registro = await leerRegistroSoporte(soporteId)
  if (!registro || registro.guildId !== i.guildId) {
    return i.followUp({ content: 'No se encontró el expediente de soporte solicitado.', flags: efimero })
  }
  guildsSoporteActivos.set(registro.id, guild)
  if (i.channelId !== registro.canalEvidenciasId) {
    return i.followUp({ content: 'Este control solo puede usarse desde el canal de evidencias asociado.', flags: efimero })
  }

  if (accion === 'consultar') {
    return i.followUp({
      content: contenidoConsultaSoporte(registro),
      flags: efimero,
      allowedMentions: { parse: [] },
    })
  }
  if (accion === 'grabacion') {
    return i.followUp({
      content: contenidoEstadoGrabacion(registro),
      flags: efimero,
      allowedMentions: { parse: [] },
    })
  }
  if (accion === 'detener-grabacion') {
    const actor = await asegurarUsuario(i.user)
    const actualizado = await detenerGrabacionSoporte(
      guild,
      actor.id,
      registro,
      'finalizacion_manual',
    )
    return i.followUp({
      content: `Estado de grabación: **${actualizado.grabacion}**.`,
      flags: efimero,
      allowedMentions: { parse: [] },
    })
  }
  if (accion === 'acceder-grabacion') {
    return enviarGrabacionEfimera(i, guild, registro)
  }
  if (accion === 'eliminar-grabacion') {
    return iniciarConfirmacionEliminacionGrabacion(i, registro)
  }
  if (accion === 'canales') {
    if (registro.estado !== 'CERRADO') {
      return i.followUp({
        content: 'Primero debes finalizar el soporte. Los canales no se eliminan automáticamente.',
        flags: efimero,
      })
    }
    return iniciarConfirmacionEliminacion(i, registro)
  }
  if (accion === 'finalizar') return finalizarSoporte(i, guild, registro)
}

async function finalizarSoporte(i: ButtonInteraction, guild: Guild, registro: RegistroSoporte) {
  if (registro.estado === 'CERRADO') {
    return i.followUp({ content: 'Este soporte ya está cerrado.', flags: efimero })
  }
  if (registro.estado !== 'ABIERTO' || cierresEnCurso.has(registro.id)) {
    return i.followUp({ content: 'El soporte no se encuentra disponible para cierre.', flags: efimero })
  }
  cierresEnCurso.add(registro.id)
  try {
    const actor = await asegurarUsuario(i.user)
    const registroConGrabacionFinalizada = await detenerGrabacionSoporte(
      guild,
      actor.id,
      registro,
      'cierre_soporte',
    )
    const actualizado: RegistroSoporte = {
      ...registro,
      ...registroConGrabacionFinalizada,
      estado: 'CERRADO',
      cerradoEn: new Date().toISOString(),
      cerradoPorId: i.user.id,
    }
    await registrarEventoSoporte(actor.id, actualizado, 'cierre', {
      cerradoPorId: i.user.id,
      cerradoEn: actualizado.cerradoEn,
    })
    await cerrarSoporteEnServicioStaff({
      soporteId: registro.id,
      finalizadoEn: new Date(actualizado.cerradoEn ?? Date.now()),
      grabacionIniciadaEn: actualizado.grabacionIniciadaEn
        ? new Date(actualizado.grabacionIniciadaEn)
        : null,
      grabacionFinalizadaEn: actualizado.grabacionFinalizadaEn
        ? new Date(actualizado.grabacionFinalizadaEn)
        : null,
      estadoGrabacion: actualizado.grabacion,
      resultado: 'CERRADO',
    }).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo cerrar su actividad de servicio Staff:`, error)
    })
    let mensajeActualizado = true
    try {
      await actualizarMensajeSoporte(guild, actualizado)
    } catch (error) {
      mensajeActualizado = false
      console.error(`[Soporte ${registro.id}] Se cerró el caso, pero no se pudo actualizar su mensaje:`, error)
      await registrarEventoSoporte(actor.id, actualizado, 'error_actualizacion_mensaje', {
        error: mensajeSeguro(error),
      }).catch((errorAuditoria: unknown) => {
        console.error(`[Soporte ${registro.id}] No se pudo auditar el error de actualización:`, errorAuditoria)
      })
    }
    return i.followUp({
      content: mensajeActualizado
        ? `Soporte \`${registro.id}\` finalizado. Los canales permanecen disponibles hasta que un miembro autorizado confirme su cierre.`
        : `Soporte \`${registro.id}\` finalizado y registrado, pero no pude actualizar el mensaje institucional. Los canales siguen disponibles.`,
      flags: efimero,
    })
  } finally {
    cierresEnCurso.delete(registro.id)
  }
}

async function cerrarSoportePorRetiroConsentimiento(
  guild: Guild,
  actorId: string,
  registro: RegistroSoporte,
  participanteId: string,
  canalesRetiroRegistrado: string[],
): Promise<{
  cerrado: boolean
  canalesEliminados: boolean
  eliminacionIntentada: boolean
}> {
  if (registro.estado !== 'ABIERTO' || cierresEnCurso.has(registro.id)) {
    return { cerrado: false, canalesEliminados: false, eliminacionIntentada: false }
  }
  cierresEnCurso.add(registro.id)
  try {
    const cerrado: RegistroSoporte = {
      ...registro,
      estado: 'CERRADO',
      cerradoEn: new Date().toISOString(),
      cerradoPorId: participanteId,
    }
    registrosSoporteActivos.set(registro.id, cerrado)
    let canalesCierreRegistrado: string[]
    try {
      canalesCierreRegistrado = await registrarEventoSoporte(
        actorId,
        cerrado,
        'cierre_por_retiro_consentimiento',
        {
          participanteId,
          consentimiento: 'RETIRADO',
          motivo: 'El soporte se cierra automáticamente para respetar el retiro del consentimiento.',
        },
      )
    } catch (error) {
      console.error(`[Soporte ${registro.id}] No se pudo persistir el cierre por retiro de consentimiento:`, error)
      await actualizarMensajeSoporte(guild, cerrado).catch((errorMensaje: unknown) => {
        console.error(`[Soporte ${registro.id}] No se pudo actualizar el expediente cerrado:`, errorMensaje)
      })
      return { cerrado: false, canalesEliminados: false, eliminacionIntentada: false }
    }

    await cerrarSoporteEnServicioStaff({
      soporteId: registro.id,
      finalizadoEn: new Date(cerrado.cerradoEn ?? Date.now()),
      grabacionIniciadaEn: cerrado.grabacionIniciadaEn
        ? new Date(cerrado.grabacionIniciadaEn)
        : null,
      grabacionFinalizadaEn: cerrado.grabacionFinalizadaEn
        ? new Date(cerrado.grabacionFinalizadaEn)
        : null,
      estadoGrabacion: cerrado.grabacion,
      resultado: 'CERRADO_POR_RETIRO_DE_CONSENTIMIENTO',
    }).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo cerrar su actividad de servicio Staff:`, error)
    })

    await actualizarMensajeSoporte(guild, cerrado).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo actualizar el expediente cerrado:`, error)
    })

    const canalesRequeridos = [...new Set([
      config.canales.logModeracion,
      config.canales.logAdministracion,
    ])]
    const puedeEliminar = puedeEliminarTrasRetirarConsentimiento(
      canalesRequeridos,
      canalesRetiroRegistrado,
      canalesCierreRegistrado,
      cerrado.mensajesLog.map(({ canalId }) => canalId),
      cerrado.grabacion === 'FINALIZADA',
    )
    if (!puedeEliminar) {
      return { cerrado: true, canalesEliminados: false, eliminacionIntentada: false }
    }

    const voz = await eliminarCanalSoporte(
      guild,
      cerrado.canalVozId,
      'Retiro de consentimiento; cierre automático del soporte',
    )
    const evidencias = await eliminarCanalSoporte(
      guild,
      cerrado.canalEvidenciasId,
      'Retiro de consentimiento; cierre automático del soporte',
    )
    const actualizado: RegistroSoporte = {
      ...cerrado,
      canalesEliminados: { voz: voz.eliminado, evidencias: evidencias.eliminado },
    }
    registrosSoporteActivos.set(registro.id, actualizado)
    await registrarEventoSoporte(actorId, actualizado, 'canales_eliminados_por_retiro_consentimiento', {
      participanteId,
      voz: voz.eliminado,
      errorVoz: voz.error,
      evidencias: evidencias.eliminado,
      errorEvidencias: evidencias.error,
    }).catch((error: unknown) => {
      console.error(`[Soporte ${registro.id}] No se pudo auditar el resultado de eliminación automática:`, error)
    })
    return {
      cerrado: true,
      canalesEliminados: voz.eliminado && evidencias.eliminado,
      eliminacionIntentada: true,
    }
  } finally {
    cierresEnCurso.delete(registro.id)
  }
}

async function actualizarMensajeSoporte(guild: Guild, registro: RegistroSoporte) {
  if (!registro.mensajeInicialId) return
  const canal = await guild.channels.fetch(registro.canalEvidenciasId)
  if (!canal || canal.type !== ChannelType.GuildText) {
    throw new Error('El canal de evidencias ya no está disponible para actualizar el expediente.')
  }
  const mensaje = await canal.messages.fetch(registro.mensajeInicialId)
  await mensaje.edit({
    embeds: [crearEmbedSoporte(registro)],
    components: componentesControlesSoporte(registro),
    allowedMentions: { parse: [] },
  })
}

async function iniciarConfirmacionEliminacion(i: ButtonInteraction, registro: RegistroSoporte) {
  const nonce = crearNonceConfirmacion()
  confirmacionesEliminacion.set(nonce, {
    soporteId: registro.id,
    ejecutorId: i.user.id,
    venceEn: Date.now() + duracionConfirmacionEliminacionMs,
  })
  return i.followUp({
    content:
      `Vas a eliminar los canales de soporte \`${registro.id}\`. ` +
      'El expediente y sus registros de auditoría se conservarán. ¿Confirmas?',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`soporte:eliminar:${registro.id}:${nonce}:confirmar`)
          .setLabel('Confirmar eliminación')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`soporte:eliminar:${registro.id}:${nonce}:cancelar`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: efimero,
    allowedMentions: { parse: [] },
  })
}

async function manejarConfirmacionEliminacion(
  i: ButtonInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction,
  partes: string[],
) {
  const guild = i.guild
  if (!guild) {
    return i.reply({ content: 'Esta interacción ya no está disponible en el servidor.', flags: efimero })
  }
  if (!i.isButton()) return
  await i.deferUpdate()
  const soporteId = partes[2]
  const nonce = partes[3]
  const accion = partes[4]
  const confirmacion = confirmacionesEliminacion.get(nonce)

  if (!confirmacion || confirmacion.soporteId !== soporteId ||
      confirmacion.ejecutorId !== i.user.id || confirmacion.venceEn <= Date.now()) {
    confirmacionesEliminacion.delete(nonce)
    return i.editReply({
      content: 'La confirmación expiró o ya no está disponible. No se eliminó ningún canal.',
      components: [],
      allowedMentions: { parse: [] },
    })
  }
  if (accion === 'cancelar') {
    confirmacionesEliminacion.delete(nonce)
    return i.editReply({
      content: 'Se canceló la eliminación. Los canales se conservaron.',
      components: [],
    })
  }
  if (accion !== 'confirmar') {
    return i.editReply({ content: 'La confirmación no es válida.', components: [] })
  }

  const miembro = await guild.members.fetch(i.user.id)
  if (!esPersonalAutorizado(miembro)) {
    confirmacionesEliminacion.delete(nonce)
    return i.editReply({
      content: 'Tu autorización cambió. No se eliminó ningún canal.',
      components: [],
    })
  }
  if (eliminacionesEnCurso.has(soporteId)) {
    return i.editReply({ content: 'La eliminación de estos canales ya está en curso.', components: [] })
  }
  eliminacionesEnCurso.add(soporteId)
  confirmacionesEliminacion.delete(nonce)

  try {
    const registro = await leerRegistroSoporte(soporteId)
    if (!registro || registro.guildId !== i.guildId || registro.estado !== 'CERRADO') {
      return i.editReply({
        content: 'El expediente no existe o aún no está cerrado. No se eliminó ningún canal.',
        components: [],
      })
    }
    if (registro.grabacion === 'FINALIZADA') {
      const canalesRequeridos = [...new Set([
        config.canales.logModeracion,
        config.canales.logAdministracion,
      ])]
      const canalesPublicados = new Set(registro.mensajesLog.map(({ canalId }) => canalId))
      const faltantes = canalesRequeridos.filter((canalId) => !canalesPublicados.has(canalId))
      if (faltantes.length) {
        return i.editReply({
          content:
            'No se eliminaron los canales: la grabación no quedó disponible en todos los canales de logs seguros. ' +
            'Se conservaron los canales del expediente para que Staff pueda acceder a la copia local o resolver los permisos de logs.',
          components: [],
        })
      }
    }
    const actor = await asegurarUsuario(i.user)
    await registrarEventoSoporte(actor.id, registro, 'eliminacion_autorizada', {
      autorizadoPorId: i.user.id,
      autorizadoEn: new Date().toISOString(),
    })

    const voz = await eliminarCanalSoporte(guild, registro.canalVozId)
    const evidencias = await eliminarCanalSoporte(guild, registro.canalEvidenciasId)
    const actualizado: RegistroSoporte = {
      ...registro,
      canalesEliminados: { voz: voz.eliminado, evidencias: evidencias.eliminado },
    }
    await registrarEventoSoporte(actor.id, actualizado, 'canales_eliminados', {
      voz: voz.eliminado,
      errorVoz: voz.error,
      evidencias: evidencias.eliminado,
      errorEvidencias: evidencias.error,
      autorizadoPorId: i.user.id,
    })
    return i.editReply({
      content: [
        `Resultado para el soporte \`${soporteId}\`:`,
        `• Canal de voz: ${voz.eliminado ? 'eliminado o ya inexistente' : `no se pudo eliminar (${voz.error})`}`,
        `• Canal de evidencias: ${evidencias.eliminado ? 'eliminado o ya inexistente' : `no se pudo eliminar (${evidencias.error})`}`,
        'El expediente y la auditoría se conservaron.',
      ].join('\n'),
      components: [],
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`[Soporte ${soporteId}] Falló la eliminación confirmada de canales:`, error)
    return i.editReply({
      content: 'No se pudo completar la eliminación. El incidente quedó en los registros del bot.',
      components: [],
    })
  } finally {
    eliminacionesEnCurso.delete(soporteId)
  }
}

async function eliminarCanalSoporte(
  guild: Guild,
  canalId: string,
  motivo = 'Cierre confirmado de expediente de soporte',
) {
  try {
    const canal = await guild.channels.fetch(canalId)
    if (!canal) return { eliminado: true, error: null }
    await canal.delete(motivo)
    return { eliminado: true, error: null }
  } catch (error) {
    if (codigoDiscord(error) === 10003) return { eliminado: true, error: null }
    console.error(`[Soporte] No se pudo eliminar el canal ${canalId}:`, error)
    return { eliminado: false, error: mensajeSeguro(error) }
  }
}

function contenidoConsultaSoporte(registro: RegistroSoporte) {
  return [
    `## Expediente de soporte \`${registro.id}\``,
    `**Estado:** ${registro.estado}`,
    `**Responsable:** <@${registro.ejecutorId}>`,
    `**Apertura:** ${fechaHoraSoporte(registro.abiertoEn)}`,
    `**Reportantes:** ${resumenGrupo(registro.reportantes)}`,
    `**Reportados:** ${resumenGrupo(registro.reportados)}`,
    `**Testigos:** ${resumenGrupo(registro.testigos)}`,
    `**Roles de supervisión:** ${registro.rolesSupervision.map((id) => `<@&${id}>`).join(', ') || 'Ninguno'}`,
    `**Canal de voz:** ${registro.canalVozId ? `<#${registro.canalVozId}>` : 'No disponible'}`,
    `**Canal de evidencias:** ${registro.canalEvidenciasId ? `<#${registro.canalEvidenciasId}>` : 'No disponible'}`,
    contenidoEstadoGrabacion(registro),
    `**Cierre:** ${registro.cerradoEn ? `${fechaHoraSoporte(registro.cerradoEn)} · <@${registro.cerradoPorId}>` : 'Pendiente'}`,
    `**Movimientos iniciales:** ${registro.movimientos.map((m) => `<@${m.usuarioId}>: ${m.resultado}`).join(', ') || 'Ninguno'}`,
  ].join('\n')
}

function contenidoEstadoGrabacion(registro: RegistroSoporte): string {
  return [
    `**Estado de grabación:** ${registro.grabacion}`,
    `**Participantes y consentimientos:**\n${resumenConsentimientos(registro.consentimientos)}`,
    `**Inicio:** ${registro.grabacionIniciadaEn ? fechaHoraSoporte(registro.grabacionIniciadaEn) : 'Sin inicio'}`,
    `**Finalización:** ${registro.grabacionFinalizadaEn ? fechaHoraSoporte(registro.grabacionFinalizadaEn) : 'Pendiente'}`,
    `**Vencimiento:** ${registro.grabacionVenceEn ? fechaHoraSoporte(registro.grabacionVenceEn) : 'No definido'}`,
  ].join('\n')
}

export async function inicializarGrabacionesSoporte(client: Client): Promise<void> {
  const directorio = config.grabaciones.directorio
  let manifiestosInterrumpidos: ManifiestoGrabacionSoporte[] = []
  try {
    manifiestosInterrumpidos = await recuperarManifiestosInterrumpidos(directorio)
  } catch (error) {
    console.error('[Soporte] No se pudieron revisar grabaciones interrumpidas:', error)
  }

  for (const manifiesto of manifiestosInterrumpidos) {
    if (manifiesto.origenGrabacion === 'servicio-staff') continue
    const registro = await leerRegistroSoporte(manifiesto.soporteId)
    if (!registro || registro.estado !== 'ABIERTO') continue
    const actualizado: RegistroSoporte = {
      ...registro,
      grabacion: manifiesto.estado,
      consentimientos: manifiesto.consentimientos,
      grabacionIniciadaEn: manifiesto.iniciadaEn,
      grabacionFinalizadaEn: manifiesto.finalizadaEn,
      grabacionVenceEn: null,
    }
    await registrarEventoGrabacion(undefined, null, actualizado, 'grabacion.interrumpida_reinicio', {
      recuperadaSinReanudar: true,
      inicio: manifiesto.iniciadaEn,
      fin: manifiesto.finalizadaEn,
    })
    await actualizarMensajeTrasReinicio(client, actualizado)
  }

  try {
    for (const manifiesto of await listarManifiestosGrabacion(directorio)) {
      if (manifiesto.origenGrabacion === 'servicio-staff') continue
      if (manifiesto.estado !== 'FINALIZADA') continue
      const registro = await leerRegistroSoporte(manifiesto.soporteId)
      if (!registro) {
        console.error(`[Soporte ${manifiesto.soporteId}] Hay una grabación finalizada sin expediente de auditoría.`)
        continue
      }
      if (
        registro.grabacion === 'FINALIZADA' &&
        JSON.stringify(registro.mensajesLog) === JSON.stringify(manifiesto.mensajesLog)
      ) continue
      const actualizado: RegistroSoporte = {
        ...registro,
        grabacion: 'FINALIZADA',
        consentimientos: manifiesto.consentimientos,
        grabacionIniciadaEn: manifiesto.iniciadaEn,
        grabacionFinalizadaEn: manifiesto.finalizadaEn,
        grabacionVenceEn: manifiesto.venceEn,
        mensajesLog: manifiesto.mensajesLog,
      }
      await registrarEventoGrabacion(undefined, null, actualizado, 'grabacion.reconciliada_reinicio', {
        reconciliadaDesdeManifiesto: true,
        finalizadaEn: manifiesto.finalizadaEn,
      })
      await actualizarMensajeTrasReinicio(client, actualizado)
    }
  } catch (error) {
    console.error('[Soporte] No se pudieron reconciliar las grabaciones finalizadas:', error)
  }

  try {
    const activosEnBase = await leerRegistrosSoporteEnCurso()
    for (const registro of activosEnBase) {
      if (registro.estado !== 'ABIERTO') continue
      const estadoFinal: EstadoGrabacionSoporte = registro.grabacionIniciadaEn ? 'ERROR' : 'NO DISPONIBLE'
      const actualizado: RegistroSoporte = {
        ...registro,
        grabacion: estadoFinal,
        grabacionFinalizadaEn: registro.grabacionIniciadaEn ? new Date().toISOString() : null,
        grabacionVenceEn: null,
      }
      await registrarEventoGrabacion(undefined, null, actualizado, 'grabacion.interrumpida_reinicio', {
        recuperadaSinReanudar: true,
        causa: 'No se encontró una sesión activa en memoria. Nunca se reanudó automáticamente.',
      })
      await actualizarMensajeTrasReinicio(client, actualizado)
    }
  } catch (error) {
    console.error('[Soporte] No se pudieron reconciliar los estados de grabación con la auditoría:', error)
  }

  await ejecutarRetencionGrabaciones(client)
  if (!temporizadorRetencionGrabaciones) {
    temporizadorRetencionGrabaciones = setInterval(() => {
      void ejecutarRetencionGrabaciones(client).catch((error: unknown) => {
        console.error('[Soporte] Falló el ciclo automático de retención:', error)
      })
    }, 60 * 60 * 1000)
    temporizadorRetencionGrabaciones.unref()
  }
}

async function leerRegistrosSoporteEnCurso(): Promise<RegistroSoporte[]> {
  const encontrados = new Map<string, RegistroSoporte>()
  const vistos = new Set<string>()
  const tamanoPagina = 500
  let skip = 0
  while (true) {
    const eventos = await db.auditoria.findMany({
      where: { entidad: 'Soporte' },
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      skip,
      take: tamanoPagina,
      select: { entidadId: true, detalle: true },
    })
    for (const evento of eventos) {
      const soporteId = evento.entidadId
      if (!soporteId || vistos.has(soporteId)) continue
      const detalle = evento.detalle
      if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) continue
      const registro = parsearRegistroSoporte((detalle as Record<string, unknown>).soporte)
      if (!registro) continue
      vistos.add(soporteId)
      if (['ESPERANDO CONSENTIMIENTO', 'GRABANDO', 'PAUSADA'].includes(registro.grabacion)) {
        encontrados.set(soporteId, registro)
      }
    }
    if (eventos.length < tamanoPagina) break
    skip += eventos.length
  }
  return [...encontrados.values()]
}

async function actualizarMensajeTrasReinicio(
  client: Client,
  registro: RegistroSoporte,
): Promise<void> {
  const guild = client.guilds.cache.get(registro.guildId) ??
    await client.guilds.fetch(registro.guildId).catch(() => null)
  if (!guild) return
  try {
    await actualizarMensajeSoporte(guild, registro)
  } catch (error) {
    console.error(`[Soporte ${registro.id}] No se pudo actualizar su mensaje tras reiniciar:`, error)
  }
}

async function ejecutarRetencionGrabaciones(client: Client): Promise<void> {
  if (!config.grabaciones.directorio) return
  const manifiestos = await listarManifiestosVencidos(config.grabaciones.directorio)
  for (const manifiesto of manifiestos) {
    if (eliminacionesGrabacionEnCurso.has(manifiesto.soporteId)) continue
    eliminacionesGrabacionEnCurso.add(manifiesto.soporteId)
    try {
      const registro = await leerRegistroSoporte(manifiesto.soporteId)
      if (!registro) {
        if (
          manifiesto.origenGrabacion === 'directa' ||
          manifiesto.origenGrabacion === 'servicio-staff'
        ) {
          await eliminarArchivosGrabacion(config.grabaciones.directorio, manifiesto.soporteId)
          continue
        }
        console.error(`[Soporte ${manifiesto.soporteId}] No se elimina una grabación vencida sin expediente de auditoría.`)
        continue
      }
      const guild = client.guilds.cache.get(manifiesto.guildId) ??
        await client.guilds.fetch(manifiesto.guildId).catch(() => null)
      await eliminarGrabacionSoporte(guild ?? undefined, null, registro, true)
    } catch (error) {
      console.error(`[Soporte ${manifiesto.soporteId}] Falló la eliminación por retención:`, error)
    } finally {
      eliminacionesGrabacionEnCurso.delete(manifiesto.soporteId)
    }
  }
}

async function leerRegistroSoporte(soporteId: string): Promise<RegistroSoporte | undefined> {
  const eventos = await db.auditoria.findMany({
    where: { entidad: 'Soporte', entidadId: soporteId },
    orderBy: { creadaEn: 'desc' },
    take: 500,
    select: { detalle: true },
  })
  for (const evento of eventos) {
    if (!evento.detalle || typeof evento.detalle !== 'object' || Array.isArray(evento.detalle)) continue
    const valor = (evento.detalle as Record<string, unknown>).soporte
    const registro = parsearRegistroSoporte(valor)
    if (registro) return registro
  }
  return undefined
}

function parsearRegistroSoporte(valor: unknown): RegistroSoporte | undefined {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined
  const registro = valor as Record<string, unknown>
  const estadoGrabacion = registro.grabacion === 'NO_DISPONIBLE'
    ? 'NO DISPONIBLE'
    : registro.grabacion
  const consentimientos = registro.consentimientos === undefined
    ? []
    : registro.consentimientos
  if (
    typeof registro.id !== 'string' ||
    typeof registro.guildId !== 'string' ||
    typeof registro.ejecutorId !== 'string' ||
    typeof registro.abiertoEn !== 'string' ||
    (registro.estado !== 'ABIERTO' && registro.estado !== 'CERRADO' && registro.estado !== 'ERROR') ||
    typeof registro.canalVozId !== 'string' ||
    typeof registro.canalEvidenciasId !== 'string' ||
    (registro.mensajesLog !== undefined &&
      (!Array.isArray(registro.mensajesLog) || !registro.mensajesLog.every(esMensajeGrabacionLog))) ||
    !esEstadoGrabacion(estadoGrabacion) ||
    !Array.isArray(consentimientos) ||
    !consentimientos.every(esConsentimientoGrabacion) ||
    !esFechaOpcional(registro.grabacionIniciadaEn) ||
    !esFechaOpcional(registro.grabacionFinalizadaEn) ||
    !esFechaOpcional(registro.grabacionVenceEn) ||
    typeof registro.movimientosPendientes !== 'boolean' ||
    !Array.isArray(registro.rolesSupervision) ||
    !registro.rolesSupervision.every((id) => typeof id === 'string') ||
    !esGrupoPersistido(registro.reportantes) ||
    !esGrupoPersistido(registro.reportados) ||
    !esGrupoPersistido(registro.testigos) ||
    !Array.isArray(registro.movimientos)
  ) return undefined

  return {
    ...registro,
    mensajesLog: registro.mensajesLog as MensajeGrabacionLog[] | undefined ?? [],
    grabacion: estadoGrabacion,
    consentimientos,
    grabacionIniciadaEn: registro.grabacionIniciadaEn as string | null | undefined ?? null,
    grabacionFinalizadaEn: registro.grabacionFinalizadaEn as string | null | undefined ?? null,
    grabacionVenceEn: registro.grabacionVenceEn as string | null | undefined ?? null,
  } as RegistroSoporte
}

function esEstadoGrabacion(valor: unknown): valor is EstadoGrabacionSoporte {
  return valor === 'ESPERANDO CONSENTIMIENTO' ||
    valor === 'GRABANDO' ||
    valor === 'PAUSADA' ||
    valor === 'FINALIZADA' ||
    valor === 'NO DISPONIBLE' ||
    valor === 'ERROR'
}

function esConsentimientoGrabacion(valor: unknown): valor is ConsentimientoGrabacion {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const consentimiento = valor as Record<string, unknown>
  return typeof consentimiento.discordId === 'string' &&
    (consentimiento.estado === 'PENDIENTE' ||
      consentimiento.estado === 'ACEPTADO' ||
      consentimiento.estado === 'RECHAZADO' ||
      consentimiento.estado === 'RETIRADO') &&
    typeof consentimiento.actualizadoEn === 'string'
}

function esMensajeGrabacionLog(valor: unknown): valor is MensajeGrabacionLog {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const mensaje = valor as Record<string, unknown>
  return typeof mensaje.canalId === 'string' && typeof mensaje.mensajeId === 'string'
}

function esFechaOpcional(valor: unknown): boolean {
  return valor === undefined || valor === null || typeof valor === 'string'
}

function esGrupoPersistido(valor: unknown): valor is GrupoSoportePersistido {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const grupo = valor as Record<string, unknown>
  return Array.isArray(grupo.usuarios) &&
    grupo.usuarios.every((id) => typeof id === 'string') &&
    (typeof grupo.rolId === 'string' || grupo.rolId === null)
}

function mensajeErrorCreacionSoporte(error: unknown) {
  if (error instanceof ErrorConfiguracionSoporte) return error.message
  const codigo = codigoDiscord(error)
  if (codigo === 50013) {
    return 'Discord denegó los permisos para crear o configurar los canales. Revisa **Gestionar canales**, el acceso del bot a la categoría y su jerarquía.'
  }
  if (codigo === 30013) {
    return 'El servidor alcanzó el límite de canales de Discord y no pudo habilitar el soporte.'
  }
  if (codigo === 50035) {
    return 'Discord rechazó la categoría o la configuración de los canales de soporte.'
  }
  return 'No se pudo habilitar el soporte. No se anunció su disponibilidad; revisa los registros del bot y los permisos de la categoría.'
}

function codigoDiscord(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const codigo = Number(error.code)
  return Number.isFinite(codigo) ? codigo : undefined
}

function mensajeSeguro(error: unknown): string {
  return error instanceof Error ? error.message.replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 500) : 'Error desconocido'
}

function limpiarSesionesExpiradas() {
  const ahora = Date.now()
  for (const [id, sesion] of sesiones) {
    if (sesion.venceEn <= ahora) sesiones.delete(id)
  }
  for (const [id, confirmacion] of confirmacionesEliminacion) {
    if (confirmacion.venceEn <= ahora) confirmacionesEliminacion.delete(id)
  }
}

class ErrorConfiguracionSoporte extends Error {}
