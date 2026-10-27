/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // TypeScript configuration
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: false,
      tsconfig: 'tsconfig.test.json'
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol)/)'
  ],

  // Test configuration
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/tests/**/*.test.ts',
  ],

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },

  // Extensions to consider
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/types/**/*.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'html',
    'json',
    'cobertura'
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/auth/': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/security/': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/server/': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  // testTimeout: 30000, // Moved to project configs

  // Global setup and teardown (disabled for CI)
  // globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  // globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',

  // Parallel execution
  maxWorkers: '50%',

  // Error handling
  bail: false,
  errorOnDeprecated: true,

  // Reporting
  verbose: true,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: './test-results',
      outputName: 'jest-junit.xml',
    }],
    ['jest-html-reporters', {
      publicPath: './test-results',
      filename: 'jest-report.html',
      expand: true,
    }]
  ],

  // Mock configuration
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Watch mode configuration
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/test-results/',
  ],

  // Performance
  detectOpenHandles: true,
  detectLeaks: true,
  forceExit: true,

  // Custom matchers
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/jest.afterEnv.ts',
    '<rootDir>/tests/setup/custom-matchers.ts'
  ],

  // Test categorization
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'security',
      testMatch: ['<rootDir>/tests/security/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'performance',
      testMatch: ['<rootDir>/tests/performance/**/*.test.ts'],
      testEnvironment: 'node',
    },
  ],
};