CREATE TYPE "PrioridadTicket" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');
CREATE TYPE "EquipoTicket" AS ENUM ('FUNDACION', 'JUNTA_ADMINISTRATIVA', 'MODERACION', 'SOPORTE');
CREATE TYPE "TipoActuacionTicket" AS ENUM ('APERTURA', 'DERIVACION', 'REASIGNACION', 'CIERRE');
CREATE TYPE "TipoExpedienteAdministrativo" AS ENUM ('PETICION', 'RECLAMO', 'RECURSO', 'DENUNCIA', 'CONSULTA', 'OTRO');
CREATE TYPE "EstadoExpedienteAdministrativo" AS ENUM ('RECIBIDO', 'EN_REVISION', 'EN_TRAMITACION', 'RESUELTO', 'ARCHIVADO');
CREATE TYPE "TipoActuacionAdministrativa" AS ENUM ('RECEPCION', 'NOTA', 'CAMBIO_ESTADO', 'REAPERTURA', 'RESOLUCION', 'ARCHIVO');
CREATE TYPE "ResultadoResolucionAdministrativa" AS ENUM ('ACOGIDA', 'PARCIAL', 'RECHAZADA', 'INADMISIBLE');

ALTER TABLE "tickets"
ADD COLUMN "prioridad" "PrioridadTicket" NOT NULL DEFAULT 'MEDIA',
ADD COLUMN "equipoAsignado" "EquipoTicket",
ADD COLUMN "resumen" TEXT,
ADD COLUMN "asignadoEn" TIMESTAMP(3),
ADD COLUMN "cerradoPorDiscordId" TEXT;

CREATE TABLE "actuaciones_ticket" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "tipo" "TipoActuacionTicket" NOT NULL,
    "equipoAnterior" "EquipoTicket",
    "equipoNuevo" "EquipoTicket",
    "prioridadAnterior" "PrioridadTicket",
    "prioridadNueva" "PrioridadTicket",
    "detalle" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actuaciones_ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "secuencias_expediente_administrativo" (
    "anio" INTEGER NOT NULL,
    "siguiente" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "secuencias_expediente_administrativo_pkey" PRIMARY KEY ("anio")
);

CREATE TABLE "expedientes_administrativos" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "solicitanteId" TEXT NOT NULL,
    "tipo" "TipoExpedienteAdministrativo" NOT NULL,
    "institucionId" TEXT,
    "asunto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "EstadoExpedienteAdministrativo" NOT NULL DEFAULT 'RECIBIDO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "expedientes_administrativos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "actuaciones_administrativas" (
    "id" TEXT NOT NULL,
    "expedienteId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "tipo" "TipoActuacionAdministrativa" NOT NULL,
    "estadoAnterior" "EstadoExpedienteAdministrativo",
    "estadoNuevo" "EstadoExpedienteAdministrativo",
    "contenido" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actuaciones_administrativas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resoluciones_administrativas" (
    "id" TEXT NOT NULL,
    "expedienteId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "resultado" "ResultadoResolucionAdministrativa" NOT NULL,
    "decision" TEXT NOT NULL,
    "fundamento" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resoluciones_administrativas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "autoridades_administrativas" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tipo" "TipoExpedienteAdministrativo" NOT NULL,
    "alcance" TEXT NOT NULL,
    "institucionId" TEXT,
    "rolDiscordId" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autoridades_administrativas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expedientes_administrativos_folio_key" ON "expedientes_administrativos"("folio");
CREATE INDEX "expedientes_administrativos_guildId_estado_creadoEn_idx" ON "expedientes_administrativos"("guildId", "estado", "creadoEn");
CREATE INDEX "expedientes_administrativos_solicitanteId_creadoEn_idx" ON "expedientes_administrativos"("solicitanteId", "creadoEn");
CREATE INDEX "expedientes_administrativos_tipo_institucionId_estado_idx" ON "expedientes_administrativos"("tipo", "institucionId", "estado");
CREATE INDEX "actuaciones_administrativas_expedienteId_creadaEn_idx" ON "actuaciones_administrativas"("expedienteId", "creadaEn");
CREATE INDEX "resoluciones_administrativas_expedienteId_creadaEn_idx" ON "resoluciones_administrativas"("expedienteId", "creadaEn");
CREATE UNIQUE INDEX "autoridades_administrativas_guildId_tipo_alcance_key" ON "autoridades_administrativas"("guildId", "tipo", "alcance");
CREATE INDEX "autoridades_administrativas_guildId_rolDiscordId_idx" ON "autoridades_administrativas"("guildId", "rolDiscordId");
CREATE INDEX "actuaciones_ticket_ticketId_creadaEn_idx" ON "actuaciones_ticket"("ticketId", "creadaEn");
CREATE INDEX "tickets_equipoAsignado_estado_idx" ON "tickets"("equipoAsignado", "estado");

ALTER TABLE "actuaciones_administrativas"
ADD CONSTRAINT "actuaciones_administrativas_expedienteId_fkey"
FOREIGN KEY ("expedienteId") REFERENCES "expedientes_administrativos"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resoluciones_administrativas"
ADD CONSTRAINT "resoluciones_administrativas_expedienteId_fkey"
FOREIGN KEY ("expedienteId") REFERENCES "expedientes_administrativos"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expedientes_administrativos"
ADD CONSTRAINT "expedientes_administrativos_solicitanteId_fkey"
FOREIGN KEY ("solicitanteId") REFERENCES "usuarios"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expedientes_administrativos"
ADD CONSTRAINT "expedientes_administrativos_institucionId_fkey"
FOREIGN KEY ("institucionId") REFERENCES "instituciones"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "autoridades_administrativas"
ADD CONSTRAINT "autoridades_administrativas_institucionId_fkey"
FOREIGN KEY ("institucionId") REFERENCES "instituciones"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "actuaciones_ticket"
ADD CONSTRAINT "actuaciones_ticket_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
