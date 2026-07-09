// src/route/dto/create-route.dto.ts (or wherever CreateRouteDto lives)
export class CreateRouteDto {
    declare origin: string;
    declare destination: string;
    declare description: string;
    declare stages?: string[];
    declare saccoId: string;
    declare fare: string
}




export class CreateQueueDto {
    declare routeId: string;
    declare vehicleId: string;
    declare clockedInAt?: Date;
}
