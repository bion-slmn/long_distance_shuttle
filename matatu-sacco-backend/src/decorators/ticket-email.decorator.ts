// src/decorators/ticket-email.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const TicketEmail = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): string => {
        const request = ctx.switchToHttp().getRequest();
        return request.ticketEmail;
    },
);