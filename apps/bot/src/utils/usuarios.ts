import type { User } from 'discord.js'
import { crearOActualizarUsuario } from '@rp-chile/identity'

// Crea o actualiza el registro de un usuario de Discord en la base de datos.
export function asegurarUsuario(user: User) {
  return crearOActualizarUsuario({
    discordId: user.id,
    username: user.username,
    avatar: user.displayAvatarURL(),
  })
}
