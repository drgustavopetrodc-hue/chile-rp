import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js'
import { config } from './config'
import { comandos } from './commands'
import { manejarBoton, manejarModal } from './handlers/verificacion'
import { asegurarUsuario } from './utils/usuarios'

const client = new Client({
  // GuildMembers es un intent privilegiado: actívalo en el Developer Portal > Bot.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
})

const mapaComandos = new Map(comandos.map((c) => [c.data.name, c]))

client.once(Events.ClientReady, (c) => {
  console.log(`Bot conectado como ${c.user.tag}`)
})

// Al entrar al servidor: se registra el usuario y se le da el rol "No verificado".
client.on(Events.GuildMemberAdd, async (miembro) => {
  if (miembro.user.bot) return
  try {
    await asegurarUsuario(miembro.user)
    await miembro.roles.add(config.roles.noVerificado)
  } catch (err) {
    console.error('Error al recibir a un nuevo miembro:', err)
  }
})

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      await mapaComandos.get(i.commandName)?.execute(i)
    } else if (i.isButton() && i.customId.startsWith('verif:')) {
      await manejarBoton(i)
    } else if (i.isModalSubmit() && i.customId.startsWith('verif:')) {
      await manejarModal(i)
    }
  } catch (err) {
    console.error(err)
    if (i.isRepliable()) {
      const aviso = { content: 'Ocurrió un error. Avisa al staff.', flags: MessageFlags.Ephemeral } as const
      if (i.replied || i.deferred) await i.followUp(aviso).catch(() => {})
      else await i.reply(aviso).catch(() => {})
    }
  }
})

client.login(config.token)
