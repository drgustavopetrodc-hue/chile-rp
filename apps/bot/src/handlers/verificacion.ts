import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { config } from '../config'
import { edadEn, formatearFecha, parsearFecha } from '../utils/fechas'
import { generarNumeroSerie, generarRut } from '../utils/rut'
import { asegurarUsuario } from '../utils/usuarios'
import { crearEmbed, coloresEmbed } from '../utils/embeds'
import { obtenerAvatarRoblox } from '../utils/roblox'
import { generarImagenCedula } from '../utils/cedula-imagen'
import { editarComponentsV2, enviarComponentsV2 } from '../utils/components-v2'

const EFIMERO = MessageFlags.Ephemeral
const AMARILLO = coloresEmbed.aviso
const VERDE = coloresEmbed.exito
const ROJO = coloresEmbed.error

interface Respuestas {
  nombres: string
  apellidos: string
  nacimiento: string // ISO
  historia: string
  experiencia?: string
  robloxUsername?: string
}

class YaProcesada extends Error {}

// ───────────── Panel que se publica en el canal de verificación ─────────────

export function crearPanel() {
  const embed = crearEmbed(
    'Verificación de ciudadanos',
    
      'Para entrar al servidor debes crear tu personaje y pasar la whitelist.\n\n' +
        'Pulsa el botón, completa el formulario y el staff revisará tu postulación. ' +
        'Si te aprueban, recibirás tu **cédula de identidad** y acceso al servidor.',
  )
  const fila = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('verif:iniciar').setLabel('Iniciar verificación').setStyle(ButtonStyle.Primary),
  )
  return { embeds: [embed], components: [fila] }
}

// ───────────── Router ─────────────

export async function manejarBoton(i: ButtonInteraction) {
  const [, accion, id] = i.customId.split(':')
  if (accion === 'iniciar') return mostrarFormulario(i)
  if (accion === 'aprobar') return aprobar(i, id)
  if (accion === 'rechazar') return pedirMotivoRechazo(i, id)
}

export async function manejarModal(i: ModalSubmitInteraction) {
  const [, accion, id] = i.customId.split(':')
  if (accion === 'modal') return recibirPostulacion(i)
  if (accion === 'rechazo') return rechazar(i, id)
}

const esStaff = (i: ButtonInteraction | ModalSubmitInteraction) =>
  i.inCachedGuild() && i.member.roles.cache.has(config.roles.staff)

// ───────────── 1. El jugador abre el formulario ─────────────

async function mostrarFormulario(i: ButtonInteraction) {
  const usuario = await asegurarUsuario(i.user)

  if (usuario.verificacion === 'VERIFICADO') {
    return i.reply({ content: 'Ya estás verificado.', flags: EFIMERO })
  }
  if (usuario.verificacion === 'SUSPENDIDO') {
    return i.reply({ content: 'Tu cuenta está suspendida. Contacta al staff.', flags: EFIMERO })
  }
  const pendiente = await db.postulacion.findFirst({
    where: { usuarioId: usuario.id, tipo: 'WHITELIST', estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
  })
  if (pendiente) {
    return i.reply({ content: 'Ya tienes una postulación en revisión. Espera la respuesta del staff.', flags: EFIMERO })
  }

  const campo = (id: string, etiqueta: string, estilo: TextInputStyle, max: number, placeholder?: string) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(etiqueta)
        .setStyle(estilo)
        .setMaxLength(max)
        .setRequired(true)
        .setPlaceholder(placeholder ?? ''),
    )

  const modal = new ModalBuilder()
    .setCustomId('verif:modal')
    .setTitle('Postulación de personaje')
    .addComponents(
      campo('nombres', 'Nombres del personaje', TextInputStyle.Short, 40),
      campo('apellidos', 'Apellidos del personaje', TextInputStyle.Short, 40),
      campo('nacimiento', 'Fecha de nacimiento (DD/MM/AAAA)', TextInputStyle.Short, 10, '15/03/1995'),
      campo('historia', 'Historia y experiencia de RP', TextInputStyle.Paragraph, 1000),
      campo('roblox', 'Usuario de Roblox (sin @)', TextInputStyle.Short, 20),
    )
  return i.showModal(modal)
}

// ───────────── 2. Se recibe la postulación y va al staff ─────────────

async function recibirPostulacion(i: ModalSubmitInteraction) {
  const leer = (id: string) => i.fields.getTextInputValue(id).trim()
  const nombres = leer('nombres')
  const apellidos = leer('apellidos')
  const historia = leer('historia')
  const robloxSolicitado = leer('roblox')

  const nacimiento = parsearFecha(leer('nacimiento'))
  if (!nacimiento) {
    return i.reply({ content: 'La fecha no es válida. Usa el formato DD/MM/AAAA.', flags: EFIMERO })
  }
  const edad = edadEn(nacimiento)
  if (edad < 18 || edad > 90) {
    return i.reply({ content: 'Tu personaje debe tener entre 18 y 90 años.', flags: EFIMERO })
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(robloxSolicitado)) {
    return i.reply({ content: 'El usuario Roblox debe tener entre 3 y 20 letras, números o guiones bajos.', flags: EFIMERO })
  }

  const usuario = await asegurarUsuario(i.user)
  const repetida = await db.postulacion.findFirst({
    where: { usuarioId: usuario.id, tipo: 'WHITELIST', estado: { in: ['PENDIENTE', 'EN_REVISION'] } },
  })
  if (repetida) {
    return i.reply({ content: 'Ya tienes una postulación en revisión.', flags: EFIMERO })
  }

  await i.deferReply({ flags: EFIMERO })
  let robloxUsername: string
  try {
    robloxUsername = (await obtenerAvatarRoblox(robloxSolicitado)).username
  } catch (error) {
    return i.editReply(error instanceof Error ? error.message : 'No se pudo validar el usuario Roblox.')
  }

  const respuestas: Respuestas = {
    nombres,
    apellidos,
    nacimiento: nacimiento.toISOString(),
    historia,
    robloxUsername,
  }
  const postulacion = await db.postulacion.create({
    data: { tipo: 'WHITELIST', usuarioId: usuario.id, respuestas: { ...respuestas } },
  })

  const embed = crearEmbed('Nueva postulación de whitelist', 'Revisa los datos del personaje y evalúa su experiencia de rol.', AMARILLO)
    .setThumbnail(i.user.displayAvatarURL())
    .addFields(
      { name: 'Postulante', value: `${i.user} (${i.user.username})`, inline: true },
      { name: 'Personaje', value: `${nombres} ${apellidos}`, inline: true },
      { name: 'Nacimiento', value: `${formatearFecha(nacimiento)} (${edad} años)`, inline: true },
      { name: 'Usuario Roblox', value: robloxUsername, inline: true },
      { name: 'Historia y experiencia en RP', value: historia },
    )
    .setFooter({ text: `Postulación ${postulacion.id} · RP Chile` })

  const fila = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`verif:aprobar:${postulacion.id}`).setLabel('Aprobar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`verif:rechazar:${postulacion.id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger),
  )

  try {
    const canal = await i.client.channels.fetch(config.canales.revision)
    if (!canal || !canal.isSendable()) throw new Error('El canal de revisión no es válido')
    await enviarComponentsV2(canal, { embeds: [embed], components: [fila] })
  } catch (err) {
    console.error(err)
    await db.postulacion.delete({ where: { id: postulacion.id } })
    return i.editReply('No pude enviar tu postulación al staff. Inténtalo de nuevo más tarde.')
  }

  return i.editReply('Tu postulación fue enviada. Te avisaremos por mensaje privado cuando sea revisada.')
}

// ───────────── 3a. El staff aprueba ─────────────

async function aprobar(i: ButtonInteraction, id: string) {
  if (!esStaff(i) || !i.inCachedGuild()) {
    return i.reply({ content: 'Solo el staff puede revisar postulaciones.', flags: EFIMERO })
  }
  await i.deferReply({ flags: EFIMERO })

  const post = await db.postulacion.findUnique({ where: { id }, include: { usuario: true } })
  if (!post || post.estado !== 'PENDIENTE') {
    return i.editReply('Esta postulación ya fue procesada.')
  }
  const r = post.respuestas as unknown as Respuestas
  const staff = await asegurarUsuario(i.user)

  // RUT y número de serie únicos
  let rut = generarRut()
  while (await db.personaje.findUnique({ where: { rut } })) rut = generarRut()
  let serie = generarNumeroSerie()
  while (await db.cedula.findUnique({ where: { numeroSerie: serie } })) serie = generarNumeroSerie()

  const ahora = new Date()
  const vence = new Date(ahora)
  vence.setFullYear(vence.getFullYear() + 5)

  try {
    await db.$transaction(async (tx) => {
      const upd = await tx.postulacion.updateMany({
        where: { id, estado: 'PENDIENTE' },
        data: { estado: 'APROBADA', revisorId: staff.id, revisadaEn: ahora },
      })
      if (upd.count === 0) throw new YaProcesada()

      await tx.personaje.create({
        data: {
          usuarioId: post.usuarioId,
          nombres: r.nombres,
          apellidos: r.apellidos,
          rut,
          fechaNacimiento: new Date(r.nacimiento),
          cedula: { create: { numeroSerie: serie, venceEn: vence, robloxUsername: r.robloxUsername ?? null } },
        },
      })
      await tx.usuario.update({
        where: { id: post.usuarioId },
        data: { verificacion: 'VERIFICADO', verificadoEn: ahora, verificadoPorId: staff.id },
      })
      await tx.auditoria.create({
        data: { actorId: staff.id, accion: 'whitelist.aprobar', entidad: 'Postulacion', entidadId: id, detalle: { rut } },
      })
    })
  } catch (err) {
    if (err instanceof YaProcesada) return i.editReply('Esta postulación ya fue procesada.')
    throw err
  }

  // Acciones en Discord (si fallan, la aprobación en la base de datos ya quedó guardada)
  const miembro = await i.guild.members.fetch(post.usuario.discordId).catch(() => null)
  if (miembro) {
    await miembro.roles.add(config.roles.ciudadano).catch(console.error)
    await miembro.roles.remove(config.roles.noVerificado).catch(console.error)
    await miembro.setNickname(`${r.nombres} ${r.apellidos}`.slice(0, 32)).catch(() => {})
    const personaje = await db.personaje.findUnique({ where: { rut }, include: { cedula: true } })
    if (personaje?.cedula?.robloxUsername) {
      try {
        const roblox = await obtenerAvatarRoblox(personaje.cedula.robloxUsername)
        const png = await generarImagenCedula({
          nombres: personaje.nombres,
          apellidos: personaje.apellidos,
          rut: personaje.rut,
          nacionalidad: personaje.nacionalidad,
          nacimiento: personaje.fechaNacimiento,
          robloxUsername: roblox.username,
          numeroSerie: personaje.cedula.numeroSerie,
          emitidaEn: personaje.cedula.emitidaEn,
          venceEn: personaje.cedula.venceEn,
          avatar: roblox.avatar,
        })
        await enviarComponentsV2(miembro, {
          content: `✅ Tu postulación fue **aprobada**. Ya eres ciudadano. RUT: **${rut}**.`,
          files: [new AttachmentBuilder(png, { name: `cedula-${rut.replace(/[^a-zA-Z0-9]/g, '')}.png` })],
        })
      } catch (error) {
        console.error('No se pudo enviar la cédula gráfica:', error)
        await enviarComponentsV2(miembro, `✅ Tu postulación fue **aprobada**. RUT: **${rut}**. Usa \`/cedula mostrar\` para recuperar tu cédula gráfica.`).catch(() => {})
      }
    } else {
      await enviarComponentsV2(miembro, `✅ Tu postulación fue **aprobada**. RUT: **${rut}**. Usa \`/cedula vincular\` para completar tu cédula con Roblox.`).catch(() => {})
    }
  }

  await actualizarMensaje(i, VERDE, `✅ Aprobada por ${i.user} — RUT asignado: ${rut}`)
  return i.editReply('Postulación aprobada.')
}

// ───────────── 3b. El staff rechaza (pide motivo) ─────────────

async function pedirMotivoRechazo(i: ButtonInteraction, id: string) {
  if (!esStaff(i)) {
    return i.reply({ content: 'Solo el staff puede revisar postulaciones.', flags: EFIMERO })
  }
  const modal = new ModalBuilder()
    .setCustomId(`verif:rechazo:${id}`)
    .setTitle('Motivo del rechazo')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('motivo')
          .setLabel('Motivo (se enviará al postulante)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(true),
      ),
    )
  return i.showModal(modal)
}

async function rechazar(i: ModalSubmitInteraction, id: string) {
  if (!esStaff(i) || !i.inCachedGuild()) {
    return i.reply({ content: 'Solo el staff puede revisar postulaciones.', flags: EFIMERO })
  }
  await i.deferReply({ flags: EFIMERO })

  const motivo = i.fields.getTextInputValue('motivo').trim()
  const post = await db.postulacion.findUnique({ where: { id }, include: { usuario: true } })
  if (!post || post.estado !== 'PENDIENTE') {
    return i.editReply('Esta postulación ya fue procesada.')
  }
  const staff = await asegurarUsuario(i.user)

  const upd = await db.postulacion.updateMany({
    where: { id, estado: 'PENDIENTE' },
    data: { estado: 'RECHAZADA', notas: motivo, revisorId: staff.id, revisadaEn: new Date() },
  })
  if (upd.count === 0) return i.editReply('Esta postulación ya fue procesada.')

  await db.auditoria.create({
    data: { actorId: staff.id, accion: 'whitelist.rechazar', entidad: 'Postulacion', entidadId: id, detalle: { motivo } },
  })

  const miembro = await i.guild.members.fetch(post.usuario.discordId).catch(() => null)
  if (miembro) {
    await enviarComponentsV2(miembro, `❌ Tu postulación fue **rechazada**.\n**Motivo:** ${motivo}\nPuedes volver a postular cuando quieras.`).catch(() => {})
  }

  await actualizarMensaje(i, ROJO, `❌ Rechazada por ${i.user}\n**Motivo:** ${motivo}`)
  return i.editReply('Postulación rechazada.')
}

// ───────────── Utilidad: actualiza el mensaje de revisión del staff ─────────────

async function actualizarMensaje(i: ButtonInteraction | ModalSubmitInteraction, color: number, resultado: string) {
  const original = i.message?.embeds[0]
  if (!original) return
  const embed = EmbedBuilder.from(original).setColor(color).addFields({ name: 'Resultado', value: resultado })
  if (i.message) await editarComponentsV2(i.message, { embeds: [embed], components: [] }).catch(console.error)
}
