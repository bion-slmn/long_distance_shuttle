// route.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';
import { Route } from './entities/route.entity';
import { RouteQueue } from './entities/route-queue.entity';
import { QueueEntry } from './entities/queue-entry.entity'; // ← add this import
import { TripModule } from 'src/trip/trip.module'; // adjust path if different

@Module({
  imports: [
    TypeOrmModule.forFeature([Route, RouteQueue, QueueEntry]), // ← add QueueEntry here
    TripModule,
  ],
  controllers: [RouteController],
  providers: [RouteService],
  exports: [RouteService],
})
export class RouteModule { }