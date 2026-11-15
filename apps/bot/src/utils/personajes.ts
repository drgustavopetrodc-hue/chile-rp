import type { User } from 'discord.js'
import { db } from '@rp-chile/db'
import { generarNumeroSerie, generarRut } from './rut'
import { asegurarUsuario } from './usuarios'

export async function crearPersonaje(user: User, nombres: string, apellidos: string, fechaNacimiento: Date, robloxUsername: string) {
  const usuario = await asegurarUsuario(user)
  let rut = generarRut()
  while (await db.personaje.findUnique({ where: { rut } })) rut = generarRut()
  let numeroSerie = generarNumeroSerie()
  while (await db.cedula.findUnique({ where: { numeroSerie } })) numeroSerie = generarNumeroSerie()
  const venceEn = new Date()
  venceEn.setFullYear(venceEn.getFullYear() + 5)

  return db.personaje.create({
    data: {
      usuarioId: usuario.id,
      nombres: nombres.trim(),
      apellidos: apellidos.trim(),
      rut,
      fechaNacimiento,
      cedula: { create: { numeroSerie, venceEn, robloxUsername } },
    },
    include: { cedula: true },
  })
}