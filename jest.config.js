/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test configuration
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.spec.ts',
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],

  // TypeScript configuration
  transform: {
    '^.+\\.ts$': ['@swc/jest', {
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
          dynamicImport: true,
        },
        target: 'es2020',
        keepClassNames: true,
        loose: true,
      },
      module: {
        type: 'commonjs',
      },
    }],
  },

  // Module resolution
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },

  // Setup files
  setupFiles: ['<rootDir>/tests/setup/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.afterEnv.ts'],

  // Coverage configuration
  collectCoverage: true,
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

  // Test environment configuration
  testEnvironment: 'node',
  testTimeout: 30000,

  // Global setup and teardown
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',

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
      testTimeout: 60000,
    },
    {
      displayName: 'security',
      testMatch: ['<rootDir>/tests/security/**/*.test.ts'],
      testEnvironment: 'node',
      testTimeout: 120000,
    },
    {
      displayName: 'performance',
      testMatch: ['<rootDir>/tests/performance/**/*.test.ts'],
      testEnvironment: 'node',
      testTimeout: 300000,
    },
  ],
};