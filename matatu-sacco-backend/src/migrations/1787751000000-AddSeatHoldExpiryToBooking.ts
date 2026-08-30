import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeatHoldExpiryToBooking1787751000000 implements MigrationInterface {
    name = 'AddSeatHoldExpiryToBooking1787751000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "bookings" ADD "holdExpiresAt" TIMESTAMP WITH TIME ZONE`,
        );

        // Partial index: occupancy queries only ever ask about live holds, and
        // holds are a small minority of rows (most bookings are PAID, so this
        // column is null for them).
        await queryRunner.query(
            `CREATE INDEX "IDX_bookings_hold_expires_at" ON "bookings" ("tripId", "holdExpiresAt") WHERE "holdExpiresAt" IS NOT NULL`,
        );

        // Existing CONFIRMED + PENDING rows get a null holdExpiresAt, which
        // reads as "hold already lapsed" — so any seat stranded by the old
        // behaviour (payment never resolved, booking never cancelled, seat
        // blocked forever) becomes bookable again the moment this ships.
        // That is the intended outcome: those payments can no longer succeed.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_bookings_hold_expires_at"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN "holdExpiresAt"`);
    }

}
