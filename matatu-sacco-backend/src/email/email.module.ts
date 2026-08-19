import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService], // <-- this line is required
})
export class EmailModule { }
