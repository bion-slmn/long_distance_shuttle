import { PartialType } from '@nestjs/mapped-types';
import { CreateRouteDto } from './create-route.dto';
import { QueueStatus } from '../entities/route-queue.entity';

export class UpdateRouteDto extends PartialType(CreateRouteDto) {}

export class UpdateQueueDto {
  declare status?: QueueStatus;
  declare routeId?: string;
}