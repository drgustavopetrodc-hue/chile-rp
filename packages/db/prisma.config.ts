import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// El CLI de Prisma (migrate, db push, studio) usa la conexión DIRECTA de Neon.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL_UNPOOLED'),
  },
})
