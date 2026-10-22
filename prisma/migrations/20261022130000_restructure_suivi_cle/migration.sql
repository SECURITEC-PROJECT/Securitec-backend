-- DropTable
DROP TABLE "suivi_cle";

-- CreateTable
CREATE TABLE "suivi_cle" (
    "id" SERIAL NOT NULL,
    "trousse_cle" VARCHAR(100) NOT NULL,
    "lieu" VARCHAR(255) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "personne_habilitee" VARCHAR(100) NOT NULL,
    "matricule_personne" VARCHAR(50),
    "agent_gardien" VARCHAR(50) NOT NULL,
    "heure" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suivi_cle_pkey" PRIMARY KEY ("id")
);