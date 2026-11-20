CREATE TYPE "EstadoServicioStaff" AS ENUM (
  'ESPERANDO_VOZ',
  'ACTIVO',
  'FINALIZANDO',
  'FINALIZADO',
  'CANCELADO'
);

CREATE TYPE "TipoActividadServicioStaff" AS ENUM (
  'SOPORTE',
  'MOVIMIENTO_VOZ'
);

CREATE TYPE "OrigenGrabacionServicioStaff" AS ENUM (
  'ASISTENCIA_STAFF',
  'SOPORTE'
);

CREATE TYPE "EstadoGrabacionServicioStaff" AS ENUM (
  'PREPARANDO',
  'GRABANDO',
  'FINALIZADA',
  'INTERRUMPIDA',
  'ERROR',
  'SIN_AUDIO'
);

CREATE TABLE "servicios_staff" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "staffDiscordId" TEXT NOT NULL,
  "staffNombre" TEXT NOT NULL,
  "estado" "EstadoServicioStaff" NOT NULL DEFAULT 'ESPERANDO_VOZ',
  "claveActivo" TEXT,
  "canalAsistenciaId" TEXT NOT NULL,
  "canalAvisoId" TEXT NOT NULL,
  "panelCanalId" TEXT,
  "panelMensajeId" TEXT,
  "informeCanalId" TEXT,
  "informeMensajeId" TEXT,
  "iniciadoEn" TIMESTAMP(3),
  "finalizadoEn" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "servicios_staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "actividades_servicio_staff" (
  "id" TEXT NOT NULL,
  "servicioId" TEXT NOT NULL,
  "tipo" "TipoActividadServicioStaff" NOT NULL,
  "titulo" TEXT NOT NULL,
  "detalle" TEXT,
  "soporteId" TEXT,
  "canalAnteriorId" TEXT,
  "canalNuevoId" TEXT,
  "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoEn" TIMESTAMP(3),
  "duracionMs" BIGINT,
  "resultado" TEXT,
  CONSTRAINT "actividades_servicio_staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "grabaciones_servicio_staff" (
  "id" TEXT NOT NULL,
  "servicioId" TEXT NOT NULL,
  "actividadId" TEXT,
  "grabacionId" TEXT NOT NULL,
  "origen" "OrigenGrabacionServicioStaff" NOT NULL,
  "estado" "EstadoGrabacionServicioStaff" NOT NULL DEFAULT 'PREPARANDO',
  "iniciadoEn" TIMESTAMP(3),
  "finalizadoEn" TIMESTAMP(3),
  "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grabaciones_servicio_staff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "servicios_staff_claveActivo_key" ON "servicios_staff"("claveActivo");
CREATE INDEX "servicios_staff_guildId_estado_idx" ON "servicios_staff"("guildId", "estado");
CREATE INDEX "servicios_staff_staffDiscordId_creadoEn_idx" ON "servicios_staff"("staffDiscordId", "creadoEn");
CREATE UNIQUE INDEX "actividades_servicio_staff_soporteId_key" ON "actividades_servicio_staff"("soporteId");
CREATE INDEX "actividades_servicio_staff_servicioId_iniciadoEn_idx" ON "actividades_servicio_staff"("servicioId", "iniciadoEn");
CREATE UNIQUE INDEX "grabaciones_servicio_staff_servicioId_grabacionId_key" ON "grabaciones_servicio_staff"("servicioId", "grabacionId");
CREATE INDEX "grabaciones_servicio_staff_servicioId_creadaEn_idx" ON "grabaciones_servicio_staff"("servicioId", "creadaEn");

ALTER TABLE "actividades_servicio_staff"
ADD CONSTRAINT "actividades_servicio_staff_servicioId_fkey"
FOREIGN KEY ("servicioId") REFERENCES "servicios_staff"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grabaciones_servicio_staff"
ADD CONSTRAINT "grabaciones_servicio_staff_servicioId_fkey"
FOREIGN KEY ("servicioId") REFERENCES "servicios_staff"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grabaciones_servicio_staff"
ADD CONSTRAINT "grabaciones_servicio_staff_actividadId_fkey"
FOREIGN KEY ("actividadId") REFERENCES "actividades_servicio_staff"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
