-- Anti-sybil: track registration IP + device id per account
ALTER TABLE "users" ADD COLUMN "registration_ip" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "device_id" VARCHAR(64);
CREATE INDEX "users_registration_ip_idx" ON "users"("registration_ip");
CREATE INDEX "users_device_id_idx" ON "users"("device_id");
