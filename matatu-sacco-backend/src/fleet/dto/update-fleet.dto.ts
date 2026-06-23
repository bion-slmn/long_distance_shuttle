import { PartialType } from '@nestjs/mapped-types';
import { CreateFleetDto } from './create-fleet.dto';

export class UpdateFleetDto extends PartialType(CreateFleetDto) {}
