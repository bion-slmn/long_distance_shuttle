import { PartialType } from '@nestjs/mapped-types';
import { CreateRouteDto } from './create-route.dto';
import { QueueStatus } from '../entities/route-queue.entity';

export class UpdateRouteDto {
  declare origin?: string;
  declare destination?: string;
  declare description?: string;
  declare stages?: string[];
  declare isActive?: boolean;
  declare fare?: string
}

export class UpdateQueueDto {
  declare status?: QueueStatus;
  declare routeId?: string;
}

