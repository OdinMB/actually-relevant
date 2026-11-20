-- The lock an Undo of an automated re-center sets, in a column of its own (.context/overviews.md,
-- "Re-centering"; ADR-0071): written into recentered_at/recentered_by, it stood in the way of
-- undoing the re-center before (whose change set names those fields as that re-center left them).
-- Now an Undo puts the last re-center back and stamps only recenter_undone_at, which keeps
-- automation off the overview for 180 days. Additive and nullable: nothing in production holds
-- overview rows yet. Written by hand, as db:migrate:create would write it.

-- AlterTable
ALTER TABLE "overviews" ADD COLUMN     "recenter_undone_at" TIMESTAMP(3);
