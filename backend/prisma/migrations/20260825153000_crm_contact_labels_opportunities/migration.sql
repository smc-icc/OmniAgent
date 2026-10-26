-- CreateTable
CREATE TABLE "contact_labels" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "label_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "company_id" INTEGER,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "owner_id" INTEGER,
    "expected_close" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "custom_attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_labels_contact_id_label_id_key" ON "contact_labels"("contact_id", "label_id");

-- CreateIndex
CREATE INDEX "contact_labels_label_id_idx" ON "contact_labels"("label_id");

-- CreateIndex
CREATE INDEX "contact_labels_contact_id_idx" ON "contact_labels"("contact_id");

-- CreateIndex
CREATE INDEX "opportunities_account_id_stage_idx" ON "opportunities"("account_id", "stage");

-- CreateIndex
CREATE INDEX "opportunities_contact_id_idx" ON "opportunities"("contact_id");

-- CreateIndex
CREATE INDEX "opportunities_company_id_idx" ON "opportunities"("company_id");

-- CreateIndex
CREATE INDEX "opportunities_owner_id_idx" ON "opportunities"("owner_id");

-- AddForeignKey
ALTER TABLE "contact_labels" ADD CONSTRAINT "contact_labels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_labels" ADD CONSTRAINT "contact_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
