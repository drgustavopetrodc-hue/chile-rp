import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { formatearMoneda } from '../utils/moneda'

const efimero = MessageFlags.Ephemeral
const plata = formatearMoneda

export const economiaData = new SlashCommandBuilder()
  .setName('economia')
  .setDescription('Administra tu dinero, banco e inventario')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('balance').setDescription('Consulta tus saldos'))
  .addSubcommand((s) =>
    s.setName('pagar').setDescription('Transfiere dinero a otro personaje')
      .addUserOption((o) => o.setName('usuario').setDescription('Destinatario').setRequired(true))
      .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((s) => s.setName('depositar').setDescription('Deposita efectivo en tu cuenta')
    .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('retirar').setDescription('Retira dinero de tu cuenta')
    .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('diario').setDescription('Reclama tu pago diario'))
  .addSubcommand((s) => s.setName('trabajar').setDescription('Trabaja para ganar dinero'))
  .addSubcommand((s) => s.setName('top').setDescription('Consulta el ranking de riqueza'))
  .addSubcommand((s) => s.setName('tienda').setDescription('Muestra los artículos disponibles'))
  .addSubcommand((s) => s.setName('inventario').setDescription('Muestra tu inventario'))
  .addSubcommand((s) => s.setName('reclamar').setDescription('Compra un artículo')
    .addStringOption((o) => o.setName('articulo').setDescription('Nombre del artículo').setRequired(true))
    .addIntegerOption((o) => o.setName('cantidad').setDescription('Cantidad').setMinValue(1).setMaxValue(100)))
  .addSubcommand((s) => s.setName('encargados').setDescription('Lista encargados de una institución')
    .addStringOption((o) => o.setName('institucion').setDescription('Nombre de institución')))
  .addSubcommand((s) => s.setName('dar').setDescription('Entrega dinero (administradores)')
    .addUserOption((o) => o.setName('usuario').setDescription('Destinatario').setRequired(true))
    .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1)))
  .addSubcommand((s) => s.setName('quitar').setDescription('Retira dinero (administradores)')
    .addUserOption((o) => o.setName('usuario').setDescription('Ciudadano').setRequired(true))
    .addIntegerOption((o) => o.setName('monto').setDescription('Monto en pesos').setRequired(true).setMinValue(1)))

export const crimenData = new SlashCommandBuilder()
  .setName('crimen')
  .setDescription('Intenta conseguir dinero sucio')
  .setContexts(InteractionContextType.Guild)

export const lavarData = new SlashCommandBuilder()
  .setName('lavar')
  .setDescription('Lava dinero sucio con una comisión')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((o) => o.setName('monto').setDescription('Monto sucio a lavar').setRequired(true).setMinValue(1))

export const economia = [
  { data: economiaData, execute: ejecutarEconomia },
  { data: crimenData, execute: ejecutarCrimen },
  { data: lavarData, execute: ejecutarLavado },
]

async function ejecutarEconomia(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  const personaje = await personajeDe(i.user.id)
  if (accion === 'encargados') return listarEncargados(i)
  if (accion === 'dar' || accion === 'quitar') return ajustarSaldo(i, accion)
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })

  if (accion === 'balance') {
    const cuenta = await asegurarCuenta(personaje.id)
    return i.reply({
      embeds: [new EmbedBuilder().setTitle(`Balance de ${personaje.nombres} ${personaje.apellidos}`).addFields(
        { name: 'Efectivo', value: plata(personaje.dinero), inline: true },
        { name: 'Banco', value: plata(cuenta.saldo), inline: true },
        { name: 'Dinero sucio', value: plata(personaje.dineroSucio), inline: true },
      )],
      flags: efimero,
    })
  }
  if (accion === 'pagar') return pagar(i, personaje.id)
  if (accion === 'depositar') return depositar(i, personaje.id)
  if (accion === 'retirar') return retirar(i, personaje.id)
  if (accion === 'diario') return reclamarDiario(i, personaje)
  if (accion === 'trabajar') return trabajar(i, personaje)
  if (accion === 'top') {
    const top = await db.personaje.findMany({ where: { activo: true }, orderBy: { dinero: 'desc' }, take: 10 })
    return i.reply({
      embeds: [new EmbedBuilder().setTitle('Personajes con más efectivo').setDescription(
        top.length ? top.map((p, index) => `**${index + 1}.** ${p.nombres} ${p.apellidos} · ${plata(p.dinero)}`).join('\n') : 'Sin datos',
      )],
      flags: efimero,
    })
  }
  if (accion === 'tienda') {
    const items = await db.item.findMany({ where: { activa: true }, orderBy: { precio: 'asc' } })
    return i.reply({
      content: items.length ? items.map((item) => `**${item.nombre}** · ${plata(item.precio)}${item.descripcion ? `\n${item.descripcion}` : ''}`).join('\n\n') : 'La tienda está vacía.',
      flags: efimero,
    })
  }
  if (accion === 'inventario') {
    const items = await db.inventarioItem.findMany({ where: { personajeId: personaje.id, cantidad: { gt: 0 } }, include: { item: true } })
    return i.reply({ content: items.length ? items.map((row) => `**${row.item.nombre}** × ${row.cantidad}`).join('\n') : 'Tu inventario está vacío.', flags: efimero })
  }
  if (accion === 'reclamar') return comprar(i, personaje.id)
  return i.reply({ content: 'Acción desconocida.', flags: efimero })
}

async function pagar(i: ChatInputCommandInteraction, origenId: string) {
  const destino = await personajeDe(i.options.getUser('usuario', true).id)
  if (!destino) return i.reply({ content: 'El destinatario no tiene un personaje activo.', flags: efimero })
  if (destino.id === origenId) return i.reply({ content: 'No puedes transferirte dinero a ti mismo.', flags: efimero })
  const monto = BigInt(i.options.getInteger('monto', true))
  const origen = await db.personaje.findUniqueOrThrow({ where: { id: origenId } })
  const actualizado = await db.$transaction(async (tx) => {
    const debitado = await tx.personaje.updateMany({ where: { id: origenId, dinero: { gte: monto } }, data: { dinero: { decrement: monto } } })
    if (!debitado.count) return false
    await tx.personaje.update({ where: { id: destino.id }, data: { dinero: { increment: monto } } })
    await tx.movimientoEconomia.createMany({ data: [
      { personajeId: origenId, tipo: 'TRANSFERENCIA_SALIDA', monto, descripcion: `A ${destino.nombres} ${destino.apellidos}` },
      { personajeId: destino.id, tipo: 'TRANSFERENCIA_ENTRADA', monto, descripcion: `De ${origen.nombres} ${origen.apellidos}` },
    ] })
    return true
  })
  return i.reply({ content: actualizado ? `Transferiste ${plata(monto)} a **${destino.nombres} ${destino.apellidos}**.` : 'No tienes efectivo suficiente.', flags: efimero })
}

async function depositar(i: ChatInputCommandInteraction, personajeId: string) {
  const monto = BigInt(i.options.getInteger('monto', true))
  const cuenta = await asegurarCuenta(personajeId)
  const ok = await db.$transaction(async (tx) => {
    const debitado = await tx.personaje.updateMany({ where: { id: personajeId, dinero: { gte: monto } }, data: { dinero: { decrement: monto } } })
    if (!debitado.count) return false
    await tx.cuentaBancaria.update({ where: { id: cuenta.id }, data: { saldo: { increment: monto } } })
    await tx.movimientoEconomia.create({ data: { personajeId, tipo: 'DEPOSITO', monto } })
    return true
  })
  return i.reply({ content: ok ? `Depositaste ${plata(monto)}.` : 'No tienes efectivo suficiente.', flags: efimero })
}

async function retirar(i: ChatInputCommandInteraction, personajeId: string) {
  const monto = BigInt(i.options.getInteger('monto', true))
  const cuenta = await asegurarCuenta(personajeId)
  const ok = await db.$transaction(async (tx) => {
    const debitado = await tx.cuentaBancaria.updateMany({ where: { id: cuenta.id, saldo: { gte: monto } }, data: { saldo: { decrement: monto } } })
    if (!debitado.count) return false
    await tx.personaje.update({ where: { id: personajeId }, data: { dinero: { increment: monto } } })
    await tx.movimientoEconomia.create({ data: { personajeId, tipo: 'RETIRO', monto } })
    return true
  })
  return i.reply({ content: ok ? `Retiraste ${plata(monto)}.` : 'Saldo bancario insuficiente.', flags: efimero })
}

async function reclamarDiario(i: ChatInputCommandInteraction, personaje: NonNullable<Awaited<ReturnType<typeof personajeDe>>>) {
  const ahora = new Date()
  const recompensa = BigInt(await numeroConfig('economia.diario', 1000))
  const result = await db.personaje.updateMany({
    where: { id: personaje.id, OR: [{ diarioDisponibleEn: null }, { diarioDisponibleEn: { lte: ahora } }] },
    data: { dinero: { increment: recompensa }, diarioDisponibleEn: new Date(ahora.getTime() + 86_400_000) },
  })
  if (!result.count) return i.reply({ content: 'Ya reclamaste tu pago diario. Vuelve en 24 horas.', flags: efimero })
  await db.movimientoEconomia.create({ data: { personajeId: personaje.id, tipo: 'DIARIO', monto: recompensa } })
  return i.reply({ content: `Recibiste ${plata(recompensa)}.`, flags: efimero })
}

async function trabajar(i: ChatInputCommandInteraction, personaje: NonNullable<Awaited<ReturnType<typeof personajeDe>>>) {
  const ahora = new Date()
  const minimo = await numeroConfig('economia.trabajoMinimo', 500)
  const maximo = await numeroConfig('economia.trabajoMaximo', 1200)
  const recompensa = BigInt(Math.floor(minimo + Math.random() * (maximo - minimo + 1)))
  const result = await db.personaje.updateMany({
    where: { id: personaje.id, OR: [{ trabajoDisponibleEn: null }, { trabajoDisponibleEn: { lte: ahora } }] },
    data: { dinero: { increment: recompensa }, trabajoDisponibleEn: new Date(ahora.getTime() + 3_600_000) },
  })
  if (!result.count) return i.reply({ content: 'Ya trabajaste recientemente. Vuelve en una hora.', flags: efimero })
  await db.movimientoEconomia.create({ data: { personajeId: personaje.id, tipo: 'TRABAJO', monto: recompensa } })
  return i.reply({ content: `Terminaste tu turno y ganaste ${plata(recompensa)}.`, flags: efimero })
}

async function comprar(i: ChatInputCommandInteraction, personajeId: string) {
  const nombre = i.options.getString('articulo', true)
  const cantidad = i.options.getInteger('cantidad') ?? 1
  const item = await db.item.findFirst({ where: { activa: true, nombre: { equals: nombre, mode: 'insensitive' } } })
  if (!item) return i.reply({ content: 'Artículo no disponible.', flags: efimero })
  const total = item.precio * BigInt(cantidad)
  const ok = await db.$transaction(async (tx) => {
    const debitado = await tx.personaje.updateMany({ where: { id: personajeId, dinero: { gte: total } }, data: { dinero: { decrement: total } } })
    if (!debitado.count) return false
    await tx.inventarioItem.upsert({
      where: { personajeId_itemId: { personajeId, itemId: item.id } },
      create: { personajeId, itemId: item.id, cantidad },
      update: { cantidad: { increment: cantidad } },
    })
    await tx.movimientoEconomia.create({ data: { personajeId, tipo: 'COMPRA', monto: total, descripcion: item.nombre } })
    return true
  })
  return i.reply({ content: ok ? `Compraste **${cantidad} × ${item.nombre}** por ${plata(total)}.` : 'No tienes efectivo suficiente.', flags: efimero })
}

async function ajustarSaldo(i: ChatInputCommandInteraction, accion: 'dar' | 'quitar') {
  if (!esAdmin(i)) return i.reply({ content: 'Solo administradores pueden ajustar dinero.', flags: efimero })
  const personaje = await personajeDe(i.options.getUser('usuario', true).id)
  if (!personaje) return i.reply({ content: 'El usuario no tiene un personaje activo.', flags: efimero })
  const monto = BigInt(i.options.getInteger('monto', true))
  const cambio = accion === 'dar' ? monto : -monto
  const result = await db.personaje.updateMany({ where: { id: personaje.id, dinero: { gte: accion === 'quitar' ? monto : 0n } }, data: { dinero: { increment: cambio } } })
  if (!result.count) return i.reply({ content: 'Saldo insuficiente para retirar ese monto.', flags: efimero })
  await db.movimientoEconomia.create({ data: { personajeId: personaje.id, tipo: `ADMIN_${accion.toUpperCase()}`, monto, descripcion: `Por ${i.user.tag}` } })
  return i.reply({ content: `${accion === 'dar' ? 'Entregados' : 'Retirados'} ${plata(monto)} a **${personaje.nombres} ${personaje.apellidos}**.`, flags: efimero })
}

async function listarEncargados(i: ChatInputCommandInteraction) {
  const filtro = i.options.getString('institucion')
  const funcionarios = await db.funcionario.findMany({
    where: { activo: true, cargo: { ...(filtro && { institucion: { nombre: { contains: filtro, mode: 'insensitive' } } }) } },
    include: { personaje: true, cargo: { include: { institucion: true } } },
    orderBy: [{ cargo: { nivel: 'desc' } }, { desde: 'asc' }],
    take: 20,
  })
  return i.reply({ content: funcionarios.length
    ? funcionarios.map((f) => `**${f.personaje.nombres} ${f.personaje.apellidos}** · ${f.cargo.nombre} · ${f.cargo.institucion.nombre}`).join('\n')
    : 'No hay encargados registrados.', flags: efimero })
}

async function ejecutarCrimen(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })
  const ahora = new Date()
  if (personaje.crimenDisponibleEn && personaje.crimenDisponibleEn > ahora) {
    const minutos = Math.ceil((personaje.crimenDisponibleEn.getTime() - ahora.getTime()) / 60_000)
    return i.reply({ content: `Debes esperar ${minutos} minutos antes de volver a intentarlo.`, flags: efimero })
  }
  const cooldown = await numeroConfig('economia.crimenCooldownMinutos', 120)
  const exitoso = Math.random() < 0.65
  const monto = BigInt(exitoso ? Math.floor(1000 + Math.random() * 4001) : 0)
  const result = await db.personaje.updateMany({
    where: { id: personaje.id, OR: [{ crimenDisponibleEn: null }, { crimenDisponibleEn: { lte: ahora } }] },
    data: {
      crimenDisponibleEn: new Date(ahora.getTime() + cooldown * 60_000),
      ...(exitoso && { dineroSucio: { increment: monto } }),
    },
  })
  if (!result.count) return i.reply({ content: 'Ya intentaste un crimen recientemente.', flags: efimero })
  await db.movimientoEconomia.create({ data: { personajeId: personaje.id, tipo: exitoso ? 'CRIMEN' : 'CRIMEN_FALLIDO', monto } })
  return i.reply({ content: exitoso ? `El golpe salió bien. Obtuviste ${plata(monto)} en dinero sucio.` : 'El golpe falló. No obtuviste dinero.', flags: efimero })
}

async function ejecutarLavado(i: ChatInputCommandInteraction) {
  const personaje = await personajeDe(i.user.id)
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })
  const monto = BigInt(i.options.getInteger('monto', true))
  const ahora = new Date()
  const tasa = await numeroConfig('economia.lavadoPorcentaje', 20)
  const limpio = monto * BigInt(100 - tasa) / 100n
  const result = await db.$transaction(async (tx) => {
    const cambio = await tx.personaje.updateMany({
      where: { id: personaje.id, dineroSucio: { gte: monto }, OR: [{ lavadoDisponibleEn: null }, { lavadoDisponibleEn: { lte: ahora } }] },
      data: {
        dineroSucio: { decrement: monto },
        dinero: { increment: limpio },
        lavadoDisponibleEn: new Date(ahora.getTime() + 3_600_000),
      },
    })
    if (!cambio.count) return false
    await tx.movimientoEconomia.create({ data: { personajeId: personaje.id, tipo: 'LAVADO', monto, descripcion: `Recibido limpio: ${limpio}` } })
    return true
  })
  if (!result) return i.reply({ content: 'Monto insuficiente o lavado en cooldown. Revisa tu balance.', flags: efimero })
  return i.reply({ content: `Lavado completado. Recibiste ${plata(limpio)} después de la comisión.`, flags: efimero })
}

async function personajeDe(discordId: string) {
  return db.personaje.findFirst({ where: { activo: true, usuario: { discordId } }, orderBy: { creadoEn: 'asc' } })
}

async function asegurarCuenta(personajeId: string) {
  const existente = await db.cuentaBancaria.findFirst({ where: { personajeId, estado: 'ACTIVA' }, orderBy: { creadaEn: 'asc' } })
  if (existente) return existente
  let numero = String(Math.floor(100_000_000 + Math.random() * 900_000_000))
  while (await db.cuentaBancaria.findUnique({ where: { numero } })) numero = String(Math.floor(100_000_000 + Math.random() * 900_000_000))
  return db.cuentaBancaria.create({ data: { personajeId, numero } })
}

async function numeroConfig(clave: string, defecto: number) {
  const fila = await db.configuracionServidor.findUnique({ where: { clave } })
  return typeof fila?.valor === 'number' ? fila.valor : defecto
}

function esAdmin(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true
  return !!i.inCachedGuild() && !!process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)
}
