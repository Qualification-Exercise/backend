import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/users/entities/user.entity';

const PG_UNIQUE_VIOLATION = '23505';

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
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      const existing = await this.users.findOne({
        where: { externalAuthId: data.externalAuthId },
      });
      if (existing) return existing;
      throw err;
    }
  }
}
