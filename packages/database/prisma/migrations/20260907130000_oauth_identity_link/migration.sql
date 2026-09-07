-- Google sign-in previously resolved identity by email alone. Registration
-- requires no ownership proof, so an attacker could pre-register a victim's
-- address and be handed that account — and its custodial wallet — when the
-- victim first signed in with Google. Identity now hangs off the provider id.
ALTER TABLE "users" ADD COLUMN "google_id" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
