// user.entity.spec.ts
import { User } from './user.entity';

describe('User entity', () => {
    it('generates a UUID on @BeforeInsert', () => {
        const user = new User();
        expect(user.id).toBeUndefined();

        user.generateId();

        expect(user.id).toBeDefined();
        expect(user.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });
});