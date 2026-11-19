CREATE TYPE "ResultadoActuacionTicket" AS ENUM ('EXITOSA', 'FALLIDA', 'REVERTIDA');

ALTER TABLE "actuaciones_ticket"
ADD COLUMN "resultado" "ResultadoActuacionTicket" NOT NULL DEFAULT 'EXITOSA',
ADD COLUMN "motivo" TEXT;
