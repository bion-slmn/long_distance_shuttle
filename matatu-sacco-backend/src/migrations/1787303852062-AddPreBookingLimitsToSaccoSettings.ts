import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPreBookingLimitsToSaccoSettings1787303852062 implements MigrationInterface {
    name = 'AddPreBookingLimitsToSaccoSettings1787303852062'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "preBookingEnabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "preBookingMorningStart" TIME NOT NULL DEFAULT '05:00:00'`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "preBookingMorningEnd" TIME NOT NULL DEFAULT '10:00:00'`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "preBookingMaxMorningVehicles" integer NOT NULL DEFAULT '4'`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "preBookingMaxSeatsPerTrip" integer NOT NULL DEFAULT '4'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "preBookingMaxSeatsPerTrip"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "preBookingMaxMorningVehicles"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "preBookingMorningEnd"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "preBookingMorningStart"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "preBookingEnabled"`);
    }

}
