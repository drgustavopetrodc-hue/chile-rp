import 'dotenv/config'
import { PrismaClient } from './generated/prisma'
import { PrismaNeon } from '@prisma/adapter-neon'

// En runtime (bot y web) se usa la conexión POOLED de Neon.
const crearCliente = () =>
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  })

// Evita crear varios clientes con el hot-reload de Next.js en desarrollo.
const g = globalThis as unknown as { prisma?: ReturnType<typeof crearCliente> }
export const db = g.prisma ?? crearCliente()
if (process.env.NODE_ENV !== 'production') g.prisma = db

export * from './generated/prisma'
