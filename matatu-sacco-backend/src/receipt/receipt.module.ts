import { Module } from '@nestjs/common';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';
import { ReceiptSigningService } from './receipt-signing.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { BookingModule } from 'src/booking/booking.module';
import { RouteModule } from 'src/route/route.module';

@Module({
  imports: [BookingModule, RouteModule],
  controllers: [ReceiptController],
  providers: [ReceiptService, ReceiptSigningService, ReceiptPdfService]
})
export class ReceiptModule { }
