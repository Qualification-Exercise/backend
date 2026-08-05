module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  // @tetherto/wdk-utils and its @noble/@scure deps ship ESM only; the app is
  // CommonJS, so let ts-jest down-level them instead of skipping node_modules.
  transformIgnorePatterns: ['/node_modules/(?!(@tetherto|@noble|@scure)/)'],
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.entity.ts',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/migrations/**',
    '!database/seed.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['clover', 'json', 'json-summary', 'lcov', 'text'],
  testEnvironment: 'node',
  roots: ['<rootDir>', '<rootDir>/../test'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  coverageThreshold: {
    global: {
      branches: 84,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
