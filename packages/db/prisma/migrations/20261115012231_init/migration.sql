-- CreateEnum
CREATE TYPE "RolPlataforma" AS ENUM ('JUGADOR', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "EstadoVerificacion" AS ENUM ('PENDIENTE', 'VERIFICADO', 'RECHAZADO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "EstadoDocumento" AS ENUM ('VIGENTE', 'VENCIDO', 'SUSPENDIDO', 'REVOCADO');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('LICENCIA_CONDUCIR', 'PORTE_ARMA', 'PASAPORTE', 'CERTIFICADO_ANTECEDENTES', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoInstitucion" AS ENUM ('GOBIERNO', 'MUNICIPAL', 'JUDICIAL', 'FISCALIA', 'DEFENSORIA', 'POLICIAL', 'SALUD', 'BANCARIA', 'OTRA');

-- CreateEnum
CREATE TYPE "TipoCuenta" AS ENUM ('CORRIENTE', 'VISTA', 'AHORRO', 'EMPRESA');

-- CreateEnum
CREATE TYPE "EstadoCuenta" AS ENUM ('ACTIVA', 'CONGELADA', 'CERRADA');

-- CreateEnum
CREATE TYPE "TipoTransaccion" AS ENUM ('TRANSFERENCIA', 'DEPOSITO', 'RETIRO', 'PAGO_MULTA', 'SUELDO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "TipoCaso" AS ENUM ('PENAL', 'CIVIL', 'FAMILIA', 'ADMINISTRATIVO');

-- CreateEnum
CREATE TYPE "EstadoCaso" AS ENUM ('ABIERTO', 'EN_INVESTIGACION', 'EN_JUICIO', 'CERRADO', 'ARCHIVADO');

-- CreateEnum
CREATE TYPE "RolCaso" AS ENUM ('IMPUTADO', 'VICTIMA', 'TESTIGO', 'QUERELLANTE', 'FISCAL', 'DEFENSOR', 'JUEZ');

-- CreateEnum
CREATE TYPE "EstadoMulta" AS ENUM ('PENDIENTE', 'PAGADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "CategoriaTicket" AS ENUM ('SOPORTE', 'REPORTE', 'APELACION', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoTicket" AS ENUM ('ABIERTO', 'EN_ATENCION', 'CERRADO');

-- CreateEnum
CREATE TYPE "TipoPostulacion" AS ENUM ('WHITELIST', 'INSTITUCION', 'STAFF');

-- CreateEnum
CREATE TYPE "EstadoPostulacion" AS ENUM ('PENDIENTE', 'EN_REVISION', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "rol" "RolPlataforma" NOT NULL DEFAULT 'JUGADOR',
    "verificacion" "EstadoVerificacion" NOT NULL DEFAULT 'PENDIENTE',
    "verificadoEn" TIMESTAMP(3),
    "verificadoPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personajes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "fechaNacimiento" TIMESTAMP(3) NOT NULL,
    "nacionalidad" TEXT NOT NULL DEFAULT 'Chilena',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cedulas" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "numeroSerie" TEXT NOT NULL,
    "emitidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceEn" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'VIGENTE',

    CONSTRAINT "cedulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "numero" TEXT NOT NULL,
    "detalle" JSONB,
    "emitidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceEn" TIMESTAMP(3),
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'VIGENTE',

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instituciones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tipo" "TipoInstitucion" NOT NULL,
    "descripcion" TEXT,
    "discordRoleId" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "instituciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos" (
    "id" TEXT NOT NULL,
    "institucionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL DEFAULT 0,
    "sueldo" BIGINT NOT NULL DEFAULT 0,
    "permisos" TEXT[],
    "discordRoleId" TEXT,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "cargoId" TEXT NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_bancarias" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" "TipoCuenta" NOT NULL DEFAULT 'VISTA',
    "saldo" BIGINT NOT NULL DEFAULT 0,
    "estado" "EstadoCuenta" NOT NULL DEFAULT 'ACTIVA',
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacciones" (
    "id" TEXT NOT NULL,
    "tipo" "TipoTransaccion" NOT NULL,
    "monto" BIGINT NOT NULL,
    "glosa" TEXT,
    "origenId" TEXT,
    "destinoId" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TipoCaso" NOT NULL DEFAULT 'PENAL',
    "estado" "EstadoCaso" NOT NULL DEFAULT 'ABIERTO',
    "institucionId" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "casos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caso_participantes" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "rol" "RolCaso" NOT NULL,

    CONSTRAINT "caso_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multas" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "emisorId" TEXT NOT NULL,
    "casoId" TEXT,
    "motivo" TEXT NOT NULL,
    "monto" BIGINT NOT NULL,
    "estado" "EstadoMulta" NOT NULL DEFAULT 'PENDIENTE',
    "emitidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagadaEn" TIMESTAMP(3),
    "transaccionPagoId" TEXT,

    CONSTRAINT "multas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antecedentes" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "casoId" TEXT,
    "descripcion" TEXT NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3),

    CONSTRAINT "antecedentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "categoria" "CategoriaTicket" NOT NULL DEFAULT 'SOPORTE',
    "asunto" TEXT NOT NULL,
    "estado" "EstadoTicket" NOT NULL DEFAULT 'ABIERTO',
    "canalDiscordId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "asignadoAId" TEXT,
    "transcripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postulaciones" (
    "id" TEXT NOT NULL,
    "tipo" "TipoPostulacion" NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "institucionId" TEXT,
    "respuestas" JSONB NOT NULL,
    "estado" "EstadoPostulacion" NOT NULL DEFAULT 'PENDIENTE',
    "revisorId" TEXT,
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisadaEn" TIMESTAMP(3),

    CONSTRAINT "postulaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "detalle" JSONB,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_discordId_key" ON "usuarios"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "personajes_rut_key" ON "personajes"("rut");

-- CreateIndex
CREATE INDEX "personajes_usuarioId_idx" ON "personajes"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "cedulas_personajeId_key" ON "cedulas"("personajeId");

-- CreateIndex
CREATE UNIQUE INDEX "cedulas_numeroSerie_key" ON "cedulas"("numeroSerie");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_numero_key" ON "documentos"("numero");

-- CreateIndex
CREATE INDEX "documentos_personajeId_tipo_idx" ON "documentos"("personajeId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "instituciones_nombre_key" ON "instituciones"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "instituciones_slug_key" ON "instituciones"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_institucionId_nombre_key" ON "cargos"("institucionId", "nombre");

-- CreateIndex
CREATE INDEX "funcionarios_personajeId_activo_idx" ON "funcionarios"("personajeId", "activo");

-- CreateIndex
CREATE INDEX "funcionarios_cargoId_idx" ON "funcionarios"("cargoId");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_bancarias_numero_key" ON "cuentas_bancarias"("numero");

-- CreateIndex
CREATE INDEX "cuentas_bancarias_personajeId_idx" ON "cuentas_bancarias"("personajeId");

-- CreateIndex
CREATE INDEX "transacciones_origenId_idx" ON "transacciones"("origenId");

-- CreateIndex
CREATE INDEX "transacciones_destinoId_idx" ON "transacciones"("destinoId");

-- CreateIndex
CREATE UNIQUE INDEX "casos_codigo_key" ON "casos"("codigo");

-- CreateIndex
CREATE INDEX "casos_estado_idx" ON "casos"("estado");

-- CreateIndex
CREATE INDEX "caso_participantes_personajeId_idx" ON "caso_participantes"("personajeId");

-- CreateIndex
CREATE UNIQUE INDEX "caso_participantes_casoId_personajeId_rol_key" ON "caso_participantes"("casoId", "personajeId", "rol");

-- CreateIndex
CREATE UNIQUE INDEX "multas_transaccionPagoId_key" ON "multas"("transaccionPagoId");

-- CreateIndex
CREATE INDEX "multas_personajeId_estado_idx" ON "multas"("personajeId", "estado");

-- CreateIndex
CREATE INDEX "antecedentes_personajeId_vigente_idx" ON "antecedentes"("personajeId", "vigente");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_numero_key" ON "tickets"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_canalDiscordId_key" ON "tickets"("canalDiscordId");

-- CreateIndex
CREATE INDEX "tickets_estado_idx" ON "tickets"("estado");

-- CreateIndex
CREATE INDEX "postulaciones_estado_tipo_idx" ON "postulaciones"("estado", "tipo");

-- CreateIndex
CREATE INDEX "auditoria_entidad_entidadId_idx" ON "auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "auditoria_actorId_idx" ON "auditoria"("actorId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_verificadoPorId_fkey" FOREIGN KEY ("verificadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personajes" ADD CONSTRAINT "personajes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedulas" ADD CONSTRAINT "cedulas_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionarios" ADD CONSTRAINT "funcionarios_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionarios" ADD CONSTRAINT "funcionarios_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_bancarias" ADD CONSTRAINT "cuentas_bancarias_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "cuentas_bancarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "cuentas_bancarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casos" ADD CONSTRAINT "casos_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casos" ADD CONSTRAINT "casos_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caso_participantes" ADD CONSTRAINT "caso_participantes_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "casos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caso_participantes" ADD CONSTRAINT "caso_participantes_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "personajes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "casos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multas" ADD CONSTRAINT "multas_transaccionPagoId_fkey" FOREIGN KEY ("transaccionPagoId") REFERENCES "transacciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedentes" ADD CONSTRAINT "antecedentes_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedentes" ADD CONSTRAINT "antecedentes_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "casos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asignadoAId_fkey" FOREIGN KEY ("asignadoAId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postulaciones" ADD CONSTRAINT "postulaciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postulaciones" ADD CONSTRAINT "postulaciones_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postulaciones" ADD CONSTRAINT "postulaciones_revisorId_fkey" FOREIGN KEY ("revisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
