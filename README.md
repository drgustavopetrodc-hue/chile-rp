# RP Chile

Plataforma del servidor de roleplay de Chile: bot de Discord + base de datos compartida (y, próximamente, la página web).

## Estructura

```
rp-chile/
├── apps/
│   └── bot/            Bot de Discord (discord.js)
├── packages/
│   └── db/             Esquema de Prisma + cliente compartido (Neon/PostgreSQL)
├── package.json        Workspaces de npm
└── README.md
```

La web (Next.js) irá en `apps/web` y usará el mismo paquete `@rp-chile/db`.

## Requisitos

- Node.js 22.12 o superior
- Una base de datos en [Neon](https://neon.tech) (necesitas la cadena *pooled* y la *direct*)
- Una aplicación de bot creada en el Discord Developer Portal

## Puesta en marcha

1. Instalar dependencias (desde la raíz):
   ```bash
   npm install
   ```
2. Variables de entorno. Copia los dos `.env.example` a `.env` y complétalos:
   - `packages/db/.env`: `DATABASE_URL` (pooled) y `DATABASE_URL_UNPOOLED` (direct).
   - `apps/bot/.env`: token del bot, IDs del servidor, roles y canal de revisión, más las mismas dos cadenas de la base de datos.
3. Crear las tablas en Neon y generar el cliente de Prisma:
   ```bash
   npm run migrate -w @rp-chile/db -- --name init
   npm run db:generate
   ```
4. Registrar los comandos del bot (una vez, y cada vez que los cambies):
   ```bash
   npm run bot:deploy-commands
   ```
5. Arrancar el bot en desarrollo:
   ```bash
   npm run bot:dev
   ```
6. En Discord, usa `/panel-verificacion` en tu canal de verificación.

## Configuración en Discord

- En el Developer Portal, sección **Bot**, activa el intent **Server Members**.
- Invita el bot con los scopes `bot` y `applications.commands`, y con permisos para gestionar roles y apodos.
- El rol del bot debe estar **por encima** de los roles *Ciudadano* y *No verificado*.
- Para soportes, el bot también solicita el intent de gateway `GuildVoiceStates` y necesita poder ver y conectarse a los canales de voz privados.

## Estado

- [x] Esquema de base de datos
- [x] Verificación y whitelist de nuevos miembros
- [x] `/cedula`
- [x] Tickets de soporte con derivación, reasignación y transcripción
- [x] Expedientes administrativos, actuaciones y resoluciones persistentes
- [x] Postulaciones a instituciones
- [x] Registro de casos, multas y antecedentes
- [ ] Banco
- [ ] Página web (login con Discord, portal ciudadano, portales institucionales)

## Seguridad

Nunca subas archivos `.env` ni el token del bot a GitHub. El `.gitignore` ya los excluye. Si el token se filtra, regéneralo en el Developer Portal.

La dependencia `@discordjs/node-pre-gyp@0.4.5` declara `tar@^6.1.11`, cuyo último 6.x (`6.2.1`) sigue afectado por avisos de seguridad. Se conserva `tar@7.5.23` mediante el override de la raíz, y el parche versionado en `patches/` amplía el rango declarado a `^7.5.23`; `postinstall` reaplica el parche después de cada instalación. Si se actualiza `tar`, revisa en conjunto el override, el parche y los resultados de `npm audit` y `npm ls tar --all`.

## Tickets y expedientes administrativos

- `/soporte` y el panel `/ticket-panel` conservan el flujo de tickets. Las derivaciones, reasignaciones y cierres se guardan en el historial del ticket, consultable con `/ticket historial`; el cierre sigue archivando primero la transcripción.
- `/expediente crear` recibe una solicitud y genera un folio `ADM-año-secuencia`. El solicitante puede consultar su expediente con `/expediente ver`.
- Un administrador debe configurar las competencias con `/expediente autoridad`, asignando un rol por tipo de solicitud y, opcionalmente, por institución. No se asignan competencias institucionales por defecto. Los roles configurados pueden revisar `/expediente pendientes`, agregar `/expediente nota`, cambiar `/expediente estado` y registrar `/expediente resolver`.
- `/expediente orientar` genera una orientación no vinculante; requiere aceptar explícitamente el envío del texto al proveedor de IA. No modifica el expediente ni reemplaza la decisión de la autoridad humana.

## Despliegue del bot en Railway

El bot necesita un proceso siempre encendido (no sirve Vercel). Railway lo despliega desde GitHub.

1. Sube el repositorio a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo** y elige el repositorio.
3. En los ajustes del servicio:
   - **Root Directory:** déjalo en la raíz del repositorio (así funcionan los workspaces de npm).
   - **Build Command:** `npm run db:generate`
   - **Start Command:** `npm run bot:start`
4. En **Variables** agrega las mismas del `.env` del bot: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `ROL_STAFF_ID`, `ROL_NO_VERIFICADO_ID`, `ROL_CIUDADANO_ID`, `CANAL_REVISION_ID`, `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
5. Antes de desplegar cambios de esquema, respalda la base de datos y coordina la aprobación de la migración. Solo después de autorizarla, aplica las migraciones (`npm run deploy -w @rp-chile/db`) y genera el cliente (`npm run db:generate`). No ejecutes `migrate dev` contra producción. Las migraciones pendientes añaden memoria IA, expedientes y actuaciones administrativas, y el historial de tickets.
6. Cada `git push` a la rama principal vuelve a desplegar el bot automáticamente.

Railway cobra por uso (CPU y memoria por segundo). Revisa el consumo en el panel y configura un límite de gasto.

### Grabaciones de soportes

Las grabaciones requieren un volumen persistente de Railway montado en `/data`. En ejecución, el bot comprueba que `/data` sea un punto de montaje y se niega a grabar si solo encuentra el filesystem efímero. Configura en las variables del servicio:

- `SOPORTE_GRABACIONES_DIR=/data/grabaciones-soporte`
- `SOPORTE_RETENCION_DIAS=30`

El valor de 30 días es la política inicial aprobada y puede modificarse mediante `SOPORTE_RETENCION_DIAS`. Se guarda una pista Ogg Opus por emisor y una mezcla final Ogg Opus; la mezcla incluye los anuncios TTS del bot que ocurren mientras la captura consentida está activa, pero las pistas individuales de participantes permanecen separadas. Se requiere al menos 128 MiB libres para iniciar o continuar una captura. La comprobación de montaje confirma que hay un volumen montado en `/data`, pero la persistencia tras reinicios debe validarse en el servicio Railway configurado.

Antes de grabar, cada participante humano —incluido quien abre el soporte— debe aceptar individualmente mediante el botón. Rechazar impide iniciar y retirar el consentimiento detiene la captura. Si entra alguien nuevo, la grabación se pausa hasta que consienta. El soporte puede continuar sin grabación.

Si un participante retira su consentimiento durante una captura, el bot detiene la grabación, cierra el soporte y registra el motivo en los logs de Moderación y Administración. Elimina automáticamente los canales de voz y evidencias solo cuando el retiro, el cierre y, si hubo grabación finalizada, sus archivos están registrados en todos los logs configurados; si falla una publicación o auditoría, conserva los canales para proteger el acceso a la evidencia.

Los audios finalizados se publican en los canales configurados para logs de moderación y administración, únicamente si el bot comprueba que su lectura está limitada a Staff autorizado. Si la comprobación o la carga falla, el soporte continúa y el expediente conserva los identificadores de los adjuntos; no se anuncian como publicados. La eliminación por retención borra los archivos locales y los mensajes de audio publicados; los eventos de auditoría en la base de datos se conservan. Si la grabación no quedó disponible en ambos logs seguros, no se permite borrar los canales del expediente hasta resolverlo.

El bot no reanuda una captura tras reiniciarse. La recepción requiere que pueda conectarse al canal y recibir paquetes de audio. Las pruebas automatizadas locales validan Opus, la mezcla de dos pistas y la reproducción Ogg, pero no validan conexiones reales de Discord ni la persistencia del volumen Railway. `ffmpeg-static` incorpora un binario FFmpeg bajo GPL-3.0-or-later; revisa sus obligaciones antes de redistribuir el bot o el binario.
"# chile-rp" 
