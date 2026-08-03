import { AppDataSource } from './data-source';
import { pino } from 'pino';
import { User } from '@/users/entities/user.entity';
import { SignerEntity } from '@/signers/entities/signer.entity';
import { ESignerRole } from '@/signers/enums/signer-role.enum';

const _logger = pino();

export const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * The Sepolia demo signer set, matching `contract/deployments/11155111.json`.
 * Addresses only: the matching private keys live encrypted in each process's
 * own environment, never in a row anyone can `SELECT`.
 */
const DEMO_SIGNERS = [
  {
    role: ESignerRole.ISSUER,
    address: '0xf4B48550B9D15d419f77727107fd3cAF0c160DEc',
    label: 'issuer-a',
  },
  {
    role: ESignerRole.RELAYER,
    address: '0x95FA3C48A38077e20b47c8Ef426597a7e1F112ab',
    label: 'relayer',
  },
  {
    role: ESignerRole.GUARDIAN,
    address: '0x5CBC57Ab603208eC26CDBB5cc54c99c7fb1C0c89',
    label: 'guardian',
  },
];

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

    // Signers are reference data, not test data: the relayer checks an
    // attestation's author against this table before spending gas on it.
    const signerRepo = AppDataSource.getRepository(SignerEntity);
    const chainId = Number(process.env.REWARD_CHAIN_ID ?? 11155111);
    for (const signer of DEMO_SIGNERS) {
      const existing = await signerRepo.findOne({
        where: { role: signer.role, address: signer.address },
      });
      if (existing) {
        _logger.info(
          `Signer already registered: ${signer.role} ${signer.address}`,
        );
        continue;
      }
      await signerRepo.save(
        signerRepo.create({ ...signer, chainId, active: true }),
      );
      _logger.info(`Signer registered: ${signer.role} ${signer.address}`);
    }

    _logger.info('Seeding completed');
    await AppDataSource.destroy();
  } catch (error) {
    _logger.error(error, 'Seed failed');
    process.exit(1);
  }
}

if (require.main === module) {
  seed();
}
