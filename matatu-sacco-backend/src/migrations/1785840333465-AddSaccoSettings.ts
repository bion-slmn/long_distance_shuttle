import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSaccoSettings1785840333465 implements MigrationInterface {
    name = 'AddSaccoSettings1785840333465'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_active_vehicle_per_queue"`);
        await queryRunner.query(`CREATE TABLE "sacco_settings" ("saccoId" uuid NOT NULL, "commissionRate" numeric(5,2) NOT NULL DEFAULT '10', "isAcceptingBookings" boolean NOT NULL DEFAULT true, "acceptsMpesa" boolean NOT NULL DEFAULT false, "acceptsCash" boolean NOT NULL DEFAULT true, "mpesaShortcode" character varying, "mpesaConsumerKey" character varying, "mpesaConsumerSecretEncrypted" character varying, "mpesaPasskeyEncrypted" character varying, "mpesaConfigured" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3f4051968b2bbfd879a7f2bb9fb" PRIMARY KEY ("saccoId"))`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD CONSTRAINT "FK_3f4051968b2bbfd879a7f2bb9fb" FOREIGN KEY ("saccoId") REFERENCES "saccos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP CONSTRAINT "FK_3f4051968b2bbfd879a7f2bb9fb"`);
        await queryRunner.query(`DROP TABLE "sacco_settings"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_active_vehicle_per_queue" ON "queue_entries" USING btree ("routeQueueId", "vehicleId") WHERE (status = ANY (ARRAY['WAITING'::queue_entries_status_enum, 'BOARDING'::queue_entries_status_enum]))`);
    }

}
