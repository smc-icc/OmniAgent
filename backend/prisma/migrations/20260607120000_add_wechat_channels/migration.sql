-- CreateTable
CREATE TABLE "channel_wechat_mp" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_secret" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "encoding_aes_key" TEXT,
    "account_type" TEXT NOT NULL DEFAULT 'service',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_wechat_mp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wecom_kf" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "corp_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "encoding_aes_key" TEXT,
    "open_kfid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_wecom_kf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wecom_contact" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "corp_id" TEXT NOT NULL,
    "contact_secret" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "encoding_aes_key" TEXT,
    "agent_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_wecom_contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_wechat_mp_app_id_key" ON "channel_wechat_mp"("app_id");

-- CreateIndex
CREATE INDEX "channel_wechat_mp_account_id_idx" ON "channel_wechat_mp"("account_id");

-- CreateIndex
CREATE INDEX "channel_wecom_kf_account_id_idx" ON "channel_wecom_kf"("account_id");

-- CreateIndex
CREATE INDEX "channel_wecom_kf_corp_id_idx" ON "channel_wecom_kf"("corp_id");

-- CreateIndex
CREATE INDEX "channel_wecom_contact_account_id_idx" ON "channel_wecom_contact"("account_id");

-- CreateIndex
CREATE INDEX "channel_wecom_contact_corp_id_idx" ON "channel_wecom_contact"("corp_id");
