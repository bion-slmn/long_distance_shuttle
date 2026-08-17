import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPreferredBoardingWindowToBookings1786651375343 implements MigrationInterface {
    name = 'AddPreferredBoardingWindowToBookings1786651375343'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" ADD "preferredBoardingFrom" TIME`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD "preferredBoardingTo" TIME`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN "preferredBoardingTo"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN "preferredBoardingFrom"`);
    }

}
