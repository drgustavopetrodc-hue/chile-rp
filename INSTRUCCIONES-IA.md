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

## 3. Conseguir las claves
- **Groq (principal):** https://console.groq.com/keys → "Create API Key" → `GROQ_API_KEY`. El modelo predeterminado es `openai/gpt-oss-120b`.
- **Gemini (respaldo):** entra a https://aistudio.google.com/apikey, inicia sesión con tu cuenta de Google y pulsa "Create API key". Copia la clave en `GEMINI_API_KEY`.
- **OpenRouter (segundo respaldo):** configura `OPENROUTER_API_KEY`; el modelo predeterminado es `inclusionai/ling-3.2-flash:free`.
- Si Groq falla o agota su cupo, el bot prueba Gemini y luego OpenRouter.

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

También puedes mencionar al bot en un canal del servidor para que responda. Las respuestas se publican en contenedores de Components V2.

Al abrir un ticket, la IA responde primero y pide detalles. El creador puede escribir su solicitud o los datos que faltan directamente en el canal: no necesita mencionar al bot. La IA procesa esos mensajes automáticamente y deriva los casos graves a Fundación o Junta Administrativa, los reportes de roleplay y apelaciones a Moderación, y las dudas normales a Soporte. Los IDs configurados por defecto son los que se indicaron para esos cuatro roles; se pueden cambiar con `ROL_FUNDACION_ID`, `ROL_JUNTA_ADMINISTRATIVA_ID`, `ROL_MODERADOR_ID` y `ROL_SOPORTE_ID`.
El propietario del ticket o un miembro del rol asignado puede mencionar al bot y escribir `elimina el ticket`. El bot pide confirmación; al confirmarla, espera 5 segundos, guarda una transcripción HTML descargable y legible en navegador en el canal `1571736144515833898` y luego elimina el canal del ticket. Si no puede guardar la transcripción, conserva el ticket. Un miembro del equipo asignado también puede mencionar al bot y escribir `Reasigna el ticket a Fundación`; el acceso se transfiere al rol de Fundación y se notifica al equipo.

La protección anti-raid vigila creaciones y borrados de canales y roles. Si el mismo actor realiza 3 de estas acciones en 10 segundos, el bot intenta vetarlo y registra la alerta en el canal de logs administrativos. Necesita **Ver registro de auditoría**, **Banear miembros** y una posición superior al actor; Discord no permite restaurar automáticamente los canales o roles borrados.

### Acciones con mención al bot
- Solo miembros de Fundación o Junta Administrativa pueden solicitar las acciones administrativas descritas aquí.
- El bot muestra una confirmación para cada cambio; solo quien lo solicitó puede confirmarlo, dentro de 2 minutos.
- Ejemplos: `@Bot crea un rol "Nombre del rol"`; `@Bot crea el rol "Vice Presidente general" por encima de @Director de Recursos Humanos y que tenga Administrador`; `@Bot crea un rol llamado "Organo de Defensa" debajo de @rol`; `@Bot renombra el rol @rol a "Nuevo nombre"`; `@Bot elimina estos roles @rol1 @rol2`; `@Bot asigna el rol @rol a @persona`; `@Bot quita el rol @rol a @persona`; `@Bot crea canal texto general`; `@Bot renombra el canal #general a "chat"`; `@Bot elimina el canal #general`; `@Bot permite enviar mensajes al rol @rol`; `@Bot permite ver canal #general al rol @rol`; `@Bot banea @persona`; `@Bot desbanea ID`; `@Bot expulsa @persona`; `@Bot timeout @persona por 10 minutos`; `@Bot elimina los últimos 10 mensajes`; `@Bot fija mensaje URL`.
- Los roles creados no reciben permisos salvo que se solicite explícitamente Administrador. Ese permiso concede control total del servidor y siempre aparece en la confirmación antes de aplicarse. La IA no asigna ni configura otros permisos administrativos o de moderación; en roles y canales solo modifica permisos de ver, enviar mensajes, historial, conectar y hablar. Para ubicar un rol encima o debajo de otro, el bot debe tener Gestionar roles y jerarquía suficiente. El bot nunca asigna el nuevo rol a una persona.
- Las acciones no dependen de que los proveedores de IA estén disponibles. No se ejecutan preguntas sobre cómo realizar estas acciones.
- El bot registra la solicitud en el motivo del registro de auditoría de Discord. Estas acciones no requieren que los proveedores de IA estén disponibles.

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
- El bot no decide sanciones por sí solo: solo aplica un veto cuando un miembro autorizado lo solicita explícitamente mediante una mención y una persona mencionada.
