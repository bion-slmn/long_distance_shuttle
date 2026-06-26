// scripts/seed-super-admin.ts
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { User, UserRole } from '../auth/entities/user.entity';

async function seedSuperAdmin() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const userRepository = app.get(getRepositoryToken(User));

    const existing = await userRepository.findOne({
        where: { role: UserRole.SUPER_ADMIN },
    });

    if (existing) {
        console.log('A super admin already exists. Aborting.');
        await app.close();
        return;
    }

    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!email || !password) {
        console.log('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars first.');
        await app.close();
        return;
    }

    const passwordHash = await bcrypt.hash(password, 8);

    const admin = userRepository.create({
        fullName: 'System Administrator',
        email: email.toLowerCase().trim(),
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        saccoId: null,
        tokenVersion: 0,
    });

    await userRepository.save(admin);
    console.log(`Super admin created: ${email}`);
    await app.close();
}

seedSuperAdmin();