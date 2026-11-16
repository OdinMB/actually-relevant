-- The Dashboard's spending overview (services/spending.ts, .context/scheduler.md, "Spending"):
-- what each job spent per UTC month, written by every finished run, and the warning levels.

-- CreateTable
CREATE TABLE "job_month_spend" (
    "job_name" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "standard_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "search_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "search_credits" INTEGER NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_month_spend_pkey" PRIMARY KEY ("job_name","month")
);

-- CreateTable
CREATE TABLE "spend_warnings" (
    "scope" TEXT NOT NULL,
    "level_usd" INTEGER NOT NULL,

    CONSTRAINT "spend_warnings_pkey" PRIMARY KEY ("scope")
);
