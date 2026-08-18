// data-source.ts
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

export default new DataSource(
    databaseUrl
        ? {
            type: 'postgres',
            url: databaseUrl,
            ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
            entities: ['src/**/*.entity.ts'],
            migrations: ['src/migrations/*.ts'],
            synchronize: false,
        }
        : {
            type: 'postgres',
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            entities: ['src/**/*.entity.ts'],
            migrations: ['src/migrations/*.ts'],
            synchronize: false,
        },
);