import { AppDataSource } from './data-source';
import { pino } from 'pino';

const _logger = pino();

async function seed() {
  try {
    await AppDataSource.initialize();
    _logger.info('Database connection established');

    // TODO: Seed reference data
    // Examples:
    // - Supported chains enum values
    // - Default feature flags
    // - Test users (development only)

    _logger.info('Seeding completed');
    await AppDataSource.destroy();
  } catch (error) {
    _logger.error(error, 'Seed failed');
    process.exit(1);
  }
}

seed();
