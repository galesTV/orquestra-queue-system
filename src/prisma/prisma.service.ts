import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('❌ DATABASE_URL não encontrada no arquivo .env');
    }

    const pool = new Pool({ connectionString: connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
    } catch (error) {
      console.error('❌ Erro ao conectar no banco de dados:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
