// src/route/dto/create-route.dto.ts (or wherever CreateRouteDto lives)
export class CreateRouteDto {
    declare origin: string;
    declare destination: string;
    declare description: string;
    declare stages?: string[];
    declare saccoId: string;
    declare fare: string
    declare createReturnLeg?: boolean;
}




export class CreateQueueDto {
    declare routeId: string;
    declare vehicleId: string;
    declare clockedInAt?: Date;
    // "Clock in and open the bay" in one call. Honoured only when nothing is
    // boarding on this route yet; otherwise the vehicle just joins the queue.
    // See RouteQueueService.clockInVehicle.
    declare startBoarding?: boolean;
}
