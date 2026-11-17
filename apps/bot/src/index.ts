import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js'
import { config } from './config'
import { comandos } from './commands'
import { manejarBoton, manejarModal } from './handlers/verificacion'
import { manejarMencionIA } from './commands/ia'
import { manejarConfirmacionAdministrativa } from './commands/ia-administracion'
import { asegurarUsuario } from './utils/usuarios'
import { enviarBienvenida } from './commands/bienvenida'
import { manejarBotonTicket, manejarMensajeTicket, manejarModalTicket } from './commands/comunidad'
import { cargarConfiguracionServidor, configuracion, usuarioPuedeUsarComando } from './commands/configuracion'
import { cargarAutoReaccion, manejarAutoReaccion } from './commands/owner'
import { adaptarInteraccionAComponentsV2 } from './utils/components-v2'
import { esComandoPrivilegiado, registrarComandoPrivilegiado } from './utils/auditoria-comandos'
import type { ChatInputCommandInteraction } from 'discord.js'

const client = new Client({
  // GuildMembers es un intent privilegiado: actívalo en el Developer Portal > Bot.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
})

const mapaComandos = new Map(comandos.map((c) => [c.data.name, c]))

client.once(Events.ClientReady, async (c) => {
  await cargarConfiguracionServidor().catch((err) => console.error('No se pudo cargar la configuración del servidor:', err))
  await cargarAutoReaccion().catch((err) => console.error('No se pudo cargar la auto-reacción:', err))
  console.log(`Bot conectado como ${c.user.tag}`)
})

client.on(Events.MessageCreate, (mensaje) => {
  void manejarAutoReaccion(mensaje)
  if (mensaje.author.bot) return
  void (async () => {
    if (await manejarMensajeTicket(mensaje)) return
    if (!client.user || !mensaje.mentions.has(client.user)) return
    if (!await usuarioPuedeUsarComando('ia', mensaje.author.id)) {
      await mensaje.reply({
        content: 'Debes completar la verificación antes de usar este comando.',
        allowedMentions: { repliedUser: false },
      })
      return
    }
    await manejarMencionIA(mensaje)
  })().catch((err) => console.error('No se pudo responder a la mención de la IA:', err))
})

// Al entrar al servidor: se registra el usuario y se le da el rol "No verificado".
client.on(Events.GuildMemberAdd, async (miembro) => {
  if (miembro.user.bot) return
  try {
    await asegurarUsuario(miembro.user)
    await miembro.roles.add(config.roles.noVerificado)
  } catch (err) {
    console.error('No se pudo registrar al nuevo miembro o asignar el rol inicial:', err)
  }
  await enviarBienvenida(miembro)
})

client.on(Events.InteractionCreate, async (i) => {
  adaptarInteraccionAComponentsV2(i)
  let comandoAuditado: ChatInputCommandInteraction | undefined
  try {
    if (i.isChatInputCommand()) {
      comandoAuditado = esComandoPrivilegiado(i) ? i : undefined
      if (!await usuarioPuedeUsarComando(i.commandName, i.user.id)) {
        await i.reply({ content: 'Debes completar la verificación antes de usar este comando.', flags: MessageFlags.Ephemeral })
        if (comandoAuditado) await registrarComandoPrivilegiado(comandoAuditado, 'procesado')
        comandoAuditado = undefined
        return
      }
      await mapaComandos.get(i.commandName)?.execute(i)
      if (comandoAuditado) await registrarComandoPrivilegiado(comandoAuditado, 'procesado')
      comandoAuditado = undefined
    } else if (i.isButton() && i.customId.startsWith('ticketpanel:')) {
      await manejarBotonTicket(i)
    } else if (i.isButton() && i.customId.startsWith('ia-admin:')) {
      await manejarConfirmacionAdministrativa(i)
    } else if (i.isModalSubmit() && i.customId.startsWith('ticketpanel:')) {
      await manejarModalTicket(i)
    } else if (i.isButton() && i.customId.startsWith('verif:')) {
      await manejarBoton(i)
    } else if (i.isModalSubmit() && i.customId.startsWith('verif:')) {
      await manejarModal(i)
    }
  } catch (err) {
    console.error(err)
    if (comandoAuditado) await registrarComandoPrivilegiado(comandoAuditado, 'error', err).catch(console.error)
    if (i.isRepliable()) {
      const aviso = { content: 'Ocurrió un error. Avisa al staff.', flags: MessageFlags.Ephemeral } as const
      if (i.replied || i.deferred) await i.followUp(aviso).catch(() => {})
      else await i.reply(aviso).catch(() => {})
    }
  }
})

client.login(config.token)
