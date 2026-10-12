import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    $transaction: jest.fn(),
    establishmentUser: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  let service: AuthService;
  const originalSecret = process.env.AUTH_TOKEN_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_TOKEN_SECRET = 'test-secret-with-at-least-32-characters';
    service = new AuthService(prisma as never);
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
    else process.env.AUTH_TOKEN_SECRET = originalSecret;
  });

  it('issues a token after successful registration', async () => {
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        establishment: { create: jest.fn().mockResolvedValue({ id: 'est-1', name: 'Clinic' }) },
        establishmentUser: {
          create: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'owner@example.com',
            establishmentId: 'est-1',
          }),
        },
      }),
    );

    const result = await service.register({
      establishmentName: 'Clinic',
      email: 'OWNER@example.com',
      password: 'strong-password-123',
    });

    expect(result.email).toBe('owner@example.com');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(service.verifyToken(result.accessToken)).toMatchObject({
      sub: 'user-1',
      establishmentId: 'est-1',
    });
  });

  it('rejects invalid login credentials', async () => {
    prisma.establishmentUser.findUnique.mockResolvedValue(null);
    await expect(service.login({
      email: 'missing@example.com',
      password: 'strong-password-123',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed bearer token payloads', () => {
    expect(() => service.verifyToken('invalid.token')).toThrow(UnauthorizedException);
  });
});
