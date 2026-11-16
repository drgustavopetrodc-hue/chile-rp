# Agregar la IA gratuita al bot

## 1. Copiar los archivos
Copia estas dos carpetas dentro de tu proyecto (respeta las rutas):
- `apps/bot/src/utils/ia.ts`
- `apps/bot/src/commands/ia.ts`

Mantén `Normativa General Chile.pdf` en la raíz del proyecto. El bot busca los pasajes relevantes en todo el documento y los usa como fuente oficial.
Para asuntos del servidor, todas las funciones de IA (incluidas las menciones al bot) usan el PDF y las instrucciones complementarias; si difieren, prevalece el PDF. También puede contestar preguntas generales ajenas al servidor. Para datos específicos como el nombre del fundador, agréguelo en `/ia reglas`; si no está en las fuentes, la IA no lo inventará.

## 2. Registrar el comando
En `apps/bot/src/commands/index.ts` agrega estas dos cosas:

1. Debajo de los demás `import`:
   ```ts
   import { ia } from './ia'
   ```
2. Al final de la lista `comandos`, agrega `ia`:
   ```ts
   export const comandos: Comando[] = [ ..., codigoPenal, ia ]
   ```

## 3. Conseguir las claves (gratis)
- **Gemini (principal):** entra a https://aistudio.google.com/apikey, inicia sesión con tu cuenta de Google y pulsa "Create API key". Copia la clave en `GEMINI_API_KEY`.
- **Groq (respaldo):** https://console.groq.com/keys → "Create API Key" → `GROQ_API_KEY`. El modelo predeterminado es `openai/gpt-oss-120b`.
- **OpenRouter (segundo respaldo):** configura `OPENROUTER_API_KEY`; el modelo gratuito predeterminado es `inclusionai/ling-3.2-flash:free`.
- Con una sola clave ya funciona. Con las dos, si Gemini agota su cupo el bot pasa a Groq automáticamente.

Las claves van en `apps/bot/.env` (y en *Variables* de Railway). Nunca las subas a GitHub.

## 4. Registrar y probar
```bash
npm run bot:deploy-commands
npm run bot:dev
```
En Discord (como administrador):
1. `/ia estado probar:True` → debe mostrar "✅ respondió ...".
2. Opcional: `/ia reglas archivo:` (sube un .txt con instrucciones complementarias) o `/ia reglas texto:`.
3. `/ia preguntar pregunta:¿Qué pasa si hago RDM?`

También puedes mencionar al bot en un canal del servidor para que responda. Está sujeto a los mismos límites diarios y espera entre usos.

Al abrir un ticket, la IA responde primero y pide detalles; después deriva los casos graves a Fundación o Junta Administrativa, los reportes de roleplay y apelaciones a Moderación, y las dudas normales a Soporte. Los IDs configurados por defecto son los que se indicaron para esos cuatro roles; se pueden cambiar con `ROL_FUNDACION_ID`, `ROL_JUNTA_ADMINISTRATIVA_ID`, `ROL_MODERADOR_ID` y `ROL_SOPORTE_ID`.

## Comandos
| Comando | Quién | Qué hace |
|---|---|---|
| `/ia preguntar` | todos | Responde dudas usando la normativa oficial y las instrucciones complementarias |
| `/ia redactar` | todos | Borrador de parte policial, resolución, certificado, comunicado o informe |
| `/ia resumir` | staff | Resume los últimos mensajes del canal (útil en tickets) |
| `/ia reglas` | administradores | Agrega instrucciones complementarias a la normativa oficial |
| `/ia estado` | administradores | Proveedores, uso del día y prueba de conexión |
| `/ia activar` | administradores | Enciende o apaga la IA |

## Límites y cuidado del cupo gratuito
- El bot no impone límites diarios ni espera entre usos. Las cuotas, límites de solicitudes/tokens y posibles costos de Gemini, Groq u OpenRouter siguen aplicando. Las variables antiguas `IA_LIMITE_USUARIO_DIARIO`, `IA_LIMITE_GLOBAL_DIARIO` e `IA_COOLDOWN_SEGUNDOS` ya no tienen efecto.
- Los planes gratuitos pueden usar lo que envías para mejorar sus modelos. No cargues datos personales reales ni información privada de jugadores.
- Los cupos y los nombres de modelos gratuitos cambian. Si `/ia estado probar:True` falla, revisa en Google AI Studio qué modelo está disponible y ponlo en `GEMINI_MODEL`.
- La IA nunca sanciona ni decide nada: solo responde, redacta borradores y resume.
