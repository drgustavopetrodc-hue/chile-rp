import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js'
import { db } from '@rp-chile/db'
import { formatearMoneda } from '../utils/moneda'

const efimero = MessageFlags.Ephemeral
const plata = formatearMoneda

export const casinoData = new SlashCommandBuilder()
  .setName('casino')
  .setDescription('Juegos de azar con dinero del personaje')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('tragamonedas').setDescription('Prueba suerte en las tragamonedas')
    .addIntegerOption((o) => o.setName('apuesta').setDescription('Apuesta en pesos').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('ruleta').setDescription('Apuesta a rojo o negro')
    .addStringOption((o) => o.setName('color').setDescription('Color elegido').setRequired(true)
      .addChoices({ name: 'Rojo', value: 'rojo' }, { name: 'Negro', value: 'negro' }))
    .addIntegerOption((o) => o.setName('apuesta').setDescription('Apuesta en pesos').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('dados').setDescription('Apuesta al resultado de un dado')
    .addIntegerOption((o) => o.setName('numero').setDescription('Número elegido, del 1 al 6').setRequired(true).setMinValue(1).setMaxValue(6))
    .addIntegerOption((o) => o.setName('apuesta').setDescription('Apuesta en pesos').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('moneda').setDescription('Apuesta a cara o cruz')
    .addStringOption((o) => o.setName('lado').setDescription('Lado elegido').setRequired(true)
      .addChoices({ name: 'Cara', value: 'cara' }, { name: 'Cruz', value: 'cruz' }))
    .addIntegerOption((o) => o.setName('apuesta').setDescription('Apuesta en pesos').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))

export const casino = { data: casinoData, execute: ejecutarCasino }

async function ejecutarCasino(i: ChatInputCommandInteraction) {
  const personaje = await db.personaje.findFirst({
    where: { activo: true, usuario: { discordId: i.user.id } },
    orderBy: { creadoEn: 'asc' },
  })
  if (!personaje) return i.reply({ content: 'Necesitas un personaje activo.', flags: efimero })

  const juego = i.options.getSubcommand()
  const monto = BigInt(i.options.getInteger('apuesta', true))
  let detalle: string
  let premio = 0n

  if (juego === 'tragamonedas') {
    const simbolos = ['🍒', '🍋', '🔔', '⭐', '7️⃣']
    const resultado = Array.from({ length: 3 }, () => simbolos[Math.floor(Math.random() * simbolos.length)])
    const iguales = resultado[0] === resultado[1] && resultado[1] === resultado[2]
    const pareja = resultado[0] === resultado[1] || resultado[0] === resultado[2] || resultado[1] === resultado[2]
    premio = iguales ? monto * 5n : pareja ? monto * 2n : 0n
    detalle = `${resultado.join(' ')}\n${iguales ? '¡Trío! Premio de' : pareja ? 'Pareja. Premio de' : 'Sin combinación. Perdiste'}${premio ? ` ${plata(premio)}.` : '.'}`
  } else if (juego === 'ruleta') {
    const numero = Math.floor(Math.random() * 37)
    const color = numero === 0 ? 'verde' : numero % 2 === 0 ? 'negro' : 'rojo'
    const elegido = i.options.getString('color', true)
    premio = color === elegido ? monto * 2n : 0n
    detalle = `Salió **${numero} ${color}**. ${premio ? `Ganaste ${plata(premio)}.` : `Perdiste ${plata(monto)}.`}`
  } else if (juego === 'dados') {
    const numero = Math.floor(Math.random() * 6) + 1
    const elegido = i.options.getInteger('numero', true)
    premio = numero === elegido ? monto * 5n : 0n
    detalle = `El dado marcó **${numero}**. ${premio ? `Ganaste ${plata(premio)}.` : `Perdiste ${plata(monto)}.`}`
  } else {
    const lado = Math.random() < 0.5 ? 'cara' : 'cruz'
    const elegido = i.options.getString('lado', true)
    premio = lado === elegido ? monto * 2n : 0n
    detalle = `Salió **${lado}**. ${premio ? `Ganaste ${plata(premio)}.` : `Perdiste ${plata(monto)}.`}`
  }

  const jugada = await db.$transaction(async (tx) => {
    const debitado = await tx.personaje.updateMany({
      where: { id: personaje.id, dinero: { gte: monto } },
      data: { dinero: { decrement: monto } },
    })
    if (!debitado.count) return false
    if (premio > 0n) await tx.personaje.update({ where: { id: personaje.id }, data: { dinero: { increment: premio } } })
    await tx.movimientoEconomia.createMany({ data: [
      { personajeId: personaje.id, tipo: `CASINO_${juego.toUpperCase()}_APUESTA`, monto, descripcion: juego },
      ...(premio > 0n ? [{ personajeId: personaje.id, tipo: `CASINO_${juego.toUpperCase()}_PREMIO`, monto: premio, descripcion: juego }] : []),
    ] })
    return true
  })

  if (!jugada) return i.reply({ content: 'No tienes efectivo suficiente para esa apuesta.', flags: efimero })
  return i.reply({ content: `**${juego.charAt(0).toUpperCase()}${juego.slice(1)}** · Apostaste ${plata(monto)}\n${detalle}`, flags: efimero })
}