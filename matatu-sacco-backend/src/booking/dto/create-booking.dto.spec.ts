import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';
import { PaymentMethod } from '../entities/booking.entity';

// Runs the DTO through the same transform+validate path the global
// ValidationPipe uses, so these prove what real requests get.
const check = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateBookingDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

const clerkWalkIn = {
  routeId: '018f6b3e-7c2a-7b1e-9c4d-2a3b4c5d6e7f',
  passengerName: 'Walk-in passenger',
  passengerPhone: '0712345678',
  paymentMethod: PaymentMethod.CASH,
};

describe('CreateBookingDto', () => {
  it('accepts a clerk walk-in with a phone number and no email', async () => {
    const { messages } = await check(clerkWalkIn);
    expect(messages).toEqual([]);
  });

  it('treats a blank email field as absent rather than invalid', async () => {
    const { dto, messages } = await check({ ...clerkWalkIn, passengerEmail: '   ' });
    expect(messages).toEqual([]);
    expect(dto.passengerEmail).toBeUndefined();
  });

  it('still rejects a malformed email when one is given', async () => {
    const { messages } = await check({ ...clerkWalkIn, passengerEmail: 'not-an-email' });
    expect(messages).toEqual(['passengerEmail must be a valid email address.']);
  });

  it('accepts a real email', async () => {
    const { messages } = await check({ ...clerkWalkIn, passengerEmail: 'jane@example.com' });
    expect(messages).toEqual([]);
  });

  it('still requires the phone number', async () => {
    const { messages } = await check({ ...clerkWalkIn, passengerPhone: undefined });
    expect(messages.join(' ')).toMatch(/passengerPhone/);
  });
});
