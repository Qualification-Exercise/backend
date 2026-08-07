import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '@/common/database/pg-errors';
import { User } from '@/users/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByExternalAuthId(externalAuthId: string): Promise<User | null> {
    return this.users.findOne({ where: { externalAuthId } });
  }

  async create(
    data: Pick<User, 'externalAuthId' | 'email' | 'firstName' | 'lastName'>,
  ): Promise<User> {
    try {
      return await this.users.save(this.users.create(data));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.users.findOne({
        where: { externalAuthId: data.externalAuthId },
      });
      if (existing) return existing;
      throw err;
    }
  }
}
