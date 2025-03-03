import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP service
  await app.listen(3006);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
