import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'
import { generarNumeroSerie } from '../utils/rut'
import { crearEmbed, coloresEmbed } from '../utils/embeds'
import { formatearMoneda } from '../utils/moneda'
import { cargarImagenDiscord } from '../utils/adjuntos'
import { ArticuloPenal, CODIGO_PENAL } from '../data/codigo-penal'

const efimero = MessageFlags.Ephemeral

export const multasData = new SlashCommandBuilder()
  .setName('multas')
  .setDescription('Consulta tus multas pendientes y pagadas')
  .setContexts(InteractionContextType.Guild)

export const pagarMultaData = new SlashCommandBuilder()
  .setName('pagar-multa')
  .setDescription('Paga una multa con el saldo de tu cuenta bancaria')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('id').setDescription('ID de la multa').setRequired(true))

export const multarData = new SlashCommandBuilder()
  .setName('multar')
  .setDescription('Emite una multa a un ciudadano')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano multado').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo de la multa').setRequired(true).setMaxLength(500))
  .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos chilenos').setRequired(true).setMinValue(1).setMaxValue(2_000_000_000))

export const arrestarData = new SlashCommandBuilder()
  .setName('arrestar')
  .setDescription('Registra un arresto con artículo penal y evidencia')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano').setRequired(true))
  .addStringOption((o) => o.setName('articulo').setDescription('Número de artículo penal, por ejemplo 103 o 46.1').setRequired(true).setMaxLength(10))
  .addStringOption((o) => o.setName('condena').setDescription('Condena RP aplicada, por ejemplo 5 minutos').setRequired(true).setMaxLength(100))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo y detalles del procedimiento').setRequired(true).setMaxLength(500))
  .addAttachmentOption((o) => o.setName('foto').setDescription('Captura del arresto en el juego').setRequired(true))

export const liberarData = new SlashCommandBuilder()
  .setName('liberar')
  .setDescription('Registra la liberación de un ciudadano')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo de la liberación').setMaxLength(500))

export const antecedentesData = new SlashCommandBuilder()
  .setName('antecedentes')
  .setDescription('Consulta tus antecedentes vigentes')
  .setContexts(InteractionContextType.Guild)

export const antecedenteData = new SlashCommandBuilder()
  .setName('antecedente')
  .setDescription('Gestiona antecedentes policiales')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('registrar')
      .setDescription('Registra un antecedente con artículo penal y evidencia')
      .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano').setRequired(true))
      .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setRequired(true).setMaxLength(500))
      .addStringOption((o) => o.setName('articulo').setDescription('Número de artículo penal, por ejemplo 103 o 46.1').setRequired(true).setMaxLength(10))
      .addStringOption((o) => o.setName('condena').setDescription('Condena RP aplicada').setRequired(true).setMaxLength(100))
      .addAttachmentOption((o) => o.setName('foto').setDescription('Captura del procedimiento en el juego').setRequired(true))
      .addIntegerOption((o) => o.setName('dias').setDescription('Días hasta su expiración').setMinValue(1).setMaxValue(3650)),
  )
  .addSubcommand((s) =>
    s
      .setName('listar')
      .setDescription('Lista antecedentes de un ciudadano')
      .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano (por defecto, tú)')),
  )
  .addSubcommand((s) =>
    s.setName('ver').setDescription('Muestra un antecedente').addStringOption((o) => o.setName('id').setDescription('ID').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('eliminar')
      .setDescription('Marca un antecedente como no vigente')
      .addStringOption((o) => o.setName('id').setDescription('ID').setRequired(true)),
  )

export const certData = new SlashCommandBuilder()
  .setName('cert')
  .setDescription('Solicita certificados personales')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('permiso').setDescription('Emite un permiso de porte de arma'))
  .addSubcommand((s) => s.setName('revision').setDescription('Emite un certificado de revisión técnica'))
  .addSubcommand((s) => s.setName('inscripcion').setDescription('Emite un certificado de antecedentes'))
  .addSubcommand((s) => s.setName('licencia').setDescription('Emite una licencia de conducir'))

export const empresasData = new SlashCommandBuilder()
  .setName('empresas')
  .setDescription('Consulta las instituciones disponibles')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('lista').setDescription('Lista instituciones activas'))

export const legales = [
  { data: multasData, execute: ejecutarMultas },
  { data: pagarMultaData, execute: ejecutarPagoMulta },
  { data: multarData, execute: ejecutarMultar },
  { data: arrestarData, execute: ejecutarArrestar },
  { data: liberarData, execute: ejecutarLiberar },
  { data: antecedentesData, execute: ejecutarAntecedentes },
  { data: antecedenteData, execute: ejecutarAntecedente },
  { data: certData, execute: ejecutarCert },
  { data: empresasData, execute: ejecutarEmpresas },
]

async function ejecutarMultas(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'No tienes un personaje activo.', flags: efimero })
  const multas = await db.multa.findMany({ where: { personajeId: personaje.id }, orderBy: { emitidaEn: 'desc' }, take: 10 })
  if (multas.length === 0) return i.reply({ content: 'No tienes multas registradas.', flags: efimero })
  return i.reply({
    embeds: [
      crearEmbed(`Multas · ${personaje.nombres} ${personaje.apellidos}`, 'Últimos registros asociados a tu personaje.')
        .addFields(multas.map((m) => ({
          name: `${m.estado === 'PENDIENTE' ? 'Pendiente' : m.estado === 'PAGADA' ? 'Pagada' : 'Anulada'} · ${formatearMoneda(m.monto)}`,
          value: `${m.motivo}\nID: ${m.id}`,
          inline: false,
        })))
        .setColor(multas.some((m) => m.estado === 'PENDIENTE') ? coloresEmbed.aviso : coloresEmbed.principal),
    ],
    flags: efimero,
  })
}

async function ejecutarPagoMulta(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'No tienes un personaje activo.', flags: efimero })
  const multa = await db.multa.findFirst({ where: { id: i.options.getString('id', true), personajeId: personaje.id } })
  if (!multa || multa.estado !== 'PENDIENTE') {
    return i.reply({ content: 'No se encontró una multa pendiente tuya con ese ID.', flags: efimero })
  }
  const cuenta = await db.cuentaBancaria.findFirst({ where: { personajeId: personaje.id, estado: 'ACTIVA' }, orderBy: { creadaEn: 'asc' } })
  if (!cuenta) return i.reply({ content: 'No tienes una cuenta bancaria activa.', flags: efimero })

  try {
    await db.$transaction(async (tx) => {
      const debito = await tx.cuentaBancaria.updateMany({
        where: { id: cuenta.id, estado: 'ACTIVA', saldo: { gte: multa.monto } },
        data: { saldo: { decrement: multa.monto } },
      })
      if (debito.count === 0) throw new Error('SALDO_INSUFICIENTE')
      const transaccion = await tx.transaccion.create({
        data: { tipo: 'PAGO_MULTA', monto: multa.monto, glosa: `Pago de multa ${multa.id}`, origenId: cuenta.id },
      })
      const pagada = await tx.multa.updateMany({
        where: { id: multa.id, estado: 'PENDIENTE' },
        data: { estado: 'PAGADA', pagadaEn: new Date(), transaccionPagoId: transaccion.id },
      })
      if (pagada.count === 0) throw new Error('MULTA_PROCESADA')
    })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : ''
    if (mensaje === 'SALDO_INSUFICIENTE') return i.reply({ content: 'Saldo insuficiente para pagar esta multa.', flags: efimero })
    if (mensaje === 'MULTA_PROCESADA') return i.reply({ content: 'La multa ya fue procesada.', flags: efimero })
    throw error
  }
  return i.reply({ content: `Multa pagada: **$${multa.monto.toLocaleString('es-CL')}**.`, flags: efimero })
}

async function ejecutarMultar(i: ChatInputCommandInteraction) {
  if (!esPolicia(i)) return i.reply({ content: 'Este comando requiere rol policial o staff.', flags: efimero })
  const emisor = await personajeDe(i.user.id)
  const multado = await personajeDe(i.options.getUser('usuario', true).id)
  if (!emisor || !multado) return i.reply({ content: 'El emisor y el ciudadano deben tener un personaje activo.', flags: efimero })
  const multa = await db.multa.create({
    data: {
      personajeId: multado.id,
      emisorId: emisor.id,
      motivo: i.options.getString('motivo', true),
      monto: BigInt(i.options.getInteger('monto', true)),
    },
  })
  return i.reply({ content: `Multa registrada para ${multado.nombres} ${multado.apellidos}. ID: **${multa.id}**.` })
}

async function ejecutarArrestar(i: ChatInputCommandInteraction) {
  if (!esPolicia(i)) return i.reply({ content: 'Este comando requiere rol policial o staff.', flags: efimero })
  const objetivo = await personajeDe(i.options.getUser('usuario', true).id)
  const agente = await personajeDe(i.user.id)
  if (!objetivo || !agente) return i.reply({ content: 'El ciudadano y el agente deben tener un personaje activo.', flags: efimero })
  const articulo = buscarArticulo(i.options.getString('articulo', true))
  if (!articulo) return i.reply({ content: 'Artículo penal inexistente. Consulta `/codigo-penal buscar`.', flags: efimero })
  const ultimo = await db.auditoria.findFirst({ where: { entidad: 'Arresto', entidadId: objetivo.id }, orderBy: { creadaEn: 'desc' } })
  if (ultimo?.accion === 'arresto.registrar') return i.reply({ content: 'Ese personaje ya tiene un arresto activo.', flags: efimero })
  await i.deferReply()
  const adjunto = await cargarImagenDiscord(i.options.getAttachment('foto', true))
  if ('error' in adjunto) return i.editReply({ content: adjunto.error ?? 'No se pudo validar la imagen.' })
  const motivo = i.options.getString('motivo', true).trim()
  const condena = i.options.getString('condena', true).trim()
  const codigo = crearCodigoRegistro()
  const fecha = new Date()
  const actor = await asegurarUsuario(i.user)
  const registro = await db.auditoria.create({ data: {
    actorId: actor.id,
    accion: 'arresto.registrar',
    entidad: 'Arresto',
    entidadId: objetivo.id,
    detalle: {
      motivo,
      condena,
      codigo,
      fecha: fecha.toISOString(),
      articulo: { numero: articulo.numero, delito: articulo.delito, titulo: articulo.titulo, pena: articulo.pena },
      fotoUrl: i.options.getAttachment('foto', true).url,
    },
  } })
  return i.editReply({
    embeds: [crearFichaLegal({ titulo: 'Registro: Encarcelamiento', objetivo, agente, articulo, codigo, fecha, condena, motivo, foto: adjunto.nombre })],
    files: [adjunto.archivo],
    content: `Registro **${registro.id}**`,
  })
}

async function ejecutarLiberar(i: ChatInputCommandInteraction) {
  if (!esPolicia(i)) return i.reply({ content: 'Este comando requiere rol policial o staff.', flags: efimero })
  const objetivo = await personajeDe(i.options.getUser('usuario', true).id)
  if (!objetivo) return i.reply({ content: 'El ciudadano no tiene un personaje activo.', flags: efimero })
  const ultimo = await db.auditoria.findFirst({ where: { entidad: 'Arresto', entidadId: objetivo.id }, orderBy: { creadaEn: 'desc' } })
  if (!ultimo || ultimo.accion !== 'arresto.registrar') return i.reply({ content: 'Ese personaje no tiene un arresto activo.', flags: efimero })
  const actor = await asegurarUsuario(i.user)
  await db.auditoria.create({ data: {
    actorId: actor.id,
    accion: 'arresto.liberar',
    entidad: 'Arresto',
    entidadId: objetivo.id,
    detalle: { arrestoId: ultimo.id, motivo: i.options.getString('motivo') },
  } })
  return i.reply({ content: `**${objetivo.nombres} ${objetivo.apellidos}** fue liberado.` })
}

async function ejecutarAntecedentes(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'No tienes un personaje activo.', flags: efimero })
  const items = await db.antecedente.findMany({
    where: { personajeId: personaje.id, vigente: true, OR: [{ expiraEn: null }, { expiraEn: { gt: new Date() } }] },
    orderBy: { registradoEn: 'desc' },
  })
  return i.reply({
    content: items.length ? items.map((a) => `**${a.id}** · ${a.descripcion}`).join('\n') : 'No tienes antecedentes vigentes.',
    flags: efimero,
  })
}

async function ejecutarAntecedente(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  if (accion === 'listar' && !esPolicia(i)) {
    return i.reply({ content: 'Solo policía o staff puede consultar antecedentes de terceros.', flags: efimero })
  }
  if (accion !== 'listar' && !esPolicia(i)) {
    return i.reply({ content: 'Esta acción requiere rol policial o staff.', flags: efimero })
  }

  if (accion === 'registrar') {
    const usuarioObjetivo = i.options.getUser('usuario', true)
    const personaje = await personajeDe(usuarioObjetivo.id)
    const emisor = await personajeDe(i.user.id)
    if (!personaje || !emisor) return i.reply({ content: 'El emisor y el ciudadano deben tener un personaje activo.', flags: efimero })
    const articulo = buscarArticulo(i.options.getString('articulo', true))
    if (!articulo) return i.reply({ content: 'Artículo penal inexistente. Consulta `/codigo-penal buscar`.', flags: efimero })
    await i.deferReply()
    const adjunto = await cargarImagenDiscord(i.options.getAttachment('foto', true))
    if ('error' in adjunto) return i.editReply({ content: adjunto.error ?? 'No se pudo validar la imagen.' })
    const dias = i.options.getInteger('dias')
    const expiraEn = dias ? new Date(Date.now() + dias * 86_400_000) : null
    const motivo = i.options.getString('descripcion', true).trim()
    const condena = i.options.getString('condena', true).trim()
    const codigo = crearCodigoRegistro()
    const fecha = new Date()
    const antecedente = await db.antecedente.create({ data: {
      personajeId: personaje.id,
      descripcion: `Art. ${articulo.numero} · ${articulo.delito}: ${motivo}`,
      expiraEn,
    } })
    const actor = await asegurarUsuario(i.user)
    await db.auditoria.create({ data: {
      actorId: actor.id,
      accion: 'antecedente.registrar',
      entidad: 'Antecedente',
      entidadId: antecedente.id,
      detalle: {
        motivo,
        condena,
        codigo,
        fecha: fecha.toISOString(),
        articulo: { numero: articulo.numero, delito: articulo.delito, titulo: articulo.titulo, pena: articulo.pena },
        fotoUrl: i.options.getAttachment('foto', true).url,
        expiraEn: expiraEn?.toISOString() ?? null,
      },
    } })
    return i.editReply({
      content: `Antecedente registrado. ID: **${antecedente.id}**.`,
      embeds: [crearFichaLegal({ titulo: 'Registro: Antecedente ciudadano', objetivo: personaje, agente: emisor, articulo, codigo, fecha, condena, motivo, foto: adjunto.nombre })],
      files: [adjunto.archivo],
    })
  }

  if (accion === 'listar') {
    const objetivo = i.options.getUser('usuario') ?? i.user
    const personaje = await personajeDe(objetivo.id)
    if (!personaje) return i.reply({ content: 'No se encontró un personaje activo.', flags: efimero })
    const items = await db.antecedente.findMany({ where: { personajeId: personaje.id }, orderBy: { registradoEn: 'desc' }, take: 15 })
    return i.reply({
      content: items.length ? items.map((a) => `**${a.id}** · ${a.vigente ? 'Vigente' : 'No vigente'} · ${a.descripcion}`).join('\n') : 'Sin antecedentes registrados.',
      flags: efimero,
    })
  }

  const id = i.options.getString('id', true)
  const item = await db.antecedente.findUnique({ where: { id }, include: { personaje: true } })
  if (!item) return i.reply({ content: 'Antecedente no encontrado.', flags: efimero })
  if (accion === 'ver') {
    return i.reply({
      content: `**${item.personaje.nombres} ${item.personaje.apellidos}** · ${item.vigente ? 'Vigente' : 'No vigente'}\n${item.descripcion}`,
      flags: efimero,
    })
  }
  await db.antecedente.update({ where: { id }, data: { vigente: false } })
  return i.reply({ content: 'Antecedente marcado como no vigente.', flags: efimero })
}

async function ejecutarCert(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })
  const accion = i.options.getSubcommand()
  const tipos = {
    permiso: ['PORTE_ARMA', 'Permiso de porte de arma'],
    revision: ['OTRO', 'Certificado de revisión técnica'],
    inscripcion: ['CERTIFICADO_ANTECEDENTES', 'Certificado de antecedentes'],
    licencia: ['LICENCIA_CONDUCIR', 'Licencia de conducir'],
  } as const
  const [tipo, titulo] = tipos[accion as keyof typeof tipos]
  let numero = generarNumeroSerie()
  while (await db.documento.findUnique({ where: { numero } })) numero = generarNumeroSerie()
  const venceEn = new Date()
  venceEn.setFullYear(venceEn.getFullYear() + 1)
  await db.documento.create({ data: { personajeId: personaje.id, tipo, numero, detalle: { titulo }, venceEn } })
  return i.reply({ content: `${titulo} emitido. Folio: **${numero}**.`, flags: efimero })
}

async function ejecutarEmpresas(i: ChatInputCommandInteraction) {
  const instituciones = await db.institucion.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } })
  return i.reply({
    content: instituciones.length
      ? instituciones.map((item) => `**${item.nombre}** · ${item.tipo}${item.descripcion ? `\n${item.descripcion}` : ''}`).join('\n\n')
      : 'No hay instituciones activas registradas.',
    flags: efimero,
  })
}

async function personajeDe(discordId: string) {
  return db.personaje.findFirst({ where: { activo: true, usuario: { discordId } }, orderBy: { creadoEn: 'asc' } })
}

function esPolicia(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  if (!i.inCachedGuild()) return false
  return i.member.roles.cache.has(process.env.ROL_STAFF_ID ?? '') ||
    (!!process.env.ROL_POLICIA_ID && i.member.roles.cache.has(process.env.ROL_POLICIA_ID))
}

function buscarArticulo(valor: string) {
  const numero = Number(valor.trim().replace(/^art(?:ículo)?\.?\s*/i, ''))
  return Number.isFinite(numero) ? CODIGO_PENAL.find((articulo) => articulo.numero === numero) : undefined
}

function crearCodigoRegistro() {
  return `${Date.now().toString().slice(-9)}${Math.floor(100_000 + Math.random() * 900_000)}`
}

function crearFichaLegal({
  titulo,
  objetivo,
  agente,
  articulo,
  codigo,
  fecha,
  condena,
  motivo,
  foto,
}: {
  titulo: string
  objetivo: { nombres: string; apellidos: string; rut: string }
  agente: { nombres: string; apellidos: string }
  articulo: ArticuloPenal
  codigo: string
  fecha: Date
  condena: string
  motivo: string
  foto: string
}) {
  const fechaLocal = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(fecha)
  return crearEmbed(titulo, 'La entidad responsable registró el procedimiento. La evidencia gráfica se adjunta al documento.', coloresEmbed.aviso)
    .addFields(
      { name: 'Información Ciudadano', value: `• **Nombre:** ${objetivo.nombres} ${objetivo.apellidos}\n• **RUT:** ${objetivo.rut}` },
      { name: 'Información Agente', value: `• **Nombre:** ${agente.nombres} ${agente.apellidos}` },
      { name: 'Delito Imputado', value: `• **Artículo ${articulo.numero}:** ${articulo.delito}\n• **Título:** ${articulo.titulo}\n• **Pena legal:** ${articulo.pena}` },
      { name: 'Información Registro', value: `• **Código Documento:** ${codigo}\n• **Fecha:** ${fechaLocal}\n• **Condena RP:** ${condena}\n• **Motivo:** ${motivo}` },
    )
    .setImage(`attachment://${foto}`)
}
