import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppointmentsController } from '../src/appointments/appointments.controller';
import { AppointmentsService } from '../src/appointments/appointments.service';

describe('Appointments request validation (e2e)', () => {
  let app: INestApplication;

  const appointmentsService = {
    create: jest.fn().mockResolvedValue({ accepted: true }),
    update: jest.fn().mockResolvedValue({ updated: true }),
  };

  const validAppointment = {
    startTime: '2026-10-15T14:30:00.000Z',
    customerId: 'a1b2c3d4-e5f6-4789-8123-123456789abc',
    establishmentId: 'b2c3d4e5-f6a7-4890-9234-23456789abcd',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        {
          provide: AppointmentsService,
          useValue: appointmentsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a valid appointment payload', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send(validAppointment)
      .expect(201)
      .expect({ accepted: true });
  });

  it('rejects a malformed start time', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({ ...validAppointment, startTime: 'not-a-date' })
      .expect(400);
  });

  it('rejects impossible calendar dates', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({ ...validAppointment, startTime: '2026-02-30T14:30:00.000Z' })
      .expect(400);
  });

  it('rejects invalid UUIDs', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({ ...validAppointment, customerId: 'customer-123' })
      .expect(400);
  });

  it('rejects missing required fields', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({ customerId: validAppointment.customerId })
      .expect(400);
  });

  it('rejects properties that are not part of the DTO', () => {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({ ...validAppointment, unexpectedField: true })
      .expect(400);
  });

  it('allows partial updates while still validating provided fields', async () => {
    await request(app.getHttpServer())
      .patch('/appointments/appointment-id')
      .send({ startTime: validAppointment.startTime })
      .expect(200)
      .expect({ updated: true });

    await request(app.getHttpServer())
      .patch('/appointments/appointment-id')
      .send({ startTime: 'not-a-date' })
      .expect(400);
  });
});
