export function mencionBotAlFinal(texto: string, botId: string) {
  const mencion = new RegExp(`<@!?${botId}>`)
  const coincidencias = [...texto.matchAll(new RegExp(mencion.source, 'g'))]
  const ultima = coincidencias.at(-1)
  if (!ultima || ultima.index === undefined) return false
  return /^[\s.,!?;:]*$/.test(texto.slice(ultima.index + ultima[0].length))
}
