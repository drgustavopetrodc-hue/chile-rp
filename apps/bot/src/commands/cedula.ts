import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { config } from '../config'
import { crearPersonaje } from '../utils/personajes'
import { formatearFecha, parsearFecha } from '../utils/fechas'
import { crearEmbed, coloresEmbed } from '../utils/embeds'

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
      .addStringOption((o) => o.setName('nacimiento').setDescription('Fecha DD/MM/AAAA').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('mostrar')
      .setDescription('Muestra una cédula')
      .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano (por defecto, tú)')),
  )
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
    const personaje = await crearPersonaje(
      i.user,
      i.options.getString('nombres', true),
      i.options.getString('apellidos', true),
      nacimiento,
    )
    return i.reply({ content: `Cédula creada para **${personaje.nombres} ${personaje.apellidos}**. RUT: **${personaje.rut}**.` })
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

  const c = persona.cedula
  const embed = crearEmbed('Cédula de identidad', 'Documento oficial del personaje.', coloresEmbed.principal)
    .setThumbnail(i.client.users.cache.get(persona.usuario.discordId)?.displayAvatarURL() ?? null)
    .addFields(
      { name: 'Nombres', value: persona.nombres, inline: true },
      { name: 'Apellidos', value: persona.apellidos, inline: true },
      { name: 'RUT', value: persona.rut, inline: true },
      { name: 'Nacionalidad', value: persona.nacionalidad, inline: true },
      { name: 'Nacimiento', value: formatearFecha(persona.fechaNacimiento), inline: true },
      { name: 'N° de serie', value: c.numeroSerie, inline: true },
      { name: 'Emisión', value: formatearFecha(c.emitidaEn), inline: true },
      { name: 'Vencimiento', value: formatearFecha(c.venceEn), inline: true },
      { name: 'Estado', value: c.estado, inline: true },
    )
  return i.reply({ embeds: [embed], ...(accion === 'buscar' && { flags: MessageFlags.Ephemeral }) })
}

function esStaff(i: ChatInputCommandInteraction) {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (i.inCachedGuild() && i.member.roles.cache.has(config.roles.staff))
}

function esPolicia(i: ChatInputCommandInteraction) {
  return esStaff(i) || (!!process.env.ROL_POLICIA_ID && i.inCachedGuild() && i.member.roles.cache.has(process.env.ROL_POLICIA_ID))
}
