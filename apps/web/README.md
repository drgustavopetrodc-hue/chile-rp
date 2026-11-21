# Portal institucional de RP Chile

Aplicación web de presentación del proyecto ficticio de roleplay RP Chile.
El portal permite iniciar sesión con Discord. Las consultas y los trámites
continúan en desarrollo.

## Desarrollo local

Desde la raíz del monorepo, instala las dependencias con `npm install` si aún
no están instaladas y ejecuta:

```bash
npm run dev -w @rp-chile/web
```

La aplicación estará disponible en `http://localhost:3000`.

## Comprobaciones

```bash
npm run typecheck -w @rp-chile/web
npm run build -w @rp-chile/web
```

## Inicio de sesión con Discord

La autenticación usa Auth.js con el proveedor Discord y sesiones JWT cifradas.
Solo se solicita el scope `identify`; no se solicita el correo electrónico.
Al iniciar sesión se crea o actualiza el perfil existente en `Usuario` mediante
`@rp-chile/identity`. No se requieren cambios al esquema Prisma ni migraciones.

Configura estas variables exclusivamente en el entorno del servidor:

- `DISCORD_CLIENT_ID`: ID de la aplicación OAuth de Discord.
- `DISCORD_CLIENT_SECRET`: secreto OAuth de Discord.
- `SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres para firmar y
  cifrar la sesión. `NEXTAUTH_SECRET` se acepta como alternativa.
- `NEXTAUTH_URL`: URL pública base de la aplicación. En producción debe ser el
  dominio público de Railway; en local, `http://localhost:3000`.
- `DATABASE_URL`: conexión existente a Neon usada para crear/actualizar el
  perfil en `Usuario`.

La URL de callback que debe registrarse en Discord Developer Portal es
`<NEXTAUTH_URL>/api/auth/callback/discord`. Registra una URL de desarrollo y
otra de producción en sus respectivas aplicaciones OAuth cuando sea necesario.
No se necesita `DISCORD_REDIRECT_URI`: Auth.js construye el callback a partir
de `NEXTAUTH_URL`.

En Railway, configura las variables como secretos/variables del servicio web y
usa la URL pública actual en `NEXTAUTH_URL`. Cuando el dominio propio esté
configurado, actualiza esa URL y la callback correspondiente en Discord. No
habilites scopes adicionales ni compartas el secreto del cliente con el
navegador.
