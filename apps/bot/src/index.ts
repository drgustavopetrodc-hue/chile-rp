import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js'
import { config } from './config'
import { comandos } from './commands'
import { manejarBoton, manejarModal } from './handlers/verificacion'
import { asegurarUsuario } from './utils/usuarios'
import { enviarBienvenida } from './commands/bienvenida'
import { manejarBotonTicket, manejarModalTicket } from './commands/comunidad'
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
})

// Al entrar al servidor: se registra el usuario y se le da el rol "No verificado".
client.on(Events.GuildMemberAdd, async (miembro) => {
  if (miembro.user.bot) return
  try {
    await asegurarUsuario(miembro.user)
    await miembro.roles.add(config.roles.noVerificado)
    await enviarBienvenida(miembro)
  } catch (err) {
    console.error('Error al recibir a un nuevo miembro:', err)
  }
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
