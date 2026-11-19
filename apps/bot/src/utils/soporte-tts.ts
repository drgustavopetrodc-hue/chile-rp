import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice'
import type { VoiceConnection } from '@discordjs/voice'
import { PermissionFlagsBits } from 'discord.js'
import type { VoiceChannel } from 'discord.js'
import { EdgeTTS } from 'node-edge-tts'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export const VOZ_TTS_SOPORTE = 'es-CL-LorenzoNeural'
const idiomaTts = 'es-CL'
const timeoutSintesisMs = 25_000
const timeoutConexionMs = 12_000
const timeoutReproduccionMs = 75_000
const colasPorConexion = new WeakMap<VoiceConnection, Promise<void>>()

export const anunciosTtsSoporte = {
  inicioConConsentimiento:
    'Bienvenidos al soporte institucional de Chile RP. Se informa que esta audiencia podrá ser grabada únicamente si cada participante otorga su consentimiento explícito e individual. Por favor, revisen el canal de texto del soporte y respondan los botones de consentimiento. Mientras falte una respuesta afirmativa, no se grabará audio.',
  inicioSinGrabacion:
    'Bienvenidos al soporte institucional de Chile RP. Se informa que la función de grabación no se encuentra disponible para esta audiencia. El soporte continuará sin grabación. Por favor, utilicen el canal de texto para adjuntar pruebas y antecedentes.',
  grabacionActiva:
    'Se informa que todos los participantes presentes han otorgado su consentimiento explícito. El sistema de grabación de audio se encuentra activo.',
  consentimientoRechazado:
    'Se informa que no se obtuvo el consentimiento de todos los participantes. La grabación no se iniciará y el soporte continuará sin grabación.',
  consentimientoRetirado:
    'Se informa que un participante ha retirado su consentimiento. La grabación se detuvo y el soporte será cerrado. Los canales se conservarán si la evidencia no puede archivarse de forma segura.',
  errorGrabacion:
    'Se ha producido un inconveniente técnico. La grabación no está disponible y el soporte continuará sin grabación activa. Por favor, mantengan los antecedentes en el canal de texto.',
} as const

/**
 * Reproduce un anuncio TTS en el canal de voz del soporte.
 * Si no se entrega una conexión existente, crea una conexión temporal y la cierra al terminar.
 * La síntesis utiliza el servicio en línea de Microsoft Edge Read Aloud a través de node-edge-tts.
 */
export async function reproducirAnuncioSoporte(
  canal: VoiceChannel,
  texto: string,
  conexionExistente?: VoiceConnection,
  registrarAudioBot?: (rutaOgg: string, inicioMonotono: number) => Promise<void>,
): Promise<void> {
  const textoSeguro = texto.trim()
  if (!textoSeguro) throw new Error('El anuncio TTS no puede estar vacío.')
  if (textoSeguro.length > 1_500) {
    throw new Error('El anuncio TTS supera el límite de 1.500 caracteres.')
  }

  let conexion = conexionExistente
  let conexionPropia = false
  if (!conexion) {
    conexion = joinVoiceChannel({
      channelId: canal.id,
      guildId: canal.guild.id,
      adapterCreator: canal.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    })
    conexionPropia = true
  }

  try {
    await entersState(conexion, VoiceConnectionStatus.Ready, timeoutConexionMs)
    await encolarReproduccion(conexion, async () => {
      const bot = await canal.guild.members.fetchMe()
      if (!bot.permissionsIn(canal).has(PermissionFlagsBits.MuteMembers)) {
        throw new Error('El bot necesita permiso para silenciar miembros durante los anuncios de soporte.')
      }
      await ejecutarConParticipantesSilenciados(
        [...canal.members.values()],
        canal.id,
        () => reproducirEnConexion(conexion!, textoSeguro, registrarAudioBot),
      )
    })
  } finally {
    if (conexionPropia) conexion.destroy()
  }
}

export interface ParticipanteSilenciable {
  id: string
  user: { bot: boolean }
  voice: {
    channelId: string | null
    serverMute: boolean | null
    setMute(muted: boolean, reason?: string): Promise<unknown>
  }
}

export async function ejecutarConParticipantesSilenciados(
  miembros: readonly ParticipanteSilenciable[],
  canalId: string,
  reproducir: () => Promise<void>,
): Promise<void> {
  const silenciados: ParticipanteSilenciable[] = []
  const errores: unknown[] = []
  const miembrosQueDebenSilenciarse = [...new Map(
    miembros
      .filter((miembro) =>
        !miembro.user.bot &&
        miembro.voice.channelId === canalId &&
        miembro.voice.serverMute !== true,
      )
      .map((miembro) => [miembro.id, miembro]),
  ).values()]
  const resultadosSilencio = await Promise.allSettled(
    miembrosQueDebenSilenciarse.map(async (miembro) => {
      try {
        await miembro.voice.setMute(true, 'Anuncio de voz del soporte institucional')
        silenciados.push(miembro)
      } catch (error) {
        if (!esErrorMiembroDesconectado(error)) throw error
      }
    }),
  )
  errores.push(...resultadosSilencio.flatMap((resultado) =>
    resultado.status === 'rejected' ? [resultado.reason] : [],
  ))

  if (errores.length === 0) {
    try {
      await reproducir()
    } catch (error) {
      errores.push(error)
    }
  }

  const resultadosRestauracion = await Promise.allSettled(
    silenciados.map(async (miembro) => {
      try {
        await miembro.voice.setMute(false, 'Finalizó el anuncio de voz del soporte institucional')
      } catch (error) {
        if (!esErrorMiembroDesconectado(error)) throw error
      }
    }),
  )
  errores.push(...resultadosRestauracion.flatMap((resultado) =>
    resultado.status === 'rejected' ? [resultado.reason] : [],
  ))

  if (errores.length === 1) throw errores[0]
  if (errores.length > 1) {
    throw new AggregateError(errores, 'No se pudo completar el anuncio o restaurar el audio de todos los miembros.')
  }
}

function esErrorMiembroDesconectado(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 40032
}

async function encolarReproduccion(
  conexion: VoiceConnection,
  tarea: () => Promise<void>,
): Promise<void> {
  const anterior = colasPorConexion.get(conexion) ?? Promise.resolve()
  const ejecucion = anterior.catch(() => undefined).then(tarea)
  const cola = ejecucion.then(() => undefined, () => undefined)
  colasPorConexion.set(conexion, cola)
  try {
    await ejecucion
  } finally {
    if (colasPorConexion.get(conexion) === cola) colasPorConexion.delete(conexion)
  }
}

async function reproducirEnConexion(
  conexion: VoiceConnection,
  texto: string,
  registrarAudioBot?: (rutaOgg: string, inicioMonotono: number) => Promise<void>,
): Promise<void> {
  if (!ffmpegPath) throw new Error('FFmpeg no está disponible para preparar el audio TTS.')

  const directorio = await mkdtemp(join(tmpdir(), 'rp-chile-soporte-tts-'))
  const rutaMp3 = join(directorio, 'anuncio.mp3')
  const rutaOgg = join(directorio, 'anuncio.ogg')
  const reproductor = createAudioPlayer()
  let cancelarSuscripcion: (() => void) | undefined
  let inicioReproduccion: number | undefined

  try {
    const sintetizador = new EdgeTTS({
      voice: VOZ_TTS_SOPORTE,
      lang: idiomaTts,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      rate: '-5%',
      pitch: 'default',
      volume: 'default',
      timeout: timeoutSintesisMs,
    })
    await sintetizador.ttsPromise(texto, rutaMp3)

    const archivoMp3 = await stat(rutaMp3)
    if (!archivoMp3.isFile() || archivoMp3.size < 256) {
      throw new Error('El proveedor TTS no generó un archivo MP3 válido.')
    }

    await ejecutarFfmpegTts([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', rutaMp3,
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-application', 'voip',
      '-f', 'ogg',
      rutaOgg,
    ])

    const archivoOgg = await stat(rutaOgg)
    const descriptorOgg = await open(rutaOgg, 'r')
    let cabeceraOgg: Buffer
    try {
      cabeceraOgg = Buffer.alloc(4)
      const lectura = await descriptorOgg.read(cabeceraOgg, 0, cabeceraOgg.length, 0)
      if (lectura.bytesRead !== 4) throw new Error('El archivo Ogg no contiene una cabecera completa.')
    } finally {
      await descriptorOgg.close()
    }
    if (!archivoOgg.isFile() || archivoOgg.size < 256 || cabeceraOgg.toString('ascii') !== 'OggS') {
      throw new Error('FFmpeg no produjo un audio Ogg/Opus reproducible.')
    }

    const suscripcion = conexion.subscribe(reproductor)
    cancelarSuscripcion = () => suscripcion?.unsubscribe()
    const errorReproductor = new Promise<never>((_resolve, reject) => {
      reproductor.once('error', reject)
    })
    reproductor.on('stateChange', (_anterior, siguiente) => {
      if (siguiente.status === AudioPlayerStatus.Playing && inicioReproduccion === undefined) {
        inicioReproduccion = performance.now()
      }
    })

    reproductor.play(createAudioResource(createReadStream(rutaOgg), {
      inputType: StreamType.OggOpus,
    }))

    await Promise.race([
      entersState(reproductor, AudioPlayerStatus.Playing, 10_000),
      errorReproductor,
    ])
    let errorRegistroBot: unknown
    try {
      await registrarAudioBot?.(rutaOgg, inicioReproduccion ?? performance.now())
    } catch (error) {
      errorRegistroBot = error
    }
    await Promise.race([
      entersState(reproductor, AudioPlayerStatus.Idle, timeoutReproduccionMs),
      errorReproductor,
    ])
    if (errorRegistroBot) {
      throw new Error('No se pudo conservar la voz del bot en la grabación.', { cause: errorRegistroBot })
    }
  } finally {
    reproductor.stop(true)
    cancelarSuscripcion?.()
    reproductor.removeAllListeners()
    await rm(directorio, { recursive: true, force: true })
  }
}

function ejecutarFfmpegTts(argumentos: string[]): Promise<void> {
  const ejecutable = ffmpegPath

  if (typeof ejecutable !== 'string' || ejecutable.length === 0) {
    return Promise.reject(new Error('FFmpeg no está disponible.'))
  }

  return new Promise<void>((resolveProceso, rejectProceso) => {
    const proceso = spawn(ejecutable, argumentos, { stdio: 'pipe' })
    let stderr = ''

    proceso.stderr.setEncoding('utf8')
    proceso.stderr.on('data', (fragmento: string) => {
      stderr = `${stderr}${fragmento}`.slice(-2_000)
    })

    proceso.once('error', rejectProceso)
    proceso.once('close', (codigo, senal) => {
      if (codigo === 0) {
        resolveProceso()
      } else {
        rejectProceso(
          new Error(
            `No se pudo convertir el anuncio TTS con FFmpeg (${codigo ?? senal}): ${stderr || 'sin detalles'}`,
          ),
        )
      }
    })
  })
}
