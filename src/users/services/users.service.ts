import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/users/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findByExternalAuthId(externalAuthId: string): Promise<User | null> {
    return this.users.findOne({ where: { externalAuthId } });
  }

  // TODO: implement remaining user management methods
}
