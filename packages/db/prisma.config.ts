import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

// Generar el cliente no requiere conexión; las operaciones de base usan la URL directa de Neon.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
})
