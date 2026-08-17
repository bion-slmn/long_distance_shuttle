// src/payment/dto/mpesa-callback.dto.ts

export class MpesaCallbackItemDto {
  declare Name: string;
  declare Value?: string | number;
}

export class MpesaCallbackMetadataDto {
  declare Item: MpesaCallbackItemDto[];
}

export class MpesaStkCallbackDto {
  declare MerchantRequestID: string;
  declare CheckoutRequestID: string;
  declare ResultCode: number;
  declare ResultDesc: string;
  declare CallbackMetadata?: MpesaCallbackMetadataDto;
}

export class MpesaCallbackBodyDto {
  declare stkCallback: MpesaStkCallbackDto;
}

export class MpesaCallbackDto {
  declare Body: MpesaCallbackBodyDto;
}