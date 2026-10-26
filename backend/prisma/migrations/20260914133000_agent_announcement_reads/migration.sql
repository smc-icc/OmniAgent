-- CreateTable
CREATE TABLE "agent_announcement_reads" (
    "id" SERIAL NOT NULL,
    "announcement_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_announcement_reads_user_id_idx" ON "agent_announcement_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_announcement_reads_announcement_id_user_id_key" ON "agent_announcement_reads"("announcement_id", "user_id");

-- AddForeignKey
ALTER TABLE "agent_announcement_reads" ADD CONSTRAINT "agent_announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "agent_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
