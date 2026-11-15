import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { config } from '../config'
import { crearPersonaje } from '../utils/personajes'
import { parsearFecha } from '../utils/fechas'
import { crearEmbed, coloresEmbed } from '../utils/embeds'
import { obtenerAvatarRoblox, RobloxLookupError } from '../utils/roblox'
import { generarImagenCedula } from '../utils/cedula-imagen'
import { formatearFecha } from '../utils/fechas'

export const data = new SlashCommandBuilder()
  .setName('cedula')
  .setDescription('Crear, consultar y administrar cédulas')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('crear')
      .setDescription('Crea tu personaje y cédula')
      .addStringOption((o) => o.setName('nombres').setDescription('Nombres').setRequired(true).setMaxLength(40))
      .addStringOption((o) => o.setName('apellidos').setDescription('Apellidos').setRequired(true).setMaxLength(40))
      .addStringOption((o) => o.setName('nacimiento').setDescription('Fecha DD/MM/AAAA').setRequired(true))
      .addStringOption((o) => o.setName('roblox').setDescription('Usuario de Roblox, sin @').setRequired(true).setMaxLength(20)),
  )
  .addSubcommand((s) =>
    s
      .setName('mostrar')
      .setDescription('Muestra una cédula')
      .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano (por defecto, tú)')),
  )
  .addSubcommand((s) => s.setName('vincular').setDescription('Vincula tu usuario Roblox y genera tu cédula gráfica')
    .addStringOption((o) => o.setName('roblox').setDescription('Usuario de Roblox, sin @').setRequired(true).setMaxLength(20)))
  .addSubcommand((s) =>
    s
      .setName('buscar')
      .setDescription('Busca una cédula por ciudadano o RUT (policía)')
      .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano'))
      .addStringOption((o) => o.setName('rut').setDescription('RUT del personaje')),
  )
  .addSubcommand((s) =>
    s
      .setName('editar')
      .setDescription('Edita una cédula (staff)')
      .addUserOption((o) => o.setName('usuario').setDescription('Dueño del personaje').setRequired(true))
      .addStringOption((o) => o.setName('nombres').setDescription('Nuevos nombres').setMaxLength(40))
      .addStringOption((o) => o.setName('apellidos').setDescription('Nuevos apellidos').setMaxLength(40))
      .addStringOption((o) => o.setName('nacionalidad').setDescription('Nueva nacionalidad').setMaxLength(40)),
  )
  .addSubcommand((s) =>
    s
      .setName('eliminar')
      .setDescription('Revoca una cédula y desactiva el personaje (staff)')
      .addUserOption((o) => o.setName('usuario').setDescription('Dueño del personaje').setRequired(true)),
  )

export async function execute(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  const objetivo = i.options.getUser('usuario')

  if (accion === 'vincular') {
    const personaje = await db.personaje.findFirst({
      where: { activo: true, usuario: { discordId: i.user.id } },
      include: { cedula: true },
      orderBy: { creadoEn: 'asc' },
    })
    if (!personaje?.cedula) return i.reply({ content: 'No tienes un personaje con cédula activa.', flags: MessageFlags.Ephemeral })
    await i.deferReply({ flags: MessageFlags.Ephemeral })
    let roblox: Awaited<ReturnType<typeof obtenerAvatarRoblox>>
    try {
      roblox = await obtenerAvatarRoblox(i.options.getString('roblox', true))
    } catch (error) {
      if (error instanceof RobloxLookupError) return i.editReply(error.message)
      throw error
    }
    const cedula = await db.cedula.update({ where: { id: personaje.cedula.id }, data: { robloxUsername: roblox.username } })
    return publicarImagenCedula(i, { ...personaje, cedula }, roblox.avatar, true)
  }

  if (accion === 'crear') {
    const nacimiento = parsearFecha(i.options.getString('nacimiento', true))
    if (!nacimiento) return i.reply({ content: 'Fecha inválida. Usa DD/MM/AAAA.', flags: MessageFlags.Ephemeral })
    const usuario = await db.usuario.findUnique({ where: { discordId: i.user.id } })
    if (usuario?.verificacion !== 'VERIFICADO') {
      return i.reply({ content: 'Debes estar verificado para crear una cédula.', flags: MessageFlags.Ephemeral })
    }
    const cantidad = await db.personaje.count({ where: { activo: true, usuario: { discordId: i.user.id } } })
    if (cantidad > 0) {
      return i.reply({ content: 'Ya tienes un personaje. El segundo requiere `/crear-dni-2do` y su rol correspondiente.', flags: MessageFlags.Ephemeral })
    }
    await i.deferReply()
    let roblox: Awaited<ReturnType<typeof obtenerAvatarRoblox>>
    try {
      roblox = await obtenerAvatarRoblox(i.options.getString('roblox', true))
    } catch (error) {
      if (error instanceof RobloxLookupError) return i.editReply(error.message)
      throw error
    }
    const personaje = await crearPersonaje(
      i.user,
      i.options.getString('nombres', true),
      i.options.getString('apellidos', true),
      nacimiento,
      roblox.username,
    )
    const cedulaCreada = personaje.cedula
    if (!cedulaCreada) return i.editReply('El personaje se creó, pero no se pudo cargar su cédula. Contacta al staff.')
    return publicarImagenCedula(i, { ...personaje, cedula: cedulaCreada }, roblox.avatar, false)
  }

  if (accion === 'editar' || accion === 'eliminar') {
    if (!esStaff(i)) return i.reply({ content: 'Esta acción requiere permisos de staff.', flags: MessageFlags.Ephemeral })
    const personaje = await db.personaje.findFirst({
      where: { activo: true, usuario: { discordId: objetivo!.id } },
      include: { cedula: true },
      orderBy: { creadoEn: 'asc' },
    })
    if (!personaje) return i.reply({ content: 'No se encontró un personaje activo.', flags: MessageFlags.Ephemeral })
    if (accion === 'eliminar') {
      await db.$transaction([
        db.personaje.update({ where: { id: personaje.id }, data: { activo: false } }),
        ...(personaje.cedula
          ? [db.cedula.update({ where: { id: personaje.cedula.id }, data: { estado: 'REVOCADO' } })]
          : []),
      ])
      return i.reply({ content: 'Cédula revocada y personaje desactivado.', flags: MessageFlags.Ephemeral })
    }
    const nombres = i.options.getString('nombres')
    const apellidos = i.options.getString('apellidos')
    const nacionalidad = i.options.getString('nacionalidad')
    if (!nombres && !apellidos && !nacionalidad) {
      return i.reply({ content: 'Indica al menos un campo para editar.', flags: MessageFlags.Ephemeral })
    }
    await db.personaje.update({
      where: { id: personaje.id },
      data: { ...(nombres && { nombres }), ...(apellidos && { apellidos }), ...(nacionalidad && { nacionalidad }) },
    })
    return i.reply({ content: 'Cédula actualizada.', flags: MessageFlags.Ephemeral })
  }

  if (accion === 'buscar' && !esPolicia(i)) {
    return i.reply({ content: 'Esta búsqueda requiere el rol policial o staff.', flags: MessageFlags.Ephemeral })
  }

  const porRut = accion === 'buscar' ? i.options.getString('rut') : null
  const persona = porRut
    ? await db.personaje.findFirst({ where: { activo: true, rut: { equals: porRut, mode: 'insensitive' } }, include: { cedula: true, usuario: true } })
    : await db.personaje.findFirst({
        where: { activo: true, usuario: { discordId: (objetivo ?? i.user).id }, cedula: { isNot: null } },
        include: { cedula: true, usuario: true },
        orderBy: { creadoEn: 'asc' },
      })

  if (!persona || !persona.cedula) {
    return i.reply({
      content: 'No se encontró una cédula vigente para esa consulta.',
      flags: MessageFlags.Ephemeral,
    })
  }
  if (!persona.cedula.robloxUsername) {
    return i.reply({ content: 'Esta cédula aún no tiene usuario Roblox. El titular puede usar `/cedula vincular` para generar la versión gráfica.', flags: MessageFlags.Ephemeral })
  }
  await i.deferReply(accion === 'buscar' ? { flags: MessageFlags.Ephemeral } : undefined)
  try {
    const roblox = await obtenerAvatarRoblox(persona.cedula.robloxUsername)
    return publicarImagenCedula(i, { ...persona, cedula: persona.cedula }, roblox.avatar, accion === 'buscar')
  } catch (error) {
    if (error instanceof RobloxLookupError) return i.editReply(`No pude recuperar el avatar de Roblox: ${error.message}`)
    throw error
  }
}

export async function publicarImagenCedula(
  i: ChatInputCommandInteraction,
  personaje: {
    nombres: string
    apellidos: string
    rut: string
    nacionalidad: string
    fechaNacimiento: Date
    cedula: { numeroSerie: string; robloxUsername: string | null; emitidaEn: Date; venceEn: Date; estado: string }
  },
  avatar: Buffer,
  efimero: boolean,
) {
  if (!personaje.cedula.robloxUsername) return i.editReply('La cédula no tiene usuario Roblox vinculado.')
  const png = await generarImagenCedula({
    nombres: personaje.nombres,
    apellidos: personaje.apellidos,
    rut: personaje.rut,
    nacionalidad: personaje.nacionalidad,
    nacimiento: personaje.fechaNacimiento,
    robloxUsername: personaje.cedula.robloxUsername,
    numeroSerie: personaje.cedula.numeroSerie,
    emitidaEn: personaje.cedula.emitidaEn,
    venceEn: personaje.cedula.venceEn,
    avatar,
  })
  const nombreArchivo = `cedula-${personaje.rut.replace(/[^a-zA-Z0-9]/g, '')}.png`
  const embed = crearEmbed('Cédula de identidad', `Documento gráfico de **${personaje.nombres} ${personaje.apellidos}**.`, coloresEmbed.principal)
    .addFields(
      { name: 'RUT', value: personaje.rut, inline: true },
      { name: 'Roblox', value: personaje.cedula.robloxUsername, inline: true },
      { name: 'Estado', value: personaje.cedula.estado, inline: true },
      { name: 'Vencimiento', value: formatearFecha(personaje.cedula.venceEn), inline: true },
    )
    .setImage(`attachment://${nombreArchivo}`)
  return i.editReply({
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: nombreArchivo })],
    ...(efimero && { allowedMentions: { parse: [] } }),
  })
}

function esStaff(i: ChatInputCommandInteraction) {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (i.inCachedGuild() && i.member.roles.cache.has(config.roles.staff))
}

function esPolicia(i: ChatInputCommandInteraction) {
  return esStaff(i) || (!!process.env.ROL_POLICIA_ID && i.inCachedGuild() && i.member.roles.cache.has(process.env.ROL_POLICIA_ID))
}
