import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterEstablishmentDto } from './dto/register-establishment.dto';

type TokenPayload = {
  sub: string;
  establishmentId: string;
  exp: number;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterEstablishmentDto) {
    this.assertSecretConfigured();
    const email = dto.email.trim().toLowerCase();
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync(dto.password, salt, 64).toString('hex')}`;

    try {
      const owner = await this.prisma.$transaction(async (tx) => {
        const establishment = await tx.establishment.create({
          data: { name: dto.establishmentName.trim() },
        });
        return tx.establishmentUser.create({
          data: { email, passwordHash, establishmentId: establishment.id },
          select: { id: true, email: true, establishmentId: true },
        });
      });
      return { ...owner, accessToken: this.createToken(owner.id, owner.establishmentId) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    this.assertSecretConfigured();
    const owner = await this.prisma.establishmentUser.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!owner || !this.verifyPassword(dto.password, owner.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return {
      id: owner.id,
      email: owner.email,
      establishmentId: owner.establishmentId,
      accessToken: this.createToken(owner.id, owner.establishmentId),
    };
  }

  verifyToken(token: string): TokenPayload {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const expected = this.sign(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    let decoded: TokenPayload;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid access token.');
    }
    if (
      !decoded.sub ||
      !decoded.establishmentId ||
      !Number.isFinite(decoded.exp) ||
      decoded.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException('Expired or invalid access token.');
    }
    return decoded;
  }

  private createToken(userId: string, establishmentId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        establishmentId,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
      }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private assertSecretConfigured(): string {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('AUTH_TOKEN_SECRET must contain at least 32 characters.');
    }
    return secret;
  }

  private sign(payload: string): string {
    const secret = this.assertSecretConfigured();
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, expectedHex, extra] = storedHash.split(':');
    if (!salt || !expectedHex || extra) return false;
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
