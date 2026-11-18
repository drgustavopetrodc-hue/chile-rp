CREATE TABLE "memoria_ia" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "mensajeUsuario" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memoria_ia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memoria_ia_guildId_channelId_usuarioId_creadoEn_idx"
    ON "memoria_ia"("guildId", "channelId", "usuarioId", "creadoEn");

CREATE INDEX "memoria_ia_creadoEn_idx" ON "memoria_ia"("creadoEn");
