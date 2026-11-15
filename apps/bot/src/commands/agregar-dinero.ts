import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { RolPlataforma, db } from '@rp-chile/db'
import { asegurarUsuario } from '../utils/usuarios'
import { formatearMoneda } from '../utils/moneda'

const efimero = MessageFlags.Ephemeral

export const agregarDineroData = new SlashCommandBuilder()
  .setName('agregar')
  .setDescription('Agrega dinero, categorías, empresas o equipo')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('dinero').setDescription('Entrega dinero por usuario o rol')
    .addUserOption((o) => o.setName('usuario').setDescription('Un usuario'))
    .addRoleOption((o) => o.setName('rol').setDescription('Todos los miembros de un rol'))
    .addIntegerOption((o) => o.setName('monto').setDescription('Monto por personaje').setRequired(true).setMinValue(1).setMaxValue(2_000_000_000)))
  .addSubcommand((s) => s.setName('categoria').setDescription('Agrega una categoría (owner)')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre de categoría').setRequired(true).setMaxLength(60)))
  .addSubcommand((s) => s.setName('empresas').setDescription('Crea una empresa/institución (owner)')
    .addStringOption((o) => o.setName('nombre').setDescription('Nombre').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('slug').setDescription('Identificador').setRequired(true).setMaxLength(40))
    .addStringOption((o) => o.setName('tipo').setDescription('Tipo').setRequired(true).addChoices(
      { name: 'Gobierno', value: 'GOBIERNO' }, { name: 'Municipal', value: 'MUNICIPAL' },
      { name: 'Judicial', value: 'JUDICIAL' }, { name: 'Fiscalía', value: 'FISCALIA' },
      { name: 'Defensoría', value: 'DEFENSORIA' }, { name: 'Policial', value: 'POLICIAL' },
      { name: 'Salud', value: 'SALUD' }, { name: 'Bancaria', value: 'BANCARIA' }, { name: 'Otra', value: 'OTRA' },
    ))
    .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setMaxLength(500)))
  .addSubcommand((s) => s.setName('administrador').setDescription('Agrega un administrador (owner)')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))
  .addSubcommand((s) => s.setName('moderador').setDescription('Agrega un moderador (owner)')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))
  .addSubcommand((s) => s.setName('soporte').setDescription('Agrega soporte (owner)')
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro').setRequired(true)))

export const agregarDinero = { data: agregarDineroData, execute: ejecutarAgregarDinero }

async function ejecutarAgregarDinero(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return i.reply({ content: 'Usa este comando dentro del servidor.', flags: efimero })
  const accion = i.options.getSubcommand()
  if (accion !== 'dinero') return ejecutarAgregarOwner(i, accion)
  const limite = limitePorRango(i)
  if (!limite) return i.reply({ content: 'Este comando requiere un rol de staff autorizado.', flags: efimero })
  const monto = i.options.getInteger('monto', true)
  if (monto > limite) return i.reply({ content: `Tu rango permite entregar hasta ${formatearMoneda(limite)} por personaje.`, flags: efimero })

  const usuario = i.options.getUser('usuario')
  const rol = i.options.getRole('rol')
  if (!!usuario === !!rol) return i.reply({ content: 'Indica exactamente un usuario o un rol.', flags: efimero })
  const destinatarios = usuario
    ? [usuario.id]
    : (await i.guild.members.fetch()).filter((m) => !m.user.bot && m.roles.cache.has(rol!.id)).map((m) => m.id)
  if (!destinatarios.length) return i.reply({ content: 'No hay miembros con ese rol.', flags: efimero })
  if (destinatarios.length > 500) return i.reply({ content: 'El rol supera el máximo de 500 destinatarios por operación.', flags: efimero })

  const personajes = await db.personaje.findMany({
    where: { activo: true, usuario: { discordId: { in: destinatarios } } },
    select: { id: true },
  })
  if (!personajes.length) return i.reply({ content: 'Los destinatarios no tienen personajes activos.', flags: efimero })
  const valor = BigInt(monto)
  const actor = await asegurarUsuario(i.user)
  await db.$transaction(async (tx) => {
    await tx.personaje.updateMany({ where: { id: { in: personajes.map((p) => p.id) }, activo: true }, data: { dinero: { increment: valor } } })
    await tx.movimientoEconomia.createMany({ data: personajes.map((p) => ({
      personajeId: p.id,
      tipo: 'STAFF_AGREGAR',
      monto: valor,
      descripcion: `Otorgado por ${i.user.id} (${actor.id})`,
    })) })
  })
  return i.reply({ content: `Se entregaron ${formatearMoneda(monto)} a ${personajes.length} personaje(s).`, flags: efimero })
}

async function ejecutarAgregarOwner(i: ChatInputCommandInteraction, accion: string) {
  if (!i.inCachedGuild() || i.guild.ownerId !== i.user.id) return i.reply({ content: 'Esta acción está reservada al propietario del servidor.', flags: efimero })
  if (accion === 'categoria') {
    const nombre = i.options.getString('nombre', true).trim()
    const categorias = await leerCategorias()
    if (categorias.some((x) => x.toLowerCase() === nombre.toLowerCase())) return i.reply({ content: 'Esa categoría ya existe.', flags: efimero })
    categorias.push(nombre)
    await guardarCategorias(categorias)
    return i.reply({ content: `Categoría **${nombre}** agregada.`, flags: efimero })
  }
  if (accion === 'empresas') {
    try {
      const empresa = await db.institucion.create({ data: {
        nombre: i.options.getString('nombre', true).trim(),
        slug: i.options.getString('slug', true).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        tipo: i.options.getString('tipo', true) as 'GOBIERNO' | 'MUNICIPAL' | 'JUDICIAL' | 'FISCALIA' | 'DEFENSORIA' | 'POLICIAL' | 'SALUD' | 'BANCARIA' | 'OTRA',
        descripcion: i.options.getString('descripcion')?.trim() || null,
      } })
      return i.reply({ content: `Empresa **${empresa.nombre}** creada.`, flags: efimero })
    } catch (error) {
      if (esErrorUnico(error)) return i.reply({ content: 'Ya existe una empresa con ese nombre o identificador.', flags: efimero })
      throw error
    }
  }

  const tipo = accion as 'administrador' | 'moderador' | 'soporte'
  const variable = tipo === 'administrador' ? 'ROL_ADMIN_ID' : tipo === 'moderador' ? 'ROL_MODERADOR_ID' : 'ROL_SOPORTE_ID'
  const rolId = process.env[variable]
  if (!rolId) return i.reply({ content: `Configura ${variable} desde /config rol.`, flags: efimero })
  const usuario = i.options.getUser('usuario', true)
  const miembro = await i.guild.members.fetch(usuario.id).catch(() => null)
  if (!miembro) return i.reply({ content: 'El usuario no es miembro del servidor.', flags: efimero })
  await miembro.roles.add(rolId, `Agregado por el propietario ${i.user.tag}`)
  const usuarioDb = await asegurarUsuario(usuario)
  await db.usuario.update({ where: { id: usuarioDb.id }, data: { rol: tipo === 'administrador' ? RolPlataforma.ADMIN : RolPlataforma.STAFF } })
  return i.reply({ content: `${usuario.tag} agregado como ${tipo}.`, flags: efimero })
}

async function leerCategorias(): Promise<string[]> {
  const fila = await db.configuracionServidor.findUnique({ where: { clave: 'owner.categorias' } })
  return Array.isArray(fila?.valor) ? fila.valor.filter((x): x is string => typeof x === 'string') : []
}

async function guardarCategorias(categorias: string[]) {
  await db.configuracionServidor.upsert({
    where: { clave: 'owner.categorias' },
    create: { clave: 'owner.categorias', valor: categorias },
    update: { valor: categorias },
  })
}

function esErrorUnico(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function limitePorRango(i: ChatInputCommandInteraction) {
  if (i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return limiteEnv('LIMITE_DINERO_ADMIN', 1_000_000)
  if (!i.inCachedGuild()) return 0
  if (process.env.ROL_ADMIN_ID && i.member.roles.cache.has(process.env.ROL_ADMIN_ID)) return limiteEnv('LIMITE_DINERO_ADMIN', 1_000_000)
  if (process.env.ROL_MODERADOR_ID && i.member.roles.cache.has(process.env.ROL_MODERADOR_ID)) return limiteEnv('LIMITE_DINERO_MODERADOR', 250_000)
  if (process.env.ROL_SOPORTE_ID && i.member.roles.cache.has(process.env.ROL_SOPORTE_ID)) return limiteEnv('LIMITE_DINERO_SOPORTE', 50_000)
  if (process.env.ROL_STAFF_ID && i.member.roles.cache.has(process.env.ROL_STAFF_ID)) return limiteEnv('LIMITE_DINERO_SOPORTE', 50_000)
  return 0
}

function limiteEnv(clave: string, defecto: number) {
  const valor = Number(process.env[clave])
  return Number.isSafeInteger(valor) && valor > 0 ? valor : defecto
}