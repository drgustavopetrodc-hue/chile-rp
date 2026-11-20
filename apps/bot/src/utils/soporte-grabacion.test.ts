import assert from 'node:assert/strict'
import test from 'node:test'
import { OpusEncoder } from '@discordjs/opus'
import ffmpegPath from 'ffmpeg-static'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  crearConsentimientosPendientes,
  coincidenParticipantesGrabacion,
  estaDentroDeVolumenMontado,
  guardarManifiestoGrabacion,
  leerManifiestoGrabacion,
  listarManifiestosVencidos,
  mezclarPistas,
  planificarPaquetePcm,
  recuperarManifiestosInterrumpidos,
  rutaDirectorioGrabacion,
  todosAceptaronConsentimiento,
  verificarOgg,
} from './soporte-grabacion'

test('exige consentimiento individual de cada participante', () => {
  const consentimientos = crearConsentimientosPendientes(['100000000000000001', '100000000000000001'])
  assert.equal(consentimientos.length, 1)
  assert.equal(todosAceptaronConsentimiento(consentimientos), false)
  consentimientos[0]!.estado = 'ACEPTADO'
  assert.equal(todosAceptaronConsentimiento(consentimientos), true)
  consentimientos.push({
    discordId: '200000000000000002',
    estado: 'PENDIENTE',
    actualizadoEn: new Date().toISOString(),
  })
  assert.equal(todosAceptaronConsentimiento(consentimientos), false)
})

test('cancela el inicio si cambia la lista de participantes después del consentimiento', () => {
  assert.equal(coincidenParticipantesGrabacion(['a', 'b'], ['b', 'a']), true)
  assert.equal(coincidenParticipantesGrabacion(['a', 'b'], ['a']), false)
  assert.equal(coincidenParticipantesGrabacion(['a', 'b'], ['a', 'b', 'c']), false)
  assert.equal(coincidenParticipantesGrabacion(['a', 'b'], ['a', 'c']), false)
})

test('conserva el paquete PCM completo cuando llega antes por jitter de red', () => {
  const pcm = Buffer.alloc(960 * 4)
  const plan = planificarPaquetePcm(pcm, 1_920, 1_680)

  assert.equal(plan.muestrasSilencio, 0)
  assert.equal(plan.cursorSiguiente, 2_880)
})

test('mantiene silencio de alineación sin recortar el paquete PCM', () => {
  const pcm = Buffer.alloc(960 * 4)
  const plan = planificarPaquetePcm(pcm, 1_920, 2_400)

  assert.equal(plan.muestrasSilencio, 480)
  assert.equal(plan.cursorSiguiente, 3_360)
})

test('solo acepta rutas de grabación dentro de un punto de montaje no raíz', () => {
  assert.equal(estaDentroDeVolumenMontado('/data/grabaciones/soporte', ['/']), false)
  assert.equal(estaDentroDeVolumenMontado('/data/grabaciones/soporte', ['/data']), true)
  assert.equal(estaDentroDeVolumenMontado('/database/grabaciones', ['/data']), false)
  assert.throws(() => rutaDirectorioGrabacion('C:\\temp\\recordings', 'no-es-uuid'))
})

test('persiste manifiestos, identifica vencimiento y recupera sesiones sin reanudarlas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rp-chile-grabacion-'))
  const soporteId = '123e4567-e89b-12d3-a456-426614174000'
  try {
    const manifiesto = {
      soporteId,
      guildId: '100000000000000001',
      estado: 'GRABANDO' as const,
      abiertoEn: new Date().toISOString(),
      iniciadaEn: new Date().toISOString(),
      finalizadaEn: null,
      venceEn: new Date(Date.now() - 1_000).toISOString(),
      participantes: ['100000000000000002'],
      consentimientos: [{
        discordId: '100000000000000002',
        estado: 'ACEPTADO' as const,
        actualizadoEn: new Date().toISOString(),
      }],
      mezcla: null,
      pistas: [],
      mensajesLog: [],
    }
    await guardarManifiestoGrabacion(root, manifiesto)
    assert.deepEqual(await leerManifiestoGrabacion(root, soporteId), manifiesto)
    assert.equal((await listarManifiestosVencidos(root)).length, 1)

    await Promise.all([
      writeFile(join(root, soporteId, 'mezcla.ogg'), 'audio incompleto'),
      writeFile(join(root, soporteId, 'participante-100000000000000001.ogg'), 'audio incompleto'),
      writeFile(join(root, soporteId, 'audio.ogg.part'), 'incompleto'),
    ])
    const recuperados = await recuperarManifiestosInterrumpidos(root)
    assert.equal(recuperados.length, 1)
    assert.equal(recuperados[0]?.estado, 'ERROR')
    assert.equal(recuperados[0]?.mezcla, null)
    assert.deepEqual(recuperados[0]?.pistas, [])
    assert.equal((await leerManifiestoGrabacion(root, soporteId))?.estado, 'ERROR')
    assert.deepEqual(await readdir(join(root, soporteId)), ['manifiesto.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('decodifica Opus y mezcla la voz del bot en su instante original dentro de un Ogg reproducible', {
  timeout: 120_000,
}, async () => {
  assert.ok(ffmpegPath, 'FFmpeg debe estar instalado para habilitar la grabación')
  const root = await mkdtemp(join(tmpdir(), 'rp-chile-audio-'))
  try {
    const pista440 = join(root, '440.raw')
    const pista880 = join(root, '880.raw')
    const ogg440 = join(root, '440.ogg')
    const ogg880 = join(root, '880.ogg')
    const mezcla = join(root, 'mezcla.ogg')
    const pcm440 = crearTonoPcm(440)
    const pcm880 = crearTonoPcm(880)
    await Promise.all([
      writeFile(pista440, pcm440),
      writeFile(pista880, pcm880),
    ])

    const encoder = new OpusEncoder(48_000, 2)
    const decoder = new OpusEncoder(48_000, 2)
    const paquete = encoder.encode(pcm440.subarray(0, 3_840))
    const decodificado = decoder.decode(paquete)
    assert.ok(calcularRms(decodificado) > 100)

    await Promise.all([
      codificarPcm(ogg440, pista440),
      codificarPcm(ogg880, pista880),
    ])
    await Promise.all([verificarOgg(ogg440), verificarOgg(ogg880)])
    await mezclarPistas([ogg440], mezcla, [{ path: ogg880, inicioMs: 500 }])
    await verificarOgg(mezcla)

    const decodificadoMezcla = await decodificarOgg(mezcla)
    assert.ok(decodificadoMezcla.length > 120_000, `longitud PCM mezclada: ${decodificadoMezcla.length}`)
    assert.ok(magnitudEnFrecuencia(decodificadoMezcla, 440, 2_000, 10_000) > 100)
    assert.ok(magnitudEnFrecuencia(decodificadoMezcla, 880, 2_000, 10_000) < 100)
    assert.ok(magnitudEnFrecuencia(decodificadoMezcla, 880, 26_000, 34_000) > 100)
    assert.equal((await readFile(mezcla)).subarray(0, 4).toString('ascii'), 'OggS')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function crearTonoPcm(frecuencia: number): Buffer {
  const cantidadMuestras = 12_000
  const pcm = Buffer.alloc(cantidadMuestras * 4)
  for (let muestra = 0; muestra < cantidadMuestras; muestra += 1) {
    const valor = Math.round(8_000 * Math.sin((2 * Math.PI * frecuencia * muestra) / 48_000))
    pcm.writeInt16LE(valor, muestra * 4)
    pcm.writeInt16LE(valor, muestra * 4 + 2)
  }
  return pcm
}

function calcularRms(pcm: Buffer): number {
  let sumaCuadrados = 0
  const muestras = Math.floor(pcm.length / 2)
  for (let indice = 0; indice < muestras; indice += 1) {
    const valor = pcm.readInt16LE(indice * 2)
    sumaCuadrados += valor * valor
  }
  return Math.sqrt(sumaCuadrados / Math.max(muestras, 1))
}

function magnitudEnFrecuencia(
  pcm: Buffer,
  frecuencia: number,
  inicio: number,
  finSolicitado: number,
): number {
  const fin = Math.min(Math.floor(pcm.length / 4), finSolicitado)
  let real = 0
  let imaginaria = 0
  for (let muestra = inicio; muestra < fin; muestra += 1) {
    const valor = (pcm.readInt16LE(muestra * 4) + pcm.readInt16LE(muestra * 4 + 2)) / 2
    const angulo = (2 * Math.PI * frecuencia * muestra) / 48_000
    real += valor * Math.cos(angulo)
    imaginaria += valor * Math.sin(angulo)
  }
  return (2 * Math.hypot(real, imaginaria)) / Math.max(fin - inicio, 1)
}

async function codificarPcm(salida: string, entrada: string): Promise<void> {
  await ejecutarFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-i', entrada,
    '-c:a', 'libopus',
    '-b:a', '64k',
    '-f', 'ogg',
    salida,
  ])
}

async function decodificarOgg(entrada: string): Promise<Buffer> {
  return ejecutarFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-i', entrada,
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], true)
}

function ejecutarFfmpeg(argumentos: string[], capturarSalida = false): Promise<Buffer> {
  const proceso = spawn(ffmpegPath!, argumentos, {
    windowsHide: true,
    stdio: ['ignore', capturarSalida ? 'pipe' : 'ignore', 'pipe'],
  })
  const salida: Buffer[] = []
  let errorSalida = ''
  proceso.stdout?.on('data', (fragmento: Buffer) => salida.push(fragmento))
  proceso.stderr?.setEncoding('utf8')
  proceso.stderr?.on('data', (fragmento: string) => {
    errorSalida = `${errorSalida}${fragmento}`.slice(-2_000)
  })
  return new Promise((resolve, reject) => {
    proceso.once('error', reject)
    proceso.once('close', (codigo, senal) => {
      if (codigo === 0) resolve(Buffer.concat(salida))
      else reject(new Error(`FFmpeg terminó con ${codigo ?? senal}: ${errorSalida || 'sin detalles'}`))
    })
  })
}
