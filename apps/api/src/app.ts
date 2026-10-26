import 'reflect-metadata';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { loadAuthConfig } from './auth/auth.config.js';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Only the bounded profile text payload needs more room; auth limits stay unchanged.
  app.use('/brands/:id/profile', json({ limit: '64kb' }));
  app.use(json({ limit: '8kb' }));
  app.use(
    (
      error: { status?: number },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (!error) return next();
      const statusCode = error.status === 413 ? 413 : 400;
      res
        .status(statusCode)
        .json({ statusCode, message: 'Invalid request body' });
    },
  );
  const config = new DocumentBuilder()
    .setTitle('SYNVARO API')
    .setDescription(
      'SYNVARO development API: owner-scoped organizations and brands.',
    )
    .addCookieAuth(
      loadAuthConfig().cookieName,
      { type: 'apiKey', in: 'cookie' },
      'session',
    )
    .setVersion('0.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });
  return app;
}
