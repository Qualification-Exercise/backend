import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have repository injected', () => {
    expect(repository).toBeDefined();
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      const userId = 'test-id';
      const user = { id: userId, email: 'test@example.com' } as User;
      jest.spyOn(repository, 'findOne').mockResolvedValue(user);

      const result = await service.findById(userId);

      expect(result).toEqual(user);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
      });
    });

    it('should return null if user not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new user', async () => {
      const data = {
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };
      const createdUser = { id: 'new-id', ...data } as User;
      jest.spyOn(repository, 'create').mockReturnValue(createdUser);
      jest.spyOn(repository, 'save').mockResolvedValue(createdUser);

      const result = await service.create(data);

      expect(result).toEqual(createdUser);
      expect(repository.create).toHaveBeenCalledWith(data);
      expect(repository.save).toHaveBeenCalledWith(createdUser);
    });

    it('should return existing user on unique violation (23505)', async () => {
      const data = {
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };
      const existingUser = {
        id: 'existing-id',
        email: data.email,
        externalAuthId: data.externalAuthId,
      } as User;
      const mockEntity = { ...data } as User;
      jest.spyOn(repository, 'create').mockReturnValue(mockEntity);
      jest
        .spyOn(repository, 'save')
        .mockRejectedValueOnce({ code: '23505' } as never);
      jest.spyOn(repository, 'findOne').mockResolvedValueOnce(existingUser);

      const result = await service.create(data);

      expect(result).toEqual(existingUser);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { externalAuthId: data.externalAuthId },
      });
    });

    it('should throw error if not a unique violation', async () => {
      const data = {
        externalAuthId: 'google-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };
      const mockEntity = { ...data } as User;
      jest.spyOn(repository, 'create').mockReturnValue(mockEntity);
      jest
        .spyOn(repository, 'save')
        .mockRejectedValueOnce({ code: 'OTHER_ERROR' } as never);
      jest.spyOn(repository, 'findOne').mockResolvedValueOnce(null);

      await expect(service.create(data)).rejects.toMatchObject({
        code: 'OTHER_ERROR',
      });
    });
  });
});
