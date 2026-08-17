import { MigrationInterface, QueryRunner } from "typeorm";

export class AllowRepeatVehicleAfterDispatch1785837374894 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Drop the blanket constraint that blocks a vehicle from
        // clocking in more than once per route-queue per day.
        await queryRunner.query(`
            ALTER TABLE "queue_entries" DROP CONSTRAINT "UQ_8f43c2075f5188ba3752c7b28e3"
        `);

        // Replace with a partial unique index: only blocks duplicates
        // while the entry is still WAITING or BOARDING. A vehicle can
        // have multiple DISPATCHED rows for the same route+day (round trips).
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_active_vehicle_per_queue"
            ON "queue_entries" ("routeQueueId", "vehicleId")
            WHERE status IN ('WAITING', 'BOARDING')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "UQ_active_vehicle_per_queue"
        `);

        await queryRunner.query(`
            ALTER TABLE "queue_entries" ADD CONSTRAINT "UQ_8f43c2075f5188ba3752c7b28e3" UNIQUE ("routeQueueId", "vehicleId")
        `);
    }

}
