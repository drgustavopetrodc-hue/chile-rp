-- AlterTable
ALTER TABLE "personajes" ADD COLUMN     "crimenDisponibleEn" TIMESTAMP(3),
ADD COLUMN     "diarioDisponibleEn" TIMESTAMP(3),
ADD COLUMN     "dinero" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "dineroSucio" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "lavadoDisponibleEn" TIMESTAMP(3),
ADD COLUMN     "trabajoDisponibleEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" BIGINT NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_items" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventario_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "patente" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT,
    "personajeId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_economia" (
    "id" TEXT NOT NULL,
    "personajeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" BIGINT NOT NULL,
    "descripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_economia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_servidor" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_servidor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_nombre_key" ON "items"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_items_personajeId_itemId_key" ON "inventario_items"("personajeId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_patente_key" ON "vehiculos"("patente");

-- CreateIndex
CREATE INDEX "vehiculos_personajeId_activo_idx" ON "vehiculos"("personajeId", "activo");

-- CreateIndex
CREATE INDEX "movimientos_economia_personajeId_creadoEn_idx" ON "movimientos_economia"("personajeId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "configuracion_servidor_clave_key" ON "configuracion_servidor"("clave");

-- AddForeignKey
ALTER TABLE "inventario_items" ADD CONSTRAINT "inventario_items_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_items" ADD CONSTRAINT "inventario_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_economia" ADD CONSTRAINT "movimientos_economia_personajeId_fkey" FOREIGN KEY ("personajeId") REFERENCES "personajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
