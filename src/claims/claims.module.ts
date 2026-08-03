import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimEntity } from './entities/claim.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClaimEntity])],
})
export class ClaimsModule {}
