import { createCanvas, loadImage } from '@napi-rs/canvas'

export interface DatosCedulaImagen {
  nombres: string
  apellidos: string
  rut: string
  nacionalidad: string
  nacimiento: Date
  robloxUsername: string
  numeroSerie: string
  emitidaEn: Date
  venceEn: Date
  avatar: Buffer
}

const ancho = 1200
const alto = 760
const azul = '#164b7a'
const azulOscuro = '#123b62'
const tinta = '#17212b'
const etiqueta = '#17609a'
const papel = '#f3eddf'

export async function generarImagenCedula(datos: DatosCedulaImagen) {
  const canvas = createCanvas(ancho, alto)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = papel
  ctx.fillRect(0, 0, ancho, alto)

  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = '#b56f50'
  ctx.lineWidth = 3
  for (let x = 20; x < ancho; x += 95) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + 35, 100, x - 25, 180, x + 20, 260)
    ctx.stroke()
    for (let y = 55; y < 250; y += 38) {
      ctx.beginPath()
      ctx.ellipse(x + (y % 2 ? 18 : -10), y, 14, 5, -0.5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()

  ctx.strokeStyle = '#d1c5ae'
  ctx.lineWidth = 3
  ctx.strokeRect(10, 10, ancho - 20, alto - 20)
  dibujarBandera(ctx, 48, 42, 84, 54)
  ctx.fillStyle = azulOscuro
  ctx.font = '800 43px Arial'
  ctx.fillText('REPÚBLICA DE CHILE', 155, 79, 690)
  ctx.fillStyle = '#486579'
  ctx.font = '700 19px Arial'
  ctx.fillText('SERVICIO DE REGISTRO CIVIL E IDENTIFICACIÓN', 158, 111, 760)
  ctx.fillStyle = azul
  ctx.font = '800 22px Arial'
  ctx.fillText('CÉDULA DE IDENTIDAD', 48, 155)
  ctx.fillStyle = '#ba7657'
  ctx.fillRect(48, 171, ancho - 96, 3)

  const avatar = await loadImage(datos.avatar)
  const fotoX = 48
  const fotoY = 205
  const fotoAncho = 315
  const fotoAlto = 370
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(fotoX - 6, fotoY - 6, fotoAncho + 12, fotoAlto + 12)
  ctx.drawImage(avatar, fotoX, fotoY, fotoAncho, fotoAlto)
  ctx.strokeStyle = '#b7c2c9'
  ctx.lineWidth = 2
  ctx.strokeRect(fotoX, fotoY, fotoAncho, fotoAlto)

  const fecha = (valor: Date) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(valor).toUpperCase()
  campo(ctx, 'APELLIDOS', datos.apellidos.toUpperCase(), 410, 229, 330)
  campo(ctx, 'NOMBRES', datos.nombres.toUpperCase(), 410, 315, 330)
  campo(ctx, 'NACIONALIDAD', datos.nacionalidad.toUpperCase(), 410, 401, 330)
  campo(ctx, 'FECHA DE NACIMIENTO', fecha(datos.nacimiento), 410, 487, 330)
  campo(ctx, 'USUARIO ROBLOX', datos.robloxUsername, 410, 573, 330)

  campo(ctx, 'NÚMERO DE DOCUMENTO', datos.numeroSerie, 805, 229, 330)
  campo(ctx, 'RUN', datos.rut, 805, 315, 330)
  campo(ctx, 'FECHA DE EMISIÓN', fecha(datos.emitidaEn), 805, 401, 330)
  campo(ctx, 'FECHA DE VENCIMIENTO', fecha(datos.venceEn), 805, 487, 330)
  campo(ctx, 'ESTADO', 'VIGENTE', 805, 573, 330)

  ctx.strokeStyle = '#182a34'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(820, 670)
  ctx.bezierCurveTo(860, 630, 875, 710, 910, 664)
  ctx.bezierCurveTo(935, 632, 946, 702, 976, 665)
  ctx.bezierCurveTo(1000, 640, 1020, 684, 1050, 660)
  ctx.stroke()
  ctx.fillStyle = azulOscuro
  ctx.font = '700 14px Arial'
  ctx.fillText('FIRMA DEL TITULAR', 805, 713)
  ctx.fillStyle = '#536775'
  ctx.font = '600 13px Arial'
  ctx.textAlign = 'right'
  ctx.fillText('DOCUMENTO DE ROLEPLAY · NO OFICIAL', ancho - 48, alto - 28)
  ctx.textAlign = 'left'

  return canvas.toBuffer('image/png')
}

function campo(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, titulo: string, valor: string, x: number, y: number, maxWidth: number) {
  ctx.fillStyle = etiqueta
  ctx.font = '800 18px Arial'
  ctx.fillText(titulo, x, y, maxWidth)
  ctx.fillStyle = tinta
  ctx.font = '700 24px Arial'
  ctx.fillText(valor, x, y + 34, maxWidth)
}

function dibujarBandera(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, w, h / 2)
  ctx.fillStyle = '#d52b1e'
  ctx.fillRect(x, y + h / 2, w, h / 2)
  ctx.fillStyle = '#0039a6'
  ctx.fillRect(x, y, h / 2, h / 2)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 23px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('★', x + h / 4, y + h / 2 - 7)
  ctx.textAlign = 'left'
  ctx.strokeStyle = '#c9c9c9'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
}