import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPassengerEmailToBooking1787127036535 implements MigrationInterface {
    name = 'AddPassengerEmailToBooking1787127036535'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" ADD "passengerEmail" character varying(255)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN "passengerEmail"`);
    }

}
