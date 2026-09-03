import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { isValidC2bToken, isValidCallbackToken } from './callback-token';

// A bad token gets a plain 404 so the endpoint is indistinguishable from a
// non-existent path to anyone probing for it. See callback-token.ts for the
// layering; the STK per-payment nonce is checked in PaymentService, where
// the payment row is at hand.

// STK callback: /payment/mpesa/callback/:token/:nonce
@Injectable()
export class MpesaCallbackTokenGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        if (!isValidCallbackToken(request.params?.token)) {
            throw new NotFoundException();
        }
        return true;
    }
}

// C2B validation/confirmation: /payment/c2b/<kind>/:saccoId/:token
@Injectable()
export class MpesaC2bCallbackGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const { saccoId, token } = context.switchToHttp().getRequest().params ?? {};
        if (!isValidC2bToken(saccoId, token)) {
            throw new NotFoundException();
        }
        return true;
    }
}
