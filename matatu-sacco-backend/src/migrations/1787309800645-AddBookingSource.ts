import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBookingSource1234567890123 implements MigrationInterface {
    name = 'AddBookingSource1234567890123'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Create the Postgres enum type for BookingSource
        await queryRunner.query(`
            CREATE TYPE "public"."bookings_source_enum" AS ENUM('CLERK', 'PUBLIC_PORTAL')
        `);

        // 2. Add the column as nullable first — can't backfill a NOT NULL
        //    column that doesn't exist yet
        await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD COLUMN "source" "public"."bookings_source_enum"
        `);

        // 3. Backfill existing rows based on the createdByUserId convention:
        //    non-null createdByUserId => a clerk recorded it, otherwise
        //    it came through the public portal.
        await queryRunner.query(`
            UPDATE "bookings"
            SET "source" = CASE
                WHEN "createdByUserId" IS NOT NULL THEN 'CLERK'::"public"."bookings_source_enum"
                ELSE 'PUBLIC_PORTAL'::"public"."bookings_source_enum"
            END
        `);

        // 4. Now that every row has a value, enforce NOT NULL going forward
        await queryRunner.query(`
            ALTER TABLE "bookings"
            ALTER COLUMN "source" SET NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "bookings"
            DROP COLUMN "source"
        `);

        await queryRunner.query(`
            DROP TYPE "public"."bookings_source_enum"
        `);
    }
}