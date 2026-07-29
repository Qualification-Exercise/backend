import { AppDataSource } from './data-source';
import { pino } from 'pino';
import { User } from '@/users/entities/user.entity';

const _logger = pino();

export const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

async function seed() {
  try {
    await AppDataSource.initialize();
    _logger.info('Database connection established');

    // Seed test user for development
    if (process.env.NODE_ENV === 'development') {
      const userRepo = AppDataSource.getRepository(User);
      const existingUser = await userRepo.findOne({
        where: { id: TEST_USER_ID },
      });

      if (existingUser) {
        _logger.info(`Test user already exists: ${TEST_USER_ID}`);
      } else {
        const testUser = userRepo.create({
          id: TEST_USER_ID,
          externalAuthId: 'test-google-sub',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        });
        await userRepo.save(testUser);
        _logger.info(`Test user created: ${TEST_USER_ID}`);
      }
    }

    _logger.info('Seeding completed');
    await AppDataSource.destroy();
  } catch (error) {
    _logger.error(error, 'Seed failed');
    process.exit(1);
  }
}

seed();
