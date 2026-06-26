export class CreateRouteDto { }


export class CreateQueueDto {
    declare routeId: string;
    declare vehicleId: string;
    declare clockedInAt?: Date;
}
