import { MigrationInterface, QueryRunner } from "typeorm";

// The sacco can see a vehicle load and see it leave; it cannot see it arrive,
// and the vehicle may never come back to this stage. So the trip lifecycle is
// BOARDING -> DEPARTED (terminal) | CANCELLED. EN_ROUTE promised a follow-up
// that often could not happen, and COMPLETED was only ever a "vehicle clocked
// in again" mark, not an arrival. Both fold into DEPARTED.
//
// Postgres cannot drop a value from an enum, so the type is rebuilt.
export class DropCompletedRenameEnRouteToDeparted1788400000000 implements MigrationInterface {
    name = 'DropCompletedRenameEnRouteToDeparted1788400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."trips_status_enum" RENAME TO "trips_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."trips_status_enum" AS ENUM('BOARDING', 'DEPARTED', 'CANCELLED')`);
        await queryRunner.query(`ALTER TABLE "trips" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(
            `ALTER TABLE "trips" ALTER COLUMN "status" TYPE "public"."trips_status_enum" USING (
                CASE "status"::text
                    WHEN 'EN_ROUTE' THEN 'DEPARTED'
                    WHEN 'COMPLETED' THEN 'DEPARTED'
                    ELSE "status"::text
                END
            )::"public"."trips_status_enum"`,
        );
        await queryRunner.query(`ALTER TABLE "trips" ALTER COLUMN "status" SET DEFAULT 'BOARDING'`);
        await queryRunner.query(`DROP TYPE "public"."trips_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // COMPLETED rows were folded into DEPARTED on the way up; they come
        // back as EN_ROUTE, which is the closest surviving meaning.
        await queryRunner.query(`ALTER TYPE "public"."trips_status_enum" RENAME TO "trips_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."trips_status_enum" AS ENUM('BOARDING', 'EN_ROUTE', 'COMPLETED', 'CANCELLED')`);
        await queryRunner.query(`ALTER TABLE "trips" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(
            `ALTER TABLE "trips" ALTER COLUMN "status" TYPE "public"."trips_status_enum" USING (
                CASE "status"::text
                    WHEN 'DEPARTED' THEN 'EN_ROUTE'
                    ELSE "status"::text
                END
            )::"public"."trips_status_enum"`,
        );
        await queryRunner.query(`ALTER TABLE "trips" ALTER COLUMN "status" SET DEFAULT 'BOARDING'`);
        await queryRunner.query(`DROP TYPE "public"."trips_status_enum_old"`);
    }
}
