import { IsNotEmpty, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EClientType } from '../enums/client-type.enum';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'Google ID token from client',
    example:
      'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIn0.signature',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({
    description: 'Client platform type',
    enum: EClientType,
    example: 'ios',
  })
  @IsEnum(EClientType)
  @IsNotEmpty()
  type: EClientType;
}
