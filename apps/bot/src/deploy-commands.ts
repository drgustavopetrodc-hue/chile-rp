import { REST, Routes } from 'discord.js'
import { config } from './config'
import { comandos } from './commands'

// Ejecutar una vez (y cada vez que cambies los comandos): npm run deploy-commands
async function main() {
  const rest = new REST().setToken(config.token)
  await rest.put(Routes.applicationCommands(config.clientId), { body: [] })
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: comandos.map((c) => c.data.toJSON()),
  })
  console.log(`Comandos globales antiguos eliminados; registrados ${comandos.length} comandos en el servidor.`)
}

main().catch(console.error)
