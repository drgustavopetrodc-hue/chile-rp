import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import * as panelVerificacion from './panel-verificacion'
import * as cedula from './cedula'
import * as crearDni2do from './crear-dni-2do'
import { legales } from './legal'
import { moderacion } from './moderacion'
import { comunidad } from './comunidad'
import { economia } from './economia'
import { casino } from './casino'
import { vehiculos } from './vehiculos'
import { item } from './items'
import { sueldo } from './sueldos'
import { instituciones } from './instituciones'
import { servidor } from './servidor'
import { staff } from './staff'
import { contenido } from './contenido'
import { agregarDinero } from './agregar-dinero'
import { bienvenida } from './bienvenida'
import * as verificacion from './verificacion'
import { configuracion as comandosConfiguracion } from './configuracion'
import { owner } from './owner'
import { ownerManagement } from './owner-manage'
import { codigoPenal } from './codigo-penal'

interface Comando {
  data: Pick<SlashCommandBuilder, 'name' | 'toJSON'>
  execute: (i: ChatInputCommandInteraction) => Promise<unknown>
}

export const comandos: Comando[] = [panelVerificacion, verificacion, cedula, crearDni2do, ...legales, ...moderacion, ...comunidad, ...economia, casino, ...vehiculos, item, sueldo, ...instituciones, ...servidor, staff, contenido, agregarDinero, bienvenida, ...comandosConfiguracion, ...owner, ...ownerManagement, codigoPenal]
