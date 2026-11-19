# Portal institucional de RP Chile

Aplicación web de presentación del proyecto ficticio de roleplay RP Chile.
Esta etapa incluye únicamente la portada institucional; no implementa
autenticación, consultas ni trámites.

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
