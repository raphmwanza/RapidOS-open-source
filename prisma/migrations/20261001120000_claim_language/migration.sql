-- Language the customer used when filing the claim (claim PDFs are written in it).
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "language" VARCHAR(10);
