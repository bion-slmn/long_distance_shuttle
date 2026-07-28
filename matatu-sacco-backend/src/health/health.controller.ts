// src/health/health.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { HealthService } from './health.service';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from 'src/auth/entities/user.entity';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) { }

  @Get('system')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  getSystemHealth() {
    return this.healthService.getSystemHealth();
  }
}