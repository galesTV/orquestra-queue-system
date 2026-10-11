import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureGlobalValidation } from './common/configure-global-validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureGlobalValidation(app);

  app.enableShutdownHooks();

  app.enableCors({
    origin: 'http://localhost:3001',
    methods: 'GET, HEAD, PUT, PATCH, POST, DELETE',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
