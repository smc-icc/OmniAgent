-- CreateTable
CREATE TABLE "agent_announcements" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "body" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memos" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "due_at" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_calendar_events" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "kinds" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_announcements_account_id_published_at_idx" ON "agent_announcements"("account_id", "published_at");

-- CreateIndex
CREATE INDEX "agent_memos_user_id_due_at_idx" ON "agent_memos"("user_id", "due_at");

-- CreateIndex
CREATE INDEX "agent_memos_user_id_done_idx" ON "agent_memos"("user_id", "done");

-- CreateIndex
CREATE INDEX "agent_calendar_events_user_id_date_idx" ON "agent_calendar_events"("user_id", "date");

-- AddForeignKey
ALTER TABLE "agent_memos" ADD CONSTRAINT "agent_memos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_calendar_events" ADD CONSTRAINT "agent_calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
