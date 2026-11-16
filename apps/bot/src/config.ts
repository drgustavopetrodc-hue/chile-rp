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
    policia: process.env.ROL_POLICIA_ID,
    segundoPersonaje: process.env.ROL_SEGUNDO_PERSONAJE_ID,
    fundacion: process.env.ROL_FUNDACION_ID || '1571735707364626545',
    juntaAdministrativa: process.env.ROL_JUNTA_ADMINISTRATIVA_ID || '1571735714880557136',
    soporte: process.env.ROL_SOPORTE_ID || '1571735822879948870',
    moderador: process.env.ROL_MODERADOR_ID || '1571735735705403463',
    admin: process.env.ROL_ADMIN_ID,
  },
  canales: {
    revision: req('CANAL_REVISION_ID'),
    categoriaTickets: process.env.CATEGORIA_TICKETS_ID,
    casosModeracion: req('CANAL_CASOS_MODERACION_ID'),
    logModeracion: req('CANAL_LOG_MODERACION_ID'),
    logAdministracion: req('CANAL_LOG_ADMIN_ID'),
  },
}
