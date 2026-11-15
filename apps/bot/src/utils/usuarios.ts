import type { User } from 'discord.js'
import { db } from '@rp-chile/db'

// Crea o actualiza el registro de un usuario de Discord en la base de datos.
export function asegurarUsuario(user: User) {
  const datos = { username: user.username, avatar: user.avatar }
  return db.usuario.upsert({
    where: { discordId: user.id },
    update: datos,
    create: { discordId: user.id, ...datos },
  })
}
