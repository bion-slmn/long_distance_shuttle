import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fleet } from './entities/fleet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Fleet])],
  controllers: [FleetController],
  providers: [FleetService],
})
export class FleetModule { }
