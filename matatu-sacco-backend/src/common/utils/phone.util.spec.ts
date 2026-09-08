import { normalizePhone, phoneLookupForms } from './phone.util';

describe('normalizePhone', () => {
    it.each([
        ['0712345678', '254712345678'],
        ['+254712345678', '254712345678'],
        ['254712345678', '254712345678'],
        ['712345678', '254712345678'],
        ['0112345678', '254112345678'],
        [' 0712 345 678 ', '254712345678'],
        ['0712-345-678', '254712345678'],
    ])('canonicalises %s to %s', (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it('returns null for empty or missing input', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone('   ')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone(undefined)).toBeNull();
    });

    it('keeps the bare digits of a number it does not recognise as Kenyan', () => {
        expect(normalizePhone('+44 7700 900123')).toBe('447700900123');
    });
});

describe('phoneLookupForms', () => {
    it('covers the typed, canonical and local spellings of a Kenyan number', () => {
        expect(phoneLookupForms('+254712345678')).toEqual(
            expect.arrayContaining(['+254712345678', '254712345678', '0712345678']),
        );
    });

    it('does not duplicate when the typed form is already canonical', () => {
        expect(phoneLookupForms('254712345678')).toEqual(['254712345678', '0712345678']);
    });

    it('falls back to the digits alone for a non-Kenyan number', () => {
        expect(phoneLookupForms('+44 7700 900123')).toEqual(['+44 7700 900123', '447700900123']);
    });
});
