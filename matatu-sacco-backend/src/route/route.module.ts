import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from './entities/route.entity';
import { RouteService } from './route.service';
import { RouteController } from './route.controller';
import { RouteQueue } from './entities/route-queue.entity';
import { TripModule } from 'src/trip/trip.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Route,
      RouteQueue,
    ]),
    TripModule,
  ],
  controllers: [RouteController],
  providers: [RouteService, RouteQueue],
  exports: [RouteService],
})
export class RouteModule { }