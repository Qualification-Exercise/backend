import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttestationEntity } from './entities/attestation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AttestationEntity])],
})
export class AttestationsModule {}
