-- Data only, no schema change. Feedback stored before the keyed hash (ADR-0037) went live
-- carries an unkeyed SHA-256 of the sender's IP, which is reversible by brute force over the
-- IPv4 space. Nothing reads ip_hash back, and the old values cannot match keyed ones, so they
-- are blanked; the messages stay. The column is NOT NULL, hence '' rather than NULL.
-- Cutoff: the keyed hash reached production on 2026-10-12 shortly before 23:00 UTC; clearing a
-- few keyed values from just before the cutoff costs nothing.
UPDATE "feedback"
SET "ip_hash" = ''
WHERE "created_at" < '2026-10-12 23:00:00+00'
  AND "ip_hash" <> '';
