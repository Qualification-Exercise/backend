import { Module } from '@nestjs/common';

import { ConfigController } from '@/config/controllers/config.controller';

@Module({ controllers: [ConfigController] })
export class AppConfigModule {}
