process.env.DATABASE_URL = `file:./dev-e2e-app-${process.pid}.db`;

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SuperTestApp } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { prepareE2eDatabase } from './e2e-db';

describe('App (e2e)', () => {
  let app: INestApplication | undefined;
  let httpServer: SuperTestApp;

  beforeAll(async () => {
    await prepareE2eDatabase();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as SuperTestApp;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/audits (GET)', async () => {
    const res = await request(httpServer).get('/audits').expect(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('pageSize');
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
