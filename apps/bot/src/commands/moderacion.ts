import {
  ChatInputCommandInteraction,
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'
import { comoComponentsV2 } from '../utils/components-v2'

const efimero = MessageFlags.Ephemeral
const canalCasosId = '1571338831003656303'
const guildCommand = (name: string, description: string) =>
  new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild)

const banData = guildCommand('ban', 'Expulsa permanentemente a un usuario')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(500))
  .addIntegerOption((o) => o.setName('borrar_dias').setDescription('Días de mensajes a borrar').setMinValue(0).setMaxValue(7))

const unbanData = guildCommand('unban', 'Retira el veto a un usuario')
  .addStringOption((o) => o.setName('id').setDescription('ID de Discord').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(500))

const kickData = guildCommand('kick', 'Expulsa a un usuario del servidor')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(500))

const timeoutData = guildCommand('timeout', 'Aplica un timeout')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addIntegerOption((o) => o.setName('minutos').setDescription('Duración en minutos').setRequired(true).setMinValue(1).setMaxValue(40_320))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(500))

const clearData = guildCommand('clear', 'Elimina mensajes recientes del canal')
  .addIntegerOption((o) => o.setName('cantidad').setDescription('Cantidad (1 a 100)').setRequired(true).setMinValue(1).setMaxValue(100))

const sancionarData = guildCommand('sancionar', 'Registra una sanción')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(true).setMaxLength(500))
  .addIntegerOption((o) => o.setName('dias').setDescription('Duración en días (vacío = permanente)').setMinValue(1).setMaxValue(3650))

const eliminarSancionData = guildCommand('eliminar-sancion', 'Retira una sanción registrada')
  .addStringOption((o) => o.setName('id').setDescription('ID de sanción').setRequired(true))

const advertirData = guildCommand('advertir', 'Registra una advertencia')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(true).setMaxLength(500))

const quitarAdvertenciaData = guildCommand('quitar-advertencia', 'Retira una advertencia')
  .addStringOption((o) => o.setName('id').setDescription('ID de advertencia').setRequired(true))

const sancionesData = guildCommand('sanciones', 'Consulta tus sanciones vigentes')
const advertenciasData = guildCommand('advertencias', 'Consulta tus advertencias vigentes')

export const moderacion = [
  { data: banData, execute: ejecutarBan },
  { data: unbanData, execute: ejecutarUnban },
  { data: kickData, execute: ejecutarKick },
  { data: timeoutData, execute: ejecutarTimeout },
  { data: clearData, execute: ejecutarClear },
  { data: sancionarData, execute: ejecutarSancionar },
  { data: eliminarSancionData, execute: (i: ChatInputCommandInteraction) => retirarCaso(i, 'sancion') },
  { data: advertirData, execute: ejecutarAdvertir },
  { data: quitarAdvertenciaData, execute: (i: ChatInputCommandInteraction) => retirarCaso(i, 'advertencia') },
  { data: sancionesData, execute: (i: ChatInputCommandInteraction) => listarCasos(i, 'sancion') },
  { data: advertenciasData, execute: (i: ChatInputCommandInteraction) => listarCasos(i, 'advertencia') },
]

async function ejecutarBan(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const motivo = i.options.getString('motivo') ?? 'Sin motivo indicado'
  await i.guild!.members.ban(usuario, {
    reason: `${motivo} | Moderador: ${i.user.tag}`,
    deleteMessageSeconds: (i.options.getInteger('borrar_dias') ?? 0) * 86_400,
  })
  return i.reply({ content: `Veto aplicado a ${usuario.tag}.`, flags: efimero })
}

async function ejecutarUnban(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const id = i.options.getString('id', true)
  await i.guild!.members.unban(id, i.options.getString('motivo') ?? undefined)
  return i.reply({ content: `Veto retirado para \`${id}\`.`, flags: efimero })
}

async function ejecutarKick(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const miembro = await i.guild!.members.fetch(usuario.id)
  await miembro.kick(i.options.getString('motivo') ?? `Moderador: ${i.user.tag}`)
  return i.reply({ content: `${usuario.tag} fue expulsado.`, flags: efimero })
}

async function ejecutarTimeout(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const miembro = await i.guild!.members.fetch(usuario.id)
  const minutos = i.options.getInteger('minutos', true)
  await miembro.timeout(minutos * 60_000, i.options.getString('motivo') ?? `Moderador: ${i.user.tag}`)
  return i.reply({ content: `Timeout aplicado a ${usuario.tag} por ${minutos} minutos.`, flags: efimero })
}

async function ejecutarClear(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  if (!i.channel?.isTextBased() || !('bulkDelete' in i.channel)) {
    return i.reply({ content: 'Este comando solo funciona en canales de texto.', flags: efimero })
  }
  const mensajes = await i.channel.bulkDelete(i.options.getInteger('cantidad', true), true)
  return i.reply({ content: `Eliminados ${mensajes.size} mensajes recientes.`, flags: efimero })
}

async function ejecutarSancionar(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const motivo = i.options.getString('motivo', true)
  const dias = i.options.getInteger('dias')
  const registro = await registrarCaso(i, usuario.id, 'sancion', motivo, dias)
  const detalle = registro.detalle as { venceEn?: string } | null
  const hilo = await publicarCasoModeracion(i, registro.id, usuario.id, usuario.tag, 'Sanción', motivo, detalle?.venceEn)
  return i.reply({ content: `Sanción registrada para ${usuario.tag}. ID: **${registro.id}**.${hilo ? ` Evidencia: ${hilo}` : ' No se pudo crear el hilo de evidencia; avisa al staff administrador.'}`, flags: efimero })
}

async function ejecutarAdvertir(i: ChatInputCommandInteraction) {
  if (!esStaff(i)) return denegado(i)
  const usuario = i.options.getUser('usuario', true)
  const motivo = i.options.getString('motivo', true)
  const registro = await registrarCaso(i, usuario.id, 'advertencia', motivo)
  const hilo = await publicarCasoModeracion(i, registro.id, usuario.id, usuario.tag, 'Advertencia', motivo)
  return i.reply({ content: `Advertencia registrada para ${usuario.tag}. ID: **${registro.id}**.${hilo ? ` Evidencia: ${hilo}` : ' No se pudo crear el hilo de evidencia; avisa al staff administrador.'}`, flags: efimero })
}

async function publicarCasoModeracion(
  i: ChatInputCommandInteraction,
  registroId: string,
  usuarioId: string,
  usuarioTag: string,
  tipo: 'Sanción' | 'Advertencia',
  motivo: string,
  venceEn?: string,
) {
  if (!i.inCachedGuild()) return null
  try {
    const canal = await i.guild.channels.fetch(canalCasosId)
    if (!canal?.isTextBased() || !('threads' in canal) || !canal.isSendable()) return null
    const fecha = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date())
    const container = new ContainerBuilder()
      .setAccentColor(0xffffff)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${tipo} emitida`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `• **Usuario:** <@${usuarioId}> (${usuarioTag})\n` +
        `• **Moderador:** <@${i.user.id}>\n` +
        `• **Tipo:** ${tipo}\n` +
        `• **Número:** #${registroId.slice(-6)}\n` +
        `• **Motivo:** ${motivo}\n` +
        `• **Fecha:** ${fecha}\n` +
        `• **Vigencia:** ${venceEn ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(new Date(venceEn)) : 'Sin vencimiento'}`,
      ))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Abre el hilo asociado para adjuntar capturas y otros antecedentes.'))
    const mensaje = await canal.send(comoComponentsV2({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [usuarioId, i.user.id], parse: [] },
    }))
    const hilo = await mensaje.startThread({
      name: `evidencia-${tipo.toLowerCase()}-${registroId.slice(-8)}`.slice(0, 100),
      autoArchiveDuration: 1440,
      reason: `Evidencia del registro de ${tipo.toLowerCase()} ${registroId}`,
    })
    await hilo.send(comoComponentsV2({
      components: [new ContainerBuilder().setAccentColor(0xffffff).addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## Evidencia del registro #${registroId.slice(-6)}\nAdjunta aquí capturas o antecedentes relacionados con esta ${tipo.toLowerCase()}.`),
      )],
      flags: MessageFlags.IsComponentsV2,
    }))
    return hilo
  } catch (error) {
    console.error(`No se pudo publicar ${tipo.toLowerCase()} en el canal de casos:`, error)
    return null
  }
}

async function registrarCaso(i: ChatInputCommandInteraction, discordId: string, tipo: 'sancion' | 'advertencia', motivo: string, dias?: number | null) {
  const actor = await asegurarUsuario(i.user)
  const venceEn = dias ? new Date(Date.now() + dias * 86_400_000).toISOString() : null
  return db.auditoria.create({
    data: {
      actorId: actor.id,
      accion: `${tipo}.crear`,
      entidad: 'CasoModeracion',
      entidadId: discordId,
      detalle: { motivo, venceEn, moderadorId: i.user.id },
    },
  })
}

async function retirarCaso(i: ChatInputCommandInteraction, tipo: 'sancion' | 'advertencia') {
  if (!esStaff(i)) return denegado(i)
  const id = i.options.getString('id', true)
  const caso = await db.auditoria.findUnique({ where: { id } })
  if (!caso || caso.entidad !== 'CasoModeracion' || caso.accion !== `${tipo}.crear`) {
    return i.reply({ content: `No se encontró una ${tipo} activa con ese ID.`, flags: efimero })
  }
  const actor = await asegurarUsuario(i.user)
  await db.auditoria.create({
    data: {
      actorId: actor.id,
      accion: `${tipo}.retirar`,
      entidad: 'CasoModeracion',
      entidadId: caso.entidadId,
      detalle: { casoId: caso.id, moderadorId: i.user.id },
    },
  })
  return i.reply({ content: `${tipo === 'sancion' ? 'Sanción' : 'Advertencia'} retirada.`, flags: efimero })
}

async function listarCasos(i: ChatInputCommandInteraction, tipo: 'sancion' | 'advertencia') {
  const registros = await db.auditoria.findMany({
    where: { entidad: 'CasoModeracion', entidadId: i.user.id, accion: { in: [`${tipo}.crear`, `${tipo}.retirar`] } },
    orderBy: { creadaEn: 'desc' },
    take: 100,
  })
  const retirados = new Set(
    registros
      .filter((r) => r.accion === `${tipo}.retirar`)
      .map((r) => (r.detalle as { casoId?: string } | null)?.casoId)
      .filter((id): id is string => !!id),
  )
  const activos = registros.filter((r) => r.accion === `${tipo}.crear` && !retirados.has(r.id))
  return i.reply({
    content: activos.length
      ? activos.map((r) => `**${r.id}** · ${(r.detalle as { motivo?: string } | null)?.motivo ?? 'Sin motivo'}`).join('\n')
      : `No tienes ${tipo === 'sancion' ? 'sanciones' : 'advertencias'} vigentes.`,
    flags: efimero,
  })
}

function esStaff(i: ChatInputCommandInteraction) {
  return !!i.inCachedGuild() && (i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    i.member.roles.cache.has(process.env.ROL_STAFF_ID ?? '') ||
    i.member.roles.cache.has(process.env.ROL_MODERADOR_ID ?? '') ||
    i.member.roles.cache.has(process.env.ROL_SOPORTE_ID ?? ''))
}

function denegado(i: ChatInputCommandInteraction) {
  return i.reply({ content: 'Este comando requiere permisos de staff.', flags: efimero })
}
