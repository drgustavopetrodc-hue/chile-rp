import { OpusEncoder } from '@discordjs/opus'
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice'
import type { AudioReceiveStream, VoiceConnection } from '@discordjs/voice'
import type { Guild, VoiceChannel } from 'discord.js'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join, resolve, sep, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'
import ffmpegPath from 'ffmpeg-static'

export type EstadoGrabacionSoporte =
  | 'ESPERANDO CONSENTIMIENTO'
  | 'GRABANDO'
  | 'PAUSADA'
  | 'FINALIZADA'
  | 'NO DISPONIBLE'
  | 'ERROR'

export type EstadoConsentimientoSoporte = 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'RETIRADO'

export interface ConsentimientoGrabacion {
  discordId: string
  estado: EstadoConsentimientoSoporte
  actualizadoEn: string
}

export interface ArchivoPistaGrabacion {
  discordId: string
  archivo: string
}

export interface AudioBotGrabacion {
  archivo: string
  inicioMs: number
}

export interface AudioBotMezcla {
  path: string
  inicioMs: number
}

export interface MensajeGrabacionLog {
  canalId: string
  mensajeId: string
}

export interface ManifiestoGrabacionSoporte {
  origenGrabacion?: 'soporte' | 'directa' | 'servicio-staff'
  soporteId: string
  guildId: string
  estado: EstadoGrabacionSoporte
  abiertoEn: string
  iniciadaEn: string | null
  finalizadaEn: string | null
  venceEn: string | null
  participantes: string[]
  consentimientos: ConsentimientoGrabacion[]
  mezcla: string | null
  pistas: ArchivoPistaGrabacion[]
  audiosBot?: AudioBotGrabacion[]
  mensajesLog: MensajeGrabacionLog[]
}

interface PistaActiva {
  discordId: string
  flujo: AudioReceiveStream
  decoder: OpusEncoder
}

interface CodificadorPista {
  discordId: string
  temporal: string
  final: string
  proceso: ChildProcess
  entrada: Writable
  salida: Promise<void>
  decoder: OpusEncoder
  cursorMuestras: number
  paquetes: number
  cola: Promise<void>
  error?: Error
}

const frecuencia = 48_000
const canales = 2
const bytesPorMuestra = canales * 2
const muestrasPorSegundo = frecuencia
const muestrasSilencio = frecuencia
const espacioMinimoBytes = 128 * 1024 * 1024
export const limitePistasGrabacion = 10
const duracionEsperaVozMs = 45_000

export function esErrorDAVE(error: Error): boolean {
  const detalle = `${error.name} ${error.message}`.toLowerCase()
  return detalle.includes('decryptionfailed') ||
    detalle.includes('failed to decrypt') ||
    detalle.includes('unencryptedwhenpassthroughdisabled')
}

export function esPaqueteOpusCorrupto(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const detalle = `${error.name} ${error.message}`.toLowerCase()
  return detalle.includes('compressed data passed is corrupted') ||
    detalle.includes('invalid packet')
}

function esperarReconexionVoz(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function planificarPaquetePcm(
  pcm: Buffer,
  cursorMuestras: number,
  muestraObjetivo: number,
): { muestrasSilencio: number; cursorSiguiente: number } {
  const muestrasPcm = pcm.length / bytesPorMuestra
  if (!Number.isInteger(muestrasPcm)) {
    throw new Error('El paquete PCM no contiene muestras completas.')
  }
  const muestrasSilencio = Math.max(0, muestraObjetivo - cursorMuestras)
  return {
    muestrasSilencio,
    cursorSiguiente: cursorMuestras + muestrasSilencio + muestrasPcm,
  }
}

export function crearConsentimientosPendientes(
  discordIds: readonly string[],
  ahora = new Date().toISOString(),
): ConsentimientoGrabacion[] {
  return [...new Set(discordIds)].map((discordId) => ({
    discordId,
    estado: 'PENDIENTE',
    actualizadoEn: ahora,
  }))
}

export function todosAceptaronConsentimiento(
  consentimientos: readonly ConsentimientoGrabacion[],
): boolean {
  return consentimientos.length > 0 &&
    consentimientos.every((consentimiento) => consentimiento.estado === 'ACEPTADO')
}

export function coincidenParticipantesGrabacion(
  esperados: readonly string[],
  actuales: readonly string[],
): boolean {
  if (esperados.length !== actuales.length) return false
  const ordenadosActuales = [...actuales].sort()
  return [...esperados].sort().every((discordId, indice) => discordId === ordenadosActuales[indice])
}

export function rutaDirectorioGrabacion(
  directorioRaiz: string | undefined,
  soporteId: string,
): string {
  if (!directorioRaiz || !isAbsolute(directorioRaiz)) {
    throw new Error('SOPORTE_GRABACIONES_DIR debe apuntar a un volumen persistente con una ruta absoluta.')
  }
  if (!/^[\da-f-]{36}$/i.test(soporteId)) {
    throw new Error('El identificador del soporte no es válido para almacenamiento.')
  }
  return join(resolve(directorioRaiz), soporteId)
}

export function estaDentroDeVolumenMontado(
  ruta: string,
  puntosMontaje: readonly string[],
): boolean {
  const destino = resolve(ruta)
  const montajes = puntosMontaje
    .map((punto) => resolve(punto))
    .filter((punto) => punto !== sep && (destino === punto || destino.startsWith(`${punto}${sep}`)))
  return montajes.length > 0
}

async function verificarVolumenPersistente(directorioRaiz: string): Promise<void> {
  if (process.platform !== 'linux') {
    throw new Error('Las grabaciones solo se habilitan en Linux cuando se puede verificar el volumen persistente.')
  }
  const mountInfo = await readFile('/proc/self/mountinfo', 'utf8')
  const puntosMontaje = mountInfo.split(/\r?\n/).flatMap((linea) => {
    const campos = linea.split(' ')
    const punto = campos[4]
    if (!punto) return []
    return [punto.replace(/\\(040|011|012|134)/g, (_coincidencia, codigo: string) => {
      if (codigo === '040') return ' '
      if (codigo === '011') return '\t'
      if (codigo === '012') return '\n'
      return '\\'
    })]
  })
  const puntoAprobado = resolve('/data')
  if (
    !puntosMontaje.some((punto) => resolve(punto) === puntoAprobado) ||
    !estaDentroDeVolumenMontado(directorioRaiz, [puntoAprobado])
  ) {
    throw new Error('El volumen persistente aprobado debe estar montado en /data; no se usará almacenamiento efímero.')
  }
}

export async function leerManifiestoGrabacion(
  directorioRaiz: string,
  soporteId: string,
): Promise<ManifiestoGrabacionSoporte | undefined> {
  try {
    const ruta = join(rutaDirectorioGrabacion(directorioRaiz, soporteId), 'manifiesto.json')
    const valor: unknown = JSON.parse(await readFile(ruta, 'utf8'))
    if (!esManifiestoGrabacion(valor)) {
      throw new Error(`El manifiesto de grabación ${soporteId} no tiene un formato válido.`)
    }
    return valor
  } catch (error) {
    if (esErrorSistema(error, 'ENOENT')) return undefined
    throw error
  }
}

export async function guardarManifiestoGrabacion(
  directorioRaiz: string,
  manifiesto: ManifiestoGrabacionSoporte,
): Promise<void> {
  const directorio = rutaDirectorioGrabacion(directorioRaiz, manifiesto.soporteId)
  await mkdir(directorio, { recursive: true, mode: 0o700 })
  const temporal = join(directorio, `manifiesto-${randomUUID()}.tmp`)
  const destino = join(directorio, 'manifiesto.json')
  const archivo = await open(temporal, 'wx', 0o600)
  try {
    await archivo.writeFile(`${JSON.stringify(manifiesto, null, 2)}\n`, 'utf8')
    await archivo.sync()
  } finally {
    await archivo.close()
  }
  await rename(temporal, destino)
}

export async function prepararDirectorioGrabacion(
  directorioRaiz: string | undefined,
  soporteId: string,
): Promise<string> {
  if (!ffmpegPath) throw new Error('No se encontró el ejecutable de FFmpeg instalado con el bot.')
  if (!directorioRaiz) {
    throw new Error('SOPORTE_GRABACIONES_DIR debe apuntar a un volumen persistente con una ruta absoluta.')
  }
  const directorio = rutaDirectorioGrabacion(directorioRaiz, soporteId)
  await verificarVolumenPersistente(resolve(directorioRaiz))
  await mkdir(directorio, { recursive: true, mode: 0o700 })
  const espacio = await statfs(directorio)
  const disponible = Number(espacio.bavail) * Number(espacio.bsize)
  if (disponible < espacioMinimoBytes) {
    throw new Error('El volumen de grabaciones no tiene los 128 MiB libres necesarios para iniciar.')
  }
  const prueba = join(directorio, `.prueba-${randomUUID()}`)
  const archivo = await open(prueba, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
  try {
    await archivo.writeFile('verificacion de almacenamiento')
    await archivo.sync()
  } finally {
    await archivo.close()
    await rm(prueba, { force: true })
  }
  return directorio
}

export class GrabadorSoporte {
  readonly directorio: string
  readonly manifiesto: ManifiestoGrabacionSoporte
  conexion: VoiceConnection
  private readonly flujoPorUsuario = new Map<string, PistaActiva>()
  private readonly pistaPorUsuario = new Map<string, CodificadorPista>()
  private readonly operacionesAudioBot = new Set<Promise<void>>()
  private readonly conexionError: (error: Error) => void
  private readonly primerPaquete: (discordId: string) => void | Promise<void>
  private readonly retencionDiasConfigurada: number
  private readonly guild: Guild
  private readonly canalVoz: VoiceChannel
  private inicioMonotono: number | undefined
  private capturaActiva = false
  private finalizando = false
  private ultimoChequeoEspacio = 0
  private reconexionPromise: Promise<void> | undefined
  private ultimoIntentoReconexion = 0
  private ultimoAvisoOpusCorrupto = 0

  private constructor(
    directorio: string,
    manifiesto: ManifiestoGrabacionSoporte,
    conexion: VoiceConnection,
    retencionDias: number,
    conexionError: (error: Error) => void,
    primerPaquete: (discordId: string) => void | Promise<void>,
    guild: Guild,
    canalVoz: VoiceChannel,
  ) {
    this.directorio = directorio
    this.manifiesto = manifiesto
    this.conexion = conexion
    this.retencionDiasConfigurada = retencionDias
    this.conexionError = conexionError
    this.primerPaquete = primerPaquete
    this.guild = guild
    this.canalVoz = canalVoz
    this.instalarEscuchaConexion()
  }

  private instalarEscuchaConexion(): void {
    this.conexion.on('error', (error) => {
      if (this.finalizando) return
      if (esErrorDAVE(error)) {
        console.warn(
          `[Soporte ${this.manifiesto.soporteId}] El parche DAVE está recuperando el descifrado; no se recreará la conexión.`,
        )
        return
      }
      this.conexionError(error)
    })
    this.conexion.on('stateChange', (_anterior, siguiente) => {
      if (
        this.finalizando ||
        siguiente.status !== VoiceConnectionStatus.Disconnected
      ) return
      void this.reconectarDespuesDeErrorVoz(
        new Error('El bot perdió la conexión con el canal de voz del soporte.'),
      )
    })
  }

  private reconectarDespuesDeErrorVoz(error: Error): Promise<void> {
    if (this.reconexionPromise) return this.reconexionPromise
    const ahora = Date.now()
    if (ahora - this.ultimoIntentoReconexion < 30_000) {
      return Promise.resolve()
    }
    this.ultimoIntentoReconexion = ahora
    this.reconexionPromise = (async () => {
      const debiaCapturar = this.capturaActiva
      try {
        await esperarReconexionVoz(750)
        if (this.finalizando) return
        if (this.conexion.state.status === VoiceConnectionStatus.Ready) return
        if (this.conexion.state.status === VoiceConnectionStatus.Destroyed) {
          this.conexion = joinVoiceChannel({
            channelId: this.canalVoz.id,
            guildId: this.guild.id,
            adapterCreator: this.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
          })
          this.instalarEscuchaConexion()
        } else {
          const rejoin = this.conexion.rejoin({
            channelId: this.canalVoz.id,
            selfDeaf: false,
            selfMute: false,
          })
          if (!rejoin) throw new Error('La conexión de voz no admitió reingresar al canal.')
        }
        await entersState(this.conexion, VoiceConnectionStatus.Ready, duracionEsperaVozMs)
        this.limpiarFlujos()
        this.capturaActiva = debiaCapturar
        if (debiaCapturar) {
          await this.suscribir(this.manifiesto.participantes)
        }
        console.info(`[Soporte ${this.manifiesto.soporteId}] Reconexión de voz completada.`)
      } catch (errorReconexion) {
        console.warn(`[Soporte ${this.manifiesto.soporteId}] No se pudo reconectar la voz:`, errorReconexion)
        this.capturaActiva = false
        this.limpiarFlujos()
        this.conexionError(error)
      }
    })().finally(() => {
      this.reconexionPromise = undefined
    })
    return this.reconexionPromise
  }

  get estaCapturando(): boolean {
    return this.capturaActiva && !this.finalizando
  }

  static async conectar(
    guild: Guild,
    canalVoz: VoiceChannel,
    directorioRaiz: string | undefined,
    retencionDias: number,
    soporteId: string,
    participantes: readonly string[],
    consentimientos: ConsentimientoGrabacion[],
    callbacks: {
      conexionError: (error: Error) => void
      primerPaquete: (discordId: string) => void | Promise<void>
    },
    origenGrabacion: 'soporte' | 'directa' | 'servicio-staff' = 'soporte',
  ): Promise<GrabadorSoporte> {
    if (!Number.isInteger(retencionDias) || retencionDias < 1 || retencionDias > 3650) {
      throw new Error('SOPORTE_RETENCION_DIAS debe ser un entero entre 1 y 3650.')
    }
    const directorio = await prepararDirectorioGrabacion(directorioRaiz, soporteId)

    const conexion = joinVoiceChannel({
      channelId: canalVoz.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      // El bot necesita poder emitir los anuncios TTS; no transmite audio salvo durante su reproducción.
      selfMute: false,
    })
    try {
      await entersState(conexion, VoiceConnectionStatus.Ready, duracionEsperaVozMs)
    } catch (error) {
      conexion.destroy()
      throw new Error('El bot no pudo conectarse al canal de voz del soporte.', { cause: error })
    }

    const manifiesto: ManifiestoGrabacionSoporte = {
      origenGrabacion,
      soporteId,
      guildId: guild.id,
      estado: 'ESPERANDO CONSENTIMIENTO',
      abiertoEn: new Date().toISOString(),
      iniciadaEn: null,
      finalizadaEn: null,
      venceEn: null,
      participantes: [...new Set(participantes)],
      consentimientos,
      mezcla: null,
      pistas: [],
      audiosBot: [],
      mensajesLog: [],
    }
    const grabador = new GrabadorSoporte(
      directorio,
      manifiesto,
      conexion,
      retencionDias,
      callbacks.conexionError,
      callbacks.primerPaquete,
      guild,
      canalVoz,
    )
    try {
      await guardarManifiestoGrabacion(resolve(directorio, '..'), manifiesto)
      return grabador
    } catch (error) {
      conexion.destroy()
      await rm(directorio, { recursive: true, force: true }).catch((errorLimpieza: unknown) => {
        console.error(`[Soporte ${soporteId}] No se pudo limpiar el manifiesto inicial:`, errorLimpieza)
      })
      throw error
    }
  }

  async actualizarConsentimientos(consentimientos: ConsentimientoGrabacion[]): Promise<void> {
    this.manifiesto.consentimientos = consentimientos
    this.manifiesto.participantes = [...new Set([
      ...this.manifiesto.participantes,
      ...consentimientos.map((consentimiento) => consentimiento.discordId),
    ])]
    await guardarManifiestoGrabacion(
      resolve(this.directorio, '..'),
      this.manifiesto,
    )
  }

  async actualizarEstado(estado: EstadoGrabacionSoporte): Promise<void> {
    this.manifiesto.estado = estado
    await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
  }

  async registrarAudioBot(rutaFuente: string, inicioMonotono: number): Promise<void> {
    const inicioGrabacion = this.inicioMonotono
    if (!this.estaCapturando || inicioGrabacion === undefined) return
    if (!Number.isFinite(inicioMonotono)) {
      throw new Error('El instante de inicio del audio del bot no es válido.')
    }

    const indice = (this.manifiesto.audiosBot?.length ?? 0) + this.operacionesAudioBot.size + 1
    const archivo = `voz-bot-${indice}.ogg`
    const temporal = join(this.directorio, `${archivo}.part`)
    const operacion = (async () => {
      try {
        await this.verificarEspacio()
        await copyFile(rutaFuente, temporal)
        await verificarOgg(temporal)
        await rename(temporal, join(this.directorio, archivo))
        this.manifiesto.audiosBot = [
          ...(this.manifiesto.audiosBot ?? []),
          {
            archivo,
            inicioMs: Math.max(0, Math.floor(inicioMonotono - inicioGrabacion)),
          },
        ]
        await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
      } catch (error) {
        await rm(temporal, { force: true }).catch((errorLimpieza: unknown) => {
          console.error(`[Soporte ${this.manifiesto.soporteId}] No se pudo limpiar el audio temporal del bot:`, errorLimpieza)
        })
        throw error
      }
    })()
    this.operacionesAudioBot.add(operacion)
    void operacion.then(
      () => this.operacionesAudioBot.delete(operacion),
      () => this.operacionesAudioBot.delete(operacion),
    )
    await operacion
  }

  async iniciarCaptura(discordIds: readonly string[]): Promise<void> {
    if (this.finalizando) throw new Error('La grabación ya está finalizada.')
    this.inicioMonotono ??= performance.now()
    this.capturaActiva = true
    this.manifiesto.estado = 'PAUSADA'
    await this.suscribir(discordIds)
  }

  pausarCaptura(): void {
    if (this.finalizando) return
    this.capturaActiva = false
    this.limpiarFlujos()
  }

  async reanudarCaptura(discordIds: readonly string[]): Promise<void> {
    if (this.finalizando) throw new Error('La grabación ya está finalizada.')
    this.capturaActiva = true
    this.manifiesto.estado = 'PAUSADA'
    await this.suscribir(discordIds)
  }

  async retirarUsuario(discordId: string): Promise<void> {
    const flujo = this.flujoPorUsuario.get(discordId)
    if (flujo) {
      this.flujoPorUsuario.delete(discordId)
      flujo.flujo.destroy()
    }
  }

  async registrarMensajesLog(mensajes: MensajeGrabacionLog[]): Promise<void> {
    this.manifiesto.mensajesLog.push(...mensajes)
    await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
  }

  async finalizar(): Promise<{
    manifiesto: ManifiestoGrabacionSoporte
    mezclaPath?: string
    pistas: Array<{ discordId: string; path: string }>
  }> {
    if (this.finalizando) throw new Error('La finalización de la grabación ya está en curso.')
    this.finalizando = true
    this.capturaActiva = false
    this.limpiarFlujos()
    this.conexion.destroy()

    const finMonotono = performance.now()
    const muestraFin = this.inicioMonotono === undefined
      ? 0
      : Math.max(0, Math.floor(
        ((finMonotono - this.inicioMonotono) * muestrasPorSegundo) / 1000,
      ))
    const pistas: Array<{ discordId: string; path: string }> = []
    try {
      await Promise.all([...this.operacionesAudioBot])
      for (const pista of this.pistaPorUsuario.values()) {
        await pista.cola
        await this.escribirHasta(pista, muestraFin)
        pista.entrada.end()
        await pista.salida
        if (pista.paquetes === 0) {
          await rm(pista.temporal, { force: true })
          continue
        }
        await verificarOgg(pista.temporal)
        await rename(pista.temporal, pista.final)
        pistas.push({ discordId: pista.discordId, path: pista.final })
      }

      if (pistas.length === 0) {
        for (const { archivo } of this.manifiesto.audiosBot ?? []) {
          await rm(join(this.directorio, archivo), { force: true })
        }
        this.manifiesto.estado = 'NO DISPONIBLE'
        this.manifiesto.mezcla = null
        this.manifiesto.pistas = []
        this.manifiesto.audiosBot = []
        this.manifiesto.finalizadaEn = new Date().toISOString()
        this.manifiesto.venceEn = null
        await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
        return { manifiesto: this.manifiesto, pistas: [] }
      }

      const mezclaPath = join(this.directorio, 'mezcla.ogg')
      const mezclaTemporal = `${mezclaPath}.part`
      const audiosBot = (this.manifiesto.audiosBot ?? []).map(({ archivo, inicioMs }) => ({
        path: join(this.directorio, archivo),
        inicioMs,
      }))
      await mezclarPistas(pistas.map((pista) => pista.path), mezclaTemporal, audiosBot)
      await verificarOgg(mezclaTemporal)
      await rename(mezclaTemporal, mezclaPath)
      this.manifiesto.estado = 'FINALIZADA'
      this.manifiesto.finalizadaEn = new Date().toISOString()
      this.manifiesto.venceEn = new Date(Date.now() + this.retencionMs()).toISOString()
      this.manifiesto.mezcla = 'mezcla.ogg'
      this.manifiesto.pistas = pistas.map((pista) => ({
        discordId: pista.discordId,
        archivo: pista.path.slice(this.directorio.length + 1),
      }))
      await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
      return { manifiesto: this.manifiesto, mezclaPath, pistas }
    } catch (error) {
      for (const pista of this.pistaPorUsuario.values()) {
        pista.entrada.destroy()
        pista.proceso.kill()
        await rm(pista.temporal, { force: true }).catch(() => undefined)
        await rm(pista.final, { force: true }).catch(() => undefined)
      }
      for (const { archivo } of this.manifiesto.audiosBot ?? []) {
        await rm(join(this.directorio, archivo), { force: true }).catch(() => undefined)
      }
      await rm(join(this.directorio, 'mezcla.ogg.part'), { force: true }).catch(() => undefined)
      this.manifiesto.estado = 'ERROR'
      this.manifiesto.finalizadaEn = new Date().toISOString()
      this.manifiesto.venceEn = null
      this.manifiesto.mezcla = null
      this.manifiesto.pistas = []
      this.manifiesto.audiosBot = []
      await guardarManifiestoGrabacion(resolve(this.directorio, '..'), this.manifiesto)
      throw error
    }
  }

  private retencionMs(): number {
    return this.retencionDiasConfigurada * 24 * 60 * 60 * 1000
  }

  private async suscribir(discordIds: readonly string[]): Promise<void> {
    const ids = [...new Set(discordIds)].filter((id) => !this.flujoPorUsuario.has(id))
    const cantidadTotal = new Set([...this.pistaPorUsuario.keys(), ...ids]).size
    if (
      this.manifiesto.origenGrabacion !== 'servicio-staff' &&
      cantidadTotal > limitePistasGrabacion
    ) {
      throw new Error(`La grabación excede el máximo seguro de ${limitePistasGrabacion} pistas individuales.`)
    }
    for (const discordId of ids) {
      const flujo = this.conexion.receiver.subscribe(discordId, {
        end: { behavior: EndBehaviorType.Manual },
      })
      const activa: PistaActiva = {
        discordId,
        flujo,
        decoder: new OpusEncoder(frecuencia, canales),
      }
      this.flujoPorUsuario.set(discordId, activa)
      flujo.on('data', (paquete: Buffer) => {
        if (!this.capturaActiva || this.finalizando) return
        try {
          const recibidoEn = performance.now()
          const pista = this.pistaPorUsuario.get(discordId) ?? this.crearPista(discordId, activa.decoder)
          pista.cola = pista.cola
            .then(() => this.procesarPaquete(pista, paquete, recibidoEn))
            .catch((error: unknown) => {
              if (esPaqueteOpusCorrupto(error)) {
                const ahora = Date.now()
                if (ahora - this.ultimoAvisoOpusCorrupto >= 5_000) {
                  this.ultimoAvisoOpusCorrupto = ahora
                  console.warn(
                    `[Soporte ${this.manifiesto.soporteId}] Se omitió una trama Opus corrupta de ${discordId}.`,
                  )
                }
                return
              }
              this.conexionError(
                error instanceof Error ? error : new Error('No se pudo procesar un paquete Opus.'),
              )
            })
        } catch (error) {
          this.conexionError(
            error instanceof Error ? error : new Error('No se pudo iniciar la pista de audio.'),
          )
        }
      })
      flujo.on('error', (error: Error) => {
        if (this.finalizando) return
        if (esErrorDAVE(error)) {
          console.warn(
            `[Soporte ${this.manifiesto.soporteId}] El receptor está recuperando una trama DAVE; se conserva la conexión.`,
          )
          return
        }
        this.conexionError(error)
      })
    }
  }

  private crearPista(discordId: string, decoder: OpusEncoder): CodificadorPista {
    const ejecutable = ffmpegPath
    if (!ejecutable) throw new Error('No se encontró el ejecutable de FFmpeg.')
    const archivo = `participante-${discordId}.ogg`
    const final = join(this.directorio, archivo)
    const temporal = `${final}.part`
    const proceso = spawn(ejecutable, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 's16le',
      '-ar', String(frecuencia),
      '-ac', String(canales),
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libopus',
      '-application', 'voip',
      '-b:a', '64k',
      '-f', 'ogg',
      temporal,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    if (!proceso.stdin || !proceso.stderr) {
      proceso.kill()
      throw new Error('FFmpeg no pudo abrir sus flujos de entrada y error.')
    }
    let stderr = ''
    proceso.stderr.setEncoding('utf8')
    proceso.stderr.on('data', (fragmento: string) => {
      stderr = `${stderr}${fragmento}`.slice(-2000)
    })
    const salida = new Promise<void>((resolveSalida, rejectSalida) => {
      proceso.once('error', rejectSalida)
      proceso.once('close', (codigo, senal) => {
        if (codigo === 0) resolveSalida()
        else rejectSalida(new Error(`FFmpeg terminó con ${codigo ?? senal}: ${stderr || 'sin detalles'}`))
      })
    })
    const pista: CodificadorPista = {
      discordId,
      temporal,
      final,
      proceso,
      entrada: proceso.stdin,
      salida,
      decoder,
      cursorMuestras: 0,
      paquetes: 0,
      cola: Promise.resolve(),
    }
    this.pistaPorUsuario.set(discordId, pista)
    return pista
  }

  private async procesarPaquete(
    pista: CodificadorPista,
    paquete: Buffer,
    recibidoEn: number,
  ): Promise<void> {
    if (!this.capturaActiva || this.finalizando) return
    const inicioMonotono = this.inicioMonotono
    if (inicioMonotono === undefined) throw new Error('La captura no tiene un instante de inicio válido.')
    await this.verificarEspacio()
    if (!this.capturaActiva || this.finalizando) return
    const pcm = pista.decoder.decode(paquete)
    if (pcm.length === 0 || pcm.length % bytesPorMuestra !== 0) {
      throw new Error('El decodificador Opus devolvió una trama PCM inválida.')
    }
    const muestraObjetivo = Math.max(0, Math.floor(
      ((recibidoEn - inicioMonotono) * muestrasPorSegundo) / 1000,
    ))
    const plan = planificarPaquetePcm(pcm, pista.cursorMuestras, muestraObjetivo)
    await this.escribirHasta(pista, pista.cursorMuestras + plan.muestrasSilencio)
    if (!this.capturaActiva || this.finalizando) return
    await escribirBuffer(pista.entrada, pcm)
    pista.cursorMuestras = plan.cursorSiguiente
    pista.paquetes += 1
    if (!this.manifiesto.iniciadaEn) this.manifiesto.iniciadaEn = new Date().toISOString()
    if (!this.capturaActiva || this.finalizando) return
    if (this.manifiesto.estado !== 'GRABANDO') {
      this.manifiesto.estado = 'GRABANDO'
      void Promise.resolve(this.primerPaquete(pista.discordId)).catch((error: unknown) => {
        this.capturaActiva = false
        this.limpiarFlujos()
        this.conexionError(
          error instanceof Error
            ? error
            : new Error('No se pudo auditar el inicio de la captura de audio.'),
        )
      })
    }
  }

  private async escribirHasta(pista: CodificadorPista, muestraObjetivo: number): Promise<void> {
    let faltan = muestraObjetivo - pista.cursorMuestras
    while (faltan > 0) {
      const muestras = Math.min(muestrasSilencio, faltan)
      await escribirBuffer(pista.entrada, Buffer.alloc(muestras * bytesPorMuestra))
      pista.cursorMuestras += muestras
      faltan -= muestras
    }
  }

  private async verificarEspacio(): Promise<void> {
    if (Date.now() - this.ultimoChequeoEspacio < 5_000) return
    this.ultimoChequeoEspacio = Date.now()
    const espacio = await statfs(this.directorio)
    const disponible = Number(espacio.bavail) * Number(espacio.bsize)
    if (disponible < espacioMinimoBytes) {
      throw new Error('El volumen de grabaciones se está quedando sin espacio libre.')
    }
  }

  private limpiarFlujos(): void {
    for (const { flujo } of this.flujoPorUsuario.values()) flujo.destroy()
    this.flujoPorUsuario.clear()
  }
}

export async function finalizarGrabadorPorError(grabador: GrabadorSoporte): Promise<void> {
  try {
    await grabador.finalizar()
  } catch (error) {
    console.error(`[Soporte ${grabador.manifiesto.soporteId}] No se pudo conservar una grabación incompleta:`, error)
  }
}

export async function listarManifiestosGrabacion(
  directorioRaiz: string | undefined,
): Promise<ManifiestoGrabacionSoporte[]> {
  if (!directorioRaiz || !isAbsolute(directorioRaiz)) return []
  let entradas: string[]
  try {
    entradas = await readdir(resolve(directorioRaiz))
  } catch (error) {
    if (esErrorSistema(error, 'ENOENT')) return []
    throw error
  }
  const manifiestos: ManifiestoGrabacionSoporte[] = []
  for (const entrada of entradas) {
    if (!/^[\da-f-]{36}$/i.test(entrada)) continue
    try {
      const manifiesto = await leerManifiestoGrabacion(directorioRaiz, entrada)
      if (manifiesto) manifiestos.push(manifiesto)
    } catch (error) {
      console.error(`[Soporte ${entrada}] No se pudo leer el manifiesto:`, error)
    }
  }
  return manifiestos
}

export async function recuperarManifiestosInterrumpidos(
  directorioRaiz: string | undefined,
): Promise<ManifiestoGrabacionSoporte[]> {
  if (!directorioRaiz || !isAbsolute(directorioRaiz)) return []
  const recuperados: ManifiestoGrabacionSoporte[] = []
  for (const manifiesto of await listarManifiestosGrabacion(directorioRaiz)) {
    if (
      manifiesto.estado !== 'ESPERANDO CONSENTIMIENTO' &&
      manifiesto.estado !== 'GRABANDO' &&
      manifiesto.estado !== 'PAUSADA'
    ) continue
    const directorio = rutaDirectorioGrabacion(directorioRaiz, manifiesto.soporteId)
    for (const archivo of await readdir(directorio)) {
      if (
        archivo.endsWith('.part') ||
        archivo.endsWith('.tmp') ||
        archivo === 'mezcla.ogg' ||
        /^participante-\d{17,20}\.ogg$/.test(archivo) ||
        /^voz-bot-\d+\.ogg$/.test(archivo)
      ) {
        await rm(join(directorio, archivo), { force: true })
      }
    }
    manifiesto.estado = manifiesto.iniciadaEn ? 'ERROR' : 'NO DISPONIBLE'
    manifiesto.finalizadaEn = new Date().toISOString()
    manifiesto.venceEn = null
    manifiesto.mezcla = null
    manifiesto.pistas = []
    manifiesto.audiosBot = []
    await guardarManifiestoGrabacion(directorioRaiz, manifiesto)
    recuperados.push(manifiesto)
  }
  return recuperados
}

export async function listarManifiestosVencidos(
  directorioRaiz: string | undefined,
  ahora = Date.now(),
): Promise<ManifiestoGrabacionSoporte[]> {
  if (!directorioRaiz || !isAbsolute(directorioRaiz)) return []
  const vencidos: ManifiestoGrabacionSoporte[] = []
  for (const manifiesto of await listarManifiestosGrabacion(directorioRaiz)) {
    if (manifiesto.venceEn && Date.parse(manifiesto.venceEn) <= ahora) {
      vencidos.push(manifiesto)
    }
  }
  return vencidos
}

export async function eliminarArchivosGrabacion(
  directorioRaiz: string,
  soporteId: string,
): Promise<void> {
  const directorio = rutaDirectorioGrabacion(directorioRaiz, soporteId)
  await rm(directorio, { recursive: true, force: true })
}

export async function eliminarContenidoAudioGrabacion(
  directorioRaiz: string,
  manifiesto: ManifiestoGrabacionSoporte,
): Promise<void> {
  const archivos = [
    ...(manifiesto.mezcla ? [manifiesto.mezcla] : []),
    ...manifiesto.pistas.map(({ archivo }) => archivo),
    ...(manifiesto.audiosBot ?? []).map(({ archivo }) => archivo),
  ]
  for (const archivo of archivos) {
    const ruta = obtenerRutaArchivoGrabacion(directorioRaiz, manifiesto.soporteId, archivo)
    await rm(ruta, { force: true })
  }
  manifiesto.mezcla = null
  manifiesto.pistas = []
  manifiesto.audiosBot = []
}

export function obtenerRutaArchivoGrabacion(
  directorioRaiz: string,
  soporteId: string,
  archivo: string,
): string {
  if (
    archivo !== 'mezcla.ogg' &&
    !/^participante-\d{17,20}\.ogg$/.test(archivo) &&
    !/^voz-bot-\d+\.ogg$/.test(archivo)
  ) {
    throw new Error('El archivo solicitado no pertenece al formato de grabación.')
  }
  const base = rutaDirectorioGrabacion(directorioRaiz, soporteId)
  const ruta = resolve(base, archivo)
  if (!ruta.startsWith(`${base}\\`) && !ruta.startsWith(`${base}/`)) {
    throw new Error('La ruta de grabación solicitada no es válida.')
  }
  return ruta
}

export async function existeArchivoCompleto(ruta: string): Promise<boolean> {
  try {
    const info = await stat(ruta)
    if (!info.isFile() || info.size < 100) return false
    const archivo = await open(ruta, 'r')
    try {
      const cabecera = Buffer.alloc(4)
      const leidos = await archivo.read(cabecera, 0, cabecera.length, 0)
      return leidos.bytesRead === 4 && cabecera.toString('ascii') === 'OggS'
    } finally {
      await archivo.close()
    }
  } catch (error) {
    if (esErrorSistema(error, 'ENOENT')) return false
    throw error
  }
}

export async function mezclarPistas(
  archivos: string[],
  salida: string,
  audiosBot: AudioBotMezcla[] = [],
): Promise<void> {
  if (archivos.length === 0) throw new Error('No existen pistas de audio para mezclar.')
  const ejecutable = ffmpegPath
  if (!ejecutable) throw new Error('No se encontró el ejecutable de FFmpeg.')
  if (audiosBot.some(({ inicioMs }) => !Number.isSafeInteger(inicioMs) || inicioMs < 0)) {
    throw new Error('Los desplazamientos de audio del bot deben ser milisegundos enteros no negativos.')
  }
  const entradasParticipantes = archivos.flatMap((archivo) => ['-i', archivo])
  const entradasBot = audiosBot.flatMap(({ path }) => ['-i', path])
  const cantidadEntradas = archivos.length + audiosBot.length
  const fuentesParticipantes = archivos.map((_archivo, indice) => `[${indice}:a]`).join('')
  const filtrosBot = audiosBot.map(({ inicioMs }, indice) => {
    const entrada = archivos.length + indice
    return `[${entrada}:a]adelay=${inicioMs}:all=1[vozbot${indice}]`
  })
  const fuentesBot = audiosBot.map((_audio, indice) => `[vozbot${indice}]`).join('')
  const filtroMezcla =
    `${fuentesParticipantes}${fuentesBot}amix=inputs=${cantidadEntradas}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[salida]`
  const filtro = [...filtrosBot, filtroMezcla].join(';')
  await ejecutarFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    ...entradasParticipantes,
    ...entradasBot,
    '-filter_complex', filtro,
    '-map', '[salida]',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-application', 'audio',
    '-f', 'ogg',
    salida,
  ])
}

export async function verificarOgg(ruta: string): Promise<void> {
  if (!await existeArchivoCompleto(ruta)) {
    throw new Error('La salida de audio está vacía o no es un archivo Ogg válido.')
  }
  const ejecutable = ffmpegPath
  if (!ejecutable) throw new Error('No se encontró el ejecutable de FFmpeg.')
  await ejecutarFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-i', ruta,
    '-f', 'null',
    '-',
  ])
}

function ejecutarFfmpeg(argumentos: string[]): Promise<void> {
  const ejecutable = ffmpegPath
  if (!ejecutable) return Promise.reject(new Error('No se encontró el ejecutable de FFmpeg.'))
  const proceso = spawn(ejecutable, argumentos, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  proceso.stderr?.setEncoding('utf8')
  proceso.stderr?.on('data', (fragmento: string) => {
    stderr = `${stderr}${fragmento}`.slice(-2000)
  })
  return new Promise((resolveProceso, rejectProceso) => {
    proceso.once('error', rejectProceso)
    proceso.once('close', (codigo, senal) => {
      if (codigo === 0) resolveProceso()
      else rejectProceso(new Error(`FFmpeg terminó con ${codigo ?? senal}: ${stderr || 'sin detalles'}`))
    })
  })
}

function escribirBuffer(entrada: Writable, buffer: Buffer): Promise<void> {
  return new Promise((resolveEscritura, rejectEscritura) => {
    entrada.write(buffer, (error?: Error | null) => {
      if (error) rejectEscritura(error)
      else resolveEscritura()
    })
  })
}

function esErrorSistema(error: unknown, codigo: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === codigo
}

function esManifiestoGrabacion(valor: unknown): valor is ManifiestoGrabacionSoporte {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const manifiesto = valor as Record<string, unknown>
  return typeof manifiesto.soporteId === 'string' &&
    /^[\da-f-]{36}$/i.test(manifiesto.soporteId) &&
    (manifiesto.origenGrabacion === undefined ||
      manifiesto.origenGrabacion === 'soporte' ||
      manifiesto.origenGrabacion === 'directa' ||
      manifiesto.origenGrabacion === 'servicio-staff') &&
    esSnowflake(manifiesto.guildId) &&
    (manifiesto.estado === 'ESPERANDO CONSENTIMIENTO' ||
      manifiesto.estado === 'GRABANDO' ||
      manifiesto.estado === 'PAUSADA' ||
      manifiesto.estado === 'FINALIZADA' ||
      manifiesto.estado === 'NO DISPONIBLE' ||
      manifiesto.estado === 'ERROR') &&
    esFecha(manifiesto.abiertoEn) &&
    esFechaOpcional(manifiesto.iniciadaEn) &&
    esFechaOpcional(manifiesto.finalizadaEn) &&
    esFechaOpcional(manifiesto.venceEn) &&
    Array.isArray(manifiesto.participantes) &&
    manifiesto.participantes.every(esSnowflake) &&
    Array.isArray(manifiesto.consentimientos) &&
    manifiesto.consentimientos.every(esConsentimiento) &&
    (manifiesto.mezcla === null || manifiesto.mezcla === 'mezcla.ogg') &&
    Array.isArray(manifiesto.pistas) &&
    manifiesto.pistas.every(esPista) &&
    (manifiesto.audiosBot === undefined ||
      (Array.isArray(manifiesto.audiosBot) && manifiesto.audiosBot.every(esAudioBot))) &&
    Array.isArray(manifiesto.mensajesLog) &&
    manifiesto.mensajesLog.every(esMensajeLog)
}

function esSnowflake(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{17,20}$/.test(valor)
}

function esFecha(valor: unknown): valor is string {
  return typeof valor === 'string' && Number.isFinite(Date.parse(valor))
}

function esFechaOpcional(valor: unknown): valor is string | null {
  return valor === null || esFecha(valor)
}

function esConsentimiento(valor: unknown): valor is ConsentimientoGrabacion {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const consentimiento = valor as Record<string, unknown>
  return esSnowflake(consentimiento.discordId) &&
    (consentimiento.estado === 'PENDIENTE' ||
      consentimiento.estado === 'ACEPTADO' ||
      consentimiento.estado === 'RECHAZADO' ||
      consentimiento.estado === 'RETIRADO') &&
    esFecha(consentimiento.actualizadoEn)
}

function esPista(valor: unknown): valor is ArchivoPistaGrabacion {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const pista = valor as Record<string, unknown>
  return esSnowflake(pista.discordId) &&
    typeof pista.archivo === 'string' &&
    /^participante-\d{17,20}\.ogg$/.test(pista.archivo)
}

function esAudioBot(valor: unknown): valor is AudioBotGrabacion {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const audio = valor as Record<string, unknown>
  return typeof audio.archivo === 'string' &&
    /^voz-bot-\d+\.ogg$/.test(audio.archivo) &&
    Number.isSafeInteger(audio.inicioMs) &&
    typeof audio.inicioMs === 'number' &&
    audio.inicioMs >= 0
}

function esMensajeLog(valor: unknown): valor is MensajeGrabacionLog {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const mensaje = valor as Record<string, unknown>
  return esSnowflake(mensaje.canalId) && esSnowflake(mensaje.mensajeId)
}
