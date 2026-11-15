export class RobloxLookupError extends Error {}

const maximoBytes = 5 * 1024 * 1024

export async function obtenerAvatarRoblox(username: string) {
  const solicitado = username.trim().replace(/^@/, '')
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(solicitado)) {
    throw new RobloxLookupError('El usuario Roblox debe tener entre 3 y 20 letras, números o guiones bajos.')
  }

  let respuesta: Response
  try {
    respuesta = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [solicitado], excludeBannedUsers: true }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new RobloxLookupError('No se pudo conectar con Roblox para validar el usuario.')
  }
  if (!respuesta.ok) throw new RobloxLookupError(`Roblox no pudo validar el usuario (HTTP ${respuesta.status}).`)

  const resultado = await respuesta.json() as { data?: { id: number; name: string }[] }
  const usuario = resultado.data?.find((item) => item.name.toLowerCase() === solicitado.toLowerCase())
  if (!usuario) throw new RobloxLookupError('No se encontró ese usuario de Roblox.')

  let miniatura: Response
  try {
    miniatura = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${usuario.id}&size=420x420&format=Png&isCircular=false`,
      { signal: AbortSignal.timeout(10_000) },
    )
  } catch {
    throw new RobloxLookupError('No se pudo obtener el avatar de Roblox.')
  }
  if (!miniatura.ok) throw new RobloxLookupError('Roblox no pudo generar la miniatura del avatar.')
  const datos = await miniatura.json() as { data?: { imageUrl: string; state: string }[] }
  const imagen = datos.data?.[0]
  if (!imagen || imagen.state !== 'Completed') throw new RobloxLookupError('El avatar todavía no está disponible en Roblox.')

  const url = new URL(imagen.imageUrl)
  if (!url.hostname.endsWith('.rbxcdn.com') && url.hostname !== 'rbxcdn.com') {
    throw new RobloxLookupError('Roblox devolvió un dominio de imagen no permitido.')
  }
  let descarga: Response
  try {
    descarga = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new RobloxLookupError('No se pudo descargar el avatar de Roblox.')
  }
  if (!descarga.ok || !descarga.headers.get('content-type')?.startsWith('image/')) {
    throw new RobloxLookupError('La imagen del avatar no es válida.')
  }
  const buffer = Buffer.from(await descarga.arrayBuffer())
  if (!buffer.length || buffer.length > maximoBytes) throw new RobloxLookupError('El avatar descargado supera el tamaño permitido.')
  return { username: usuario.name, avatar: buffer }
}