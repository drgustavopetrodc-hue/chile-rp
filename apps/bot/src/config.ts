import 'dotenv/config'

const req = (clave: string): string => {
  const valor = process.env[clave]
  if (!valor) throw new Error(`Falta la variable de entorno ${clave}`)
  return valor
}

export const config = {
  token: req('DISCORD_TOKEN'),
  clientId: req('DISCORD_CLIENT_ID'),
  guildId: req('DISCORD_GUILD_ID'),
  roles: {
    staff: req('ROL_STAFF_ID'),
    noVerificado: req('ROL_NO_VERIFICADO_ID'),
    ciudadano: req('ROL_CIUDADANO_ID'),
  },
  canales: {
    revision: req('CANAL_REVISION_ID'),
  },
}
