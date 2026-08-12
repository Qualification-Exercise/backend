import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';
import { ENTITIES } from './entities';
import { migrations } from './migrations';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env>) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_NAME'),
        entities: ENTITIES,
        synchronize: false,
        logging: configService.get('DB_LOGGING'),
        migrations,
        migrationsRun: true,
        migrationsTransactionMode: 'all',
        // ponytail: single-instance assumption — two replicas booting together
        // race on the migrations table. Move to a release-phase step if we scale out.
      }),
    }),
  ],
})
export class DatabaseModule {}
