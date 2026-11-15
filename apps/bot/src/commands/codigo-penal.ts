import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js'
import { ArticuloPenal, CODIGO_PENAL, codigoPenalPorTitulo } from '../data/codigo-penal'
import { crearEmbed } from '../utils/embeds'

const efimero = MessageFlags.Ephemeral
const titulos = codigoPenalPorTitulo()

export const codigoPenalData = new SlashCommandBuilder()
  .setName('codigo-penal')
  .setDescription('Consulta el Código Penal del sistema judicial RP')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('buscar').setDescription('Busca delitos por nombre o palabra')
    .addStringOption((o) => o.setName('termino').setDescription('Término de búsqueda').setRequired(true).setMaxLength(80)))
  .addSubcommand((s) => s.setName('ver').setDescription('Consulta un artículo penal')
    .addStringOption((o) => o.setName('articulo').setDescription('Número de artículo, por ejemplo 46.1').setRequired(true).setMaxLength(10)))
  .addSubcommand((s) => s.setName('listar').setDescription('Lista los artículos de un título')
    .addStringOption((o) => o.setName('titulo').setDescription('Título del Código Penal').setRequired(true)
      .addChoices(...titulos.map((grupo, index) => ({ name: grupo.titulo.slice(0, 100), value: String(index) })))) )

export const codigoPenal = { data: codigoPenalData, execute: ejecutarCodigoPenal }

async function ejecutarCodigoPenal(i: ChatInputCommandInteraction) {
  const accion = i.options.getSubcommand()
  if (accion === 'ver') {
    const numero = Number(i.options.getString('articulo', true))
    if (!Number.isFinite(numero)) return i.reply({ content: 'Número de artículo inválido. Ejemplo: `46.1`.', flags: efimero })
    const articulo = CODIGO_PENAL.find((item) => item.numero === numero)
    if (!articulo) return i.reply({ content: 'No se encontró ese artículo.', flags: efimero })
    return i.reply({ embeds: [embedArticulo(articulo)], flags: efimero })
  }

  if (accion === 'listar') {
    const index = Number(i.options.getString('titulo', true))
    const grupo = titulos[index]
    if (!grupo) return i.reply({ content: 'Título inválido.', flags: efimero })
    return i.reply({ embeds: [crearEmbed(grupo.titulo, `${grupo.articulos.length} artículos registrados.`)
      .addFields(grupo.articulos.map((articulo) => ({
        name: `Artículo ${articulo.numero} · ${articulo.delito}`.slice(0, 256),
        value: articulo.pena.slice(0, 1024),
      })))], flags: efimero })
  }

  const termino = normalizar(i.options.getString('termino', true))
  const resultados = CODIGO_PENAL.filter((articulo) =>
    normalizar(`${articulo.delito} ${articulo.titulo} ${articulo.numero}`).includes(termino),
  ).slice(0, 10)
  if (!resultados.length) return i.reply({ content: 'No encontré artículos que coincidan con ese término.', flags: efimero })
  return i.reply({
    embeds: [crearEmbed(`Resultados: ${i.options.getString('termino', true)}`, `Mostrando ${resultados.length} coincidencia(s).`)
      .addFields(resultados.map((articulo) => ({
        name: `Artículo ${articulo.numero} · ${articulo.delito}`.slice(0, 256),
        value: `**${articulo.titulo}**\n${articulo.pena}`.slice(0, 1024),
      })))],
    flags: efimero,
  })
}

function embedArticulo(articulo: ArticuloPenal) {
  return crearEmbed(`Artículo ${articulo.numero} · ${articulo.delito}`, articulo.titulo)
    .addFields({ name: 'Pena', value: articulo.pena })
}

function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}