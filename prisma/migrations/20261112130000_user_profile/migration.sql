-- CreateTable
CREATE TABLE "user_profile" (
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(60),
    "street" VARCHAR(255),
    "street2" VARCHAR(255),
    "postal_code" VARCHAR(30),
    "city" VARCHAR(160),
    "country" VARCHAR(120),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
