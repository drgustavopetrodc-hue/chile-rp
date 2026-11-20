import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js'
import { config } from './config'
import { comandos } from './commands'
import { manejarBoton, manejarModal } from './handlers/verificacion'
import { instalarProteccionAntiRaid } from './handlers/anti-raid'
import { manejarMencionIA } from './commands/ia'
import { manejarConfirmacionAdministrativa } from './commands/ia-administracion'
import { asegurarUsuario } from './utils/usuarios'
import { enviarBienvenida } from './commands/bienvenida'
import { manejarBotonTicket, manejarMensajeTicket, manejarModalTicket } from './commands/comunidad'
import { manejarEstadoVozGrabacionDirecta } from './commands/grabacion-directa'
import {
  inicializarServiciosStaff,
  manejarEstadoVozServicioStaff,
  manejarInteraccionServicioStaff,
} from './commands/servicio-staff'
import {
  inicializarGrabacionesSoporte,
  manejarEstadoVozSoporte,
  manejarInteraccionSoporte,
} from './commands/soporte'
import { cargarConfiguracionServidor, configuracion, usuarioPuedeUsarComando } from './commands/configuracion'
import { cargarAutoReaccion, manejarAutoReaccion } from './commands/owner'
import { adaptarInteraccionAComponentsV2 } from './utils/components-v2'
import { esComandoPrivilegiado, registrarComandoPrivilegiado } from './utils/auditoria-comandos'
import type { ChatInputCommandInteraction } from 'discord.js'

const client = new Client({
  // GuildMembers es un intent privilegiado: actívalo en el Developer Portal > Bot.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
})

instalarProteccionAntiRaid(client)

const mapaComandos = new Map(comandos.map((c) => [c.data.name, c]))

client.once(Events.ClientReady, async (c) => {
  await cargarConfiguracionServidor().catch((err) => console.error('No se pudo cargar la configuración del servidor:', err))
  await cargarAutoReaccion().catch((err) => console.error('No se pudo cargar la auto-reacción:', err))
  await inicializarGrabacionesSoporte(client).catch((err) =>
    console.error('No se pudo inicializar la retención de grabaciones de soporte:', err),
  )
  await inicializarServiciosStaff(client).catch((err) =>
    console.error('No se pudieron recuperar los servicios Staff:', err),
  )
  console.log(`Bot conectado como ${c.user.tag}`)
})

client.on(Events.VoiceStateUpdate, (anterior, nuevo) => {
  void manejarEstadoVozSoporte(anterior, nuevo).catch((error: unknown) => {
    console.error('No se pudo actualizar el consentimiento de voz de un soporte:', error)
  })
  void manejarEstadoVozGrabacionDirecta(anterior, nuevo).catch((error: unknown) => {
    console.error('No se pudo avisar o añadir a un participante de una grabación directa:', error)
  })
  void manejarEstadoVozServicioStaff(anterior, nuevo).catch((error: unknown) => {
    console.error('No se pudo actualizar el servicio Staff tras un cambio de voz:', error)
  })
})

client.on(Events.MessageCreate, (mensaje) => {
  if (mensaje.author.bot) return
  if (mensaje.mentions.everyone && /@everyone\b/i.test(mensaje.content)) return
  void manejarAutoReaccion(mensaje)
  void (async () => {
    if (await manejarMensajeTicket(mensaje)) return
    if (!client.user || !mensaje.mentions.users.has(client.user.id)) return
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
    } else if (
      (i.isButton() || i.isModalSubmit()) &&
      i.customId.startsWith('servicio-staff:')
    ) {
      await manejarInteraccionServicioStaff(i)
    } else if (i.isModalSubmit() && i.customId.startsWith('ticketpanel:')) {
      await manejarModalTicket(i)
    } else if (
      (i.isButton() || i.isUserSelectMenu() || i.isRoleSelectMenu()) &&
      i.customId.startsWith('soporte:')
    ) {
      await manejarInteraccionSoporte(i)
    } else if (i.isButton() && i.customId.startsWith('verif:')) {
      await manejarBoton(i)
    } else if (i.isModalSubmit() && i.customId.startsWith('verif:')) {
      await manejarModal(i)
    }
  } catch (err) {
    console.error(err)
    if (comandoAuditado) await registrarComandoPrivilegiado(comandoAuditado, 'error', err).catch(console.error)
    const codigoDiscord = typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: number }).code
      : undefined
    if (codigoDiscord === 10003 || codigoDiscord === 10008 || codigoDiscord === 10062) {
      return
    }
    if (i.isRepliable()) {
      const aviso = { content: 'Ocurrió un error. Avisa al staff.', flags: MessageFlags.Ephemeral } as const
      if (i.replied || i.deferred) await i.followUp(aviso).catch(() => {})
      else await i.reply(aviso).catch(() => {})
    }
  }
})

client.login(config.token)
