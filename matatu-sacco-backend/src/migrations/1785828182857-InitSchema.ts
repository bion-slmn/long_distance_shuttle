import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1785828182857 implements MigrationInterface {
    name = 'InitSchema1785828182857'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "saccos" ("id" uuid NOT NULL, "name" character varying(150) NOT NULL, "registrationNumber" character varying(50), "contacts" jsonb NOT NULL DEFAULT '[]', "emails" jsonb NOT NULL DEFAULT '[]', "headquarters" character varying(100) NOT NULL DEFAULT 'Nairobi', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2a77e129c5e688993aed9c40e62" UNIQUE ("name"), CONSTRAINT "UQ_f9ee428ca67dd0b91667f7d5942" UNIQUE ("registrationNumber"), CONSTRAINT "PK_a78fdadb99dd6995e4234c562f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('SUPER_ADMIN', 'SACCO_ADMIN', 'CLERK', 'DRIVER', 'PASSENGER')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL, "fullName" character varying(100) NOT NULL, "email" character varying(150), "phoneNumber" character varying(20), "passwordHash" character varying(255) NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'CLERK', "isActive" boolean NOT NULL DEFAULT true, "saccoId" uuid, "assignedStage" character varying(100), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tokenVersion" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_1e3d0240b49c40521aaeb953293" UNIQUE ("phoneNumber"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "routes" ("id" uuid NOT NULL, "saccoId" uuid NOT NULL, "origin" character varying(100) NOT NULL, "destination" character varying(100) NOT NULL, "description" character varying(100) NOT NULL, "fare" numeric(10,2) NOT NULL DEFAULT '0', "stages" jsonb NOT NULL DEFAULT '[]', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_76100511cdfa1d013c859f01d8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."fleet_status_enum" AS ENUM('ACTIVE', 'MAINTENANCE', 'RETIRED')`);
        await queryRunner.query(`CREATE TABLE "fleet" ("id" uuid NOT NULL, "saccoId" uuid NOT NULL, "numberPlate" character varying(20) NOT NULL, "seatingCapacity" integer NOT NULL, "status" "public"."fleet_status_enum" NOT NULL DEFAULT 'ACTIVE', "notes" text, CONSTRAINT "UQ_e506069603b9ba4ecb4b6cd5677" UNIQUE ("numberPlate"), CONSTRAINT "PK_17e0760d2492f67c67ce0fe4aa7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."route_queues_status_enum" AS ENUM('OPEN', 'CLOSED')`);
        await queryRunner.query(`CREATE TABLE "route_queues" ("id" uuid NOT NULL, "routeId" uuid NOT NULL, "queueDate" date NOT NULL, "status" "public"."route_queues_status_enum" NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8ca5fb6cd432fd9819b7d5386e3" UNIQUE ("routeId", "queueDate"), CONSTRAINT "PK_89da37141e5b3a0c80ae81b8966" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."queue_entries_status_enum" AS ENUM('WAITING', 'BOARDING', 'DISPATCHED')`);
        await queryRunner.query(`CREATE TABLE "queue_entries" ("id" uuid NOT NULL, "routeQueueId" uuid NOT NULL, "vehicleId" uuid NOT NULL, "status" "public"."queue_entries_status_enum" NOT NULL DEFAULT 'WAITING', "position" integer NOT NULL, "clockedInAt" TIMESTAMP NOT NULL, "dispatchedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8f43c2075f5188ba3752c7b28e3" UNIQUE ("routeQueueId", "vehicleId"), CONSTRAINT "PK_8e533b14d1153fecfad7767bda5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."trips_status_enum" AS ENUM('BOARDING', 'EN_ROUTE', 'COMPLETED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "trips" ("id" uuid NOT NULL, "departureTime" TIMESTAMP, "completedAt" TIMESTAMP, "fare" numeric(10,2) NOT NULL, "passengerCount" integer NOT NULL DEFAULT '0', "status" "public"."trips_status_enum" NOT NULL DEFAULT 'BOARDING', "saccoId" uuid NOT NULL, "routeId" uuid NOT NULL, "vehicleId" uuid NOT NULL, "driverId" uuid, "queueEntryId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "vehicleCapacity" integer NOT NULL, "travelDate" date NOT NULL, CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."bookings_status_enum" AS ENUM('AWAITING_TRIP', 'CONFIRMED', 'BOARDED', 'CANCELLED', 'NO_SHOW')`);
        await queryRunner.query(`CREATE TYPE "public"."bookings_paymentmethod_enum" AS ENUM('CASH', 'MPESA')`);
        await queryRunner.query(`CREATE TYPE "public"."bookings_paymentstatus_enum" AS ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED')`);
        await queryRunner.query(`CREATE TABLE "bookings" ("id" uuid NOT NULL, "routeId" uuid NOT NULL, "travelDate" date NOT NULL, "tripId" uuid, "seatNumber" integer, "saccoId" uuid NOT NULL, "passengerName" character varying(100) NOT NULL, "passengerPhone" character varying(20) NOT NULL, "fare" numeric(8,2) NOT NULL, "status" "public"."bookings_status_enum" NOT NULL DEFAULT 'AWAITING_TRIP', "paymentMethod" "public"."bookings_paymentmethod_enum" NOT NULL, "paymentStatus" "public"."bookings_paymentstatus_enum" NOT NULL DEFAULT 'PENDING', "mpesaCheckoutRequestId" character varying(50), "mpesaReceiptNumber" character varying(50), "createdByUserId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_09585f1685d2c1ed4cfefa0fd1b" FOREIGN KEY ("saccoId") REFERENCES "saccos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "routes" ADD CONSTRAINT "FK_6d6ecb028ef9b21fd3bc95d504d" FOREIGN KEY ("saccoId") REFERENCES "saccos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fleet" ADD CONSTRAINT "FK_9d4b916869484b8341cdaf94d7a" FOREIGN KEY ("saccoId") REFERENCES "saccos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "route_queues" ADD CONSTRAINT "FK_f79815a0f2dc12ac5589094b04d" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "queue_entries" ADD CONSTRAINT "FK_7dc817477b285069276998f5a35" FOREIGN KEY ("routeQueueId") REFERENCES "route_queues"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "queue_entries" ADD CONSTRAINT "FK_fdb0eae59efad260ba213314188" FOREIGN KEY ("vehicleId") REFERENCES "fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_552f520df1ccb96d3999c85100c" FOREIGN KEY ("saccoId") REFERENCES "saccos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_3fcad6442389eeb7aea5f1f25a8" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_d3cea80b69fc4ecfd2273068395" FOREIGN KEY ("vehicleId") REFERENCES "fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_fc5a8911f85074a660a4304baa1" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_4b5ba3047365eb8457e9e420cd6" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "FK_9cb692ba894df06acfbca67acdf" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "FK_e33f0b046a54956d011b3d377ef" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "FK_e33f0b046a54956d011b3d377ef"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "FK_9cb692ba894df06acfbca67acdf"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_4b5ba3047365eb8457e9e420cd6"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_fc5a8911f85074a660a4304baa1"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_d3cea80b69fc4ecfd2273068395"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_3fcad6442389eeb7aea5f1f25a8"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_552f520df1ccb96d3999c85100c"`);
        await queryRunner.query(`ALTER TABLE "queue_entries" DROP CONSTRAINT "FK_fdb0eae59efad260ba213314188"`);
        await queryRunner.query(`ALTER TABLE "queue_entries" DROP CONSTRAINT "FK_7dc817477b285069276998f5a35"`);
        await queryRunner.query(`ALTER TABLE "route_queues" DROP CONSTRAINT "FK_f79815a0f2dc12ac5589094b04d"`);
        await queryRunner.query(`ALTER TABLE "fleet" DROP CONSTRAINT "FK_9d4b916869484b8341cdaf94d7a"`);
        await queryRunner.query(`ALTER TABLE "routes" DROP CONSTRAINT "FK_6d6ecb028ef9b21fd3bc95d504d"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_09585f1685d2c1ed4cfefa0fd1b"`);
        await queryRunner.query(`DROP TABLE "bookings"`);
        await queryRunner.query(`DROP TYPE "public"."bookings_paymentstatus_enum"`);
        await queryRunner.query(`DROP TYPE "public"."bookings_paymentmethod_enum"`);
        await queryRunner.query(`DROP TYPE "public"."bookings_status_enum"`);
        await queryRunner.query(`DROP TABLE "trips"`);
        await queryRunner.query(`DROP TYPE "public"."trips_status_enum"`);
        await queryRunner.query(`DROP TABLE "queue_entries"`);
        await queryRunner.query(`DROP TYPE "public"."queue_entries_status_enum"`);
        await queryRunner.query(`DROP TABLE "route_queues"`);
        await queryRunner.query(`DROP TYPE "public"."route_queues_status_enum"`);
        await queryRunner.query(`DROP TABLE "fleet"`);
        await queryRunner.query(`DROP TYPE "public"."fleet_status_enum"`);
        await queryRunner.query(`DROP TABLE "routes"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP TABLE "saccos"`);
    }

}
