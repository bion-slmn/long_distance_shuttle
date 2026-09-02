// src/payment/mpesa/mpesa-c2b-registration.listener.spec.ts
import { MpesaC2bRegistrationListener } from './mpesa-c2b-registration.listener';

describe('MpesaC2bRegistrationListener', () => {
    let listener: MpesaC2bRegistrationListener;
    let mpesaService: { registerC2BUrls: jest.Mock };
    let warnSpy: jest.SpyInstance;

    const event = { saccoId: 'sacco-1', shortcode: '600984' };

    beforeEach(() => {
        mpesaService = { registerC2BUrls: jest.fn() };
        listener = new MpesaC2bRegistrationListener(mpesaService as any);
        warnSpy = jest
            .spyOn((listener as any).logger, 'warn')
            .mockImplementation(() => undefined);
    });

    it('registers the C2B URLs for the sacco whose M-Pesa config was just saved', async () => {
        mpesaService.registerC2BUrls.mockResolvedValue({ responseDescription: 'Success' });

        await listener.handleMpesaConfigured(event);

        expect(mpesaService.registerC2BUrls).toHaveBeenCalledWith('sacco-1');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('never throws when Daraja is down — the credential save must still succeed', async () => {
        mpesaService.registerC2BUrls.mockRejectedValue(
            new Error('Failed to register M-Pesa C2B URLs: Service is currently unreachable.'),
        );

        await expect(listener.handleMpesaConfigured(event)).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Service is currently unreachable'));
    });
});
