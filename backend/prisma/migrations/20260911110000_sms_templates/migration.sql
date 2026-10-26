-- 短信模板：班长（administrator）维护，坐席只能选用 approved 模板并填变量。
-- 合规：正文与签名受控（对应运营商报备的完整模板），坐席不可自由改写；
-- provider_template_id 为运营商报备返回的模板 ID，接入正式短信网关时必填。
CREATE TABLE IF NOT EXISTS "sms_templates" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(40) NOT NULL DEFAULT 'notice',
    "signature" VARCHAR(40) NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "provider" VARCHAR(40),
    "provider_template_id" VARCHAR(120),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sms_templates_account_id_status_idx" ON "sms_templates"("account_id", "status");
CREATE INDEX IF NOT EXISTS "sms_templates_account_id_name_idx" ON "sms_templates"("account_id", "name");
