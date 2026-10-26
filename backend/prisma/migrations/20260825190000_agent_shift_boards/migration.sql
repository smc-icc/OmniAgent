-- CreateTable
CREATE TABLE "agent_shift_boards" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '默认排班',
    "rhythm" TEXT NOT NULL DEFAULT '3-2',
    "sequence" JSONB NOT NULL DEFAULT '["day","mid","night","off"]',
    "start_date" DATE NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 30,
    "need_per_shift" INTEGER NOT NULL DEFAULT 2,
    "time_day" TEXT NOT NULL DEFAULT '08:00-16:00',
    "time_mid" TEXT NOT NULL DEFAULT '16:00-00:00',
    "time_night" TEXT NOT NULL DEFAULT '00:00-08:00',
    "hours_per_shift" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "hourly_rate" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "night_bonus" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "theme" TEXT NOT NULL DEFAULT 'blue',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_shift_boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_shift_staff" (
    "id" SERIAL NOT NULL,
    "board_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_shift_staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_shift_leaves" (
    "id" SERIAL NOT NULL,
    "board_id" INTEGER NOT NULL,
    "staff_name" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'leave',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_shift_leaves_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_shift_manuals" (
    "id" SERIAL NOT NULL,
    "board_id" INTEGER NOT NULL,
    "staff_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_shift_manuals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_shift_notes" (
    "id" SERIAL NOT NULL,
    "board_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_shift_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_shift_boards_account_id_idx" ON "agent_shift_boards"("account_id");
CREATE INDEX "agent_shift_boards_owner_id_idx" ON "agent_shift_boards"("owner_id");
CREATE INDEX "agent_shift_staff_board_id_idx" ON "agent_shift_staff"("board_id");
CREATE INDEX "agent_shift_leaves_board_id_idx" ON "agent_shift_leaves"("board_id");
CREATE INDEX "agent_shift_manuals_board_id_idx" ON "agent_shift_manuals"("board_id");
CREATE UNIQUE INDEX "agent_shift_manuals_board_id_staff_name_date_key" ON "agent_shift_manuals"("board_id", "staff_name", "date");
CREATE INDEX "agent_shift_notes_board_id_idx" ON "agent_shift_notes"("board_id");
CREATE UNIQUE INDEX "agent_shift_notes_board_id_date_key" ON "agent_shift_notes"("board_id", "date");

ALTER TABLE "agent_shift_boards" ADD CONSTRAINT "agent_shift_boards_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shift_staff" ADD CONSTRAINT "agent_shift_staff_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "agent_shift_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shift_leaves" ADD CONSTRAINT "agent_shift_leaves_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "agent_shift_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shift_manuals" ADD CONSTRAINT "agent_shift_manuals_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "agent_shift_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shift_notes" ADD CONSTRAINT "agent_shift_notes_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "agent_shift_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
