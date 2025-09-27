# Secure MCP Server - Test Suite Documentation

This comprehensive test suite provides enterprise-grade testing coverage for the Secure MCP Server, including unit tests, integration tests, security tests, and performance tests.

## Test Architecture

The test suite is organized using a layered testing approach following the testing pyramid principle:

```
┌─────────────────────┐
│   Performance      │  ← Load, Stress, Capacity Tests
├─────────────────────┤
│    Security        │  ← Penetration, Vulnerability Tests
├─────────────────────┤
│   Integration      │  ← API, WebSocket, End-to-End Tests
├─────────────────────┤
│      Unit          │  ← Component, Service, Function Tests
└─────────────────────┘
```

## Directory Structure

```
tests/
├── setup/                          # Test configuration and setup
│   ├── jest.setup.ts               # Global test setup
│   ├── jest.afterEnv.ts            # Test cleanup
│   ├── global-setup.ts             # Test containers setup
│   ├── global-teardown.ts          # Test containers cleanup
│   └── custom-matchers.ts          # Custom Jest matchers
├── utils/                          # Test utilities and helpers
│   ├── test-helpers.ts             # Test data generators and utilities
│   └── fixtures.ts                 # Static test data and fixtures
├── unit/                           # Unit tests (90%+ coverage target)
│   ├── auth/                       # Authentication service tests
│   ├── security/                   # Security middleware tests
│   ├── server/                     # WebSocket manager tests
│   └── database/                   # Database connection tests
├── integration/                    # Integration tests
│   ├── api/                        # API endpoint tests
│   └── websocket/                  # WebSocket protocol tests
├── security/                       # Security and penetration tests
│   └── penetration-tests.test.ts  # Security vulnerability tests
├── performance/                    # Performance and load tests
│   └── load-tests.test.ts         # Load, stress, and capacity tests
└── README.md                       # This documentation
```

## Test Categories

### 1. Unit Tests (`tests/unit/`)

**Coverage Target:** 90%+ lines, 85%+ branches

Tests individual components in isolation with comprehensive mocking:

- **JWT Service**: Token generation, validation, security features
- **Authentication Middleware**: Request authentication, authorization
- **Security Middleware**: Input sanitization, XSS protection, injection prevention
- **WebSocket Manager**: MCP protocol handling, connection management
- **Database Connections**: Redis operations, connection pooling

**Key Features:**
- Complete isolation using mocks
- Fast execution (< 100ms per test)
- Comprehensive edge case coverage
- Security-focused test scenarios

### 2. Integration Tests (`tests/integration/`)

**Coverage Target:** End-to-end user journeys, API contracts

Tests component interactions and API behavior:

- **Authentication Flows**: Login, MFA, token refresh, logout
- **API Endpoints**: Request/response validation, error handling
- **WebSocket Communication**: MCP protocol compliance
- **Database Integration**: Real data persistence scenarios

**Key Features:**
- Real HTTP requests using Supertest
- Database and Redis integration
- Authentication flow validation
- Error scenario testing

### 3. Security Tests (`tests/security/`)

**Penetration Testing & Vulnerability Assessment:**

- **Injection Attacks**: SQL, NoSQL, Command, XSS prevention
- **Authentication Bypass**: Token manipulation, session fixation
- **Rate Limiting**: DoS protection, abuse prevention
- **Input Validation**: Malicious payload handling
- **Business Logic**: Race conditions, privilege escalation

**Key Features:**
- OWASP Top 10 vulnerability coverage
- Automated security scanning
- Malicious payload testing
- Security event logging validation

### 4. Performance Tests (`tests/performance/`)

**Load Testing & Performance Validation:**

- **Load Tests**: Normal traffic simulation (100 concurrent users)
- **Stress Tests**: Breaking point identification (500+ concurrent users)
- **Spike Tests**: Traffic spike handling
- **Memory Tests**: Memory leak detection
- **Database Performance**: Connection pooling efficiency

**Performance Thresholds:**
- P50 response time: < 100ms
- P95 response time: < 500ms
- P99 response time: < 1000ms
- Error rate: < 1%
- Memory growth: < 10KB per request

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Set up test environment
cp .env.test.example .env.test
```

### Test Commands

```bash
# Run all tests
npm test

# Run specific test categories
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:security      # Security tests only
npm run test:performance   # Performance tests only

# Coverage and reporting
npm run test:coverage      # Generate coverage report
npm run test:ci           # CI/CD optimized run

# Development commands
npm run test:watch        # Watch mode for development
npm run test:debug        # Debug mode with inspector
```

### Test Containers

Integration and performance tests use Testcontainers for isolated testing:

- **PostgreSQL**: Database integration tests
- **Redis**: Caching and session tests
- **Vault**: Secrets management tests

Containers are automatically started/stopped during test runs.

## Test Configuration

### Jest Configuration (`jest.config.js`)

- **TypeScript Support**: SWC-based fast compilation
- **Test Environment**: Node.js with custom setup
- **Coverage Thresholds**: Enforced quality gates
- **Parallel Execution**: Optimized for CI/CD
- **Custom Matchers**: Security-specific assertions

### Environment Configuration (`.env.test`)

Test-specific configuration with:
- Isolated database URLs
- Test-specific secrets
- Reduced timeouts for faster execution
- Disabled external service calls

## Custom Test Utilities

### Test Data Generators (`test-helpers.ts`)

```typescript
// Generate realistic test data
const user = TestDataGenerator.generateUser({
  roles: ['admin'],
  mfaEnabled: true
});

const maliciousPayload = TestDataGenerator.generateMaliciousPayload('sql');
```

### Mock Factory (`MockFactory`)

```typescript
// Create consistent mocks
const mockRedis = MockFactory.createMockRedis();
const mockSocket = MockFactory.createMockSocket();
```

### Performance Helpers (`PerformanceTestHelpers`)

```typescript
// Measure performance
const { result, duration } = await PerformanceTestHelpers.measureExecutionTime(operation);

// Stress testing
const results = await PerformanceTestHelpers.stressTest(operation, {
  concurrent: 100,
  duration: 30000,
  errorThreshold: 0.01
});
```

## Custom Jest Matchers

Security-focused custom matchers for validation:

```typescript
expect(token).toBeValidJWT();
expect(password).toBeSecurePassword();
expect(response).toHaveSecurityHeaders();
expect(input).toMatchSQLPattern();
expect(payload).toMatchXSSPattern();
```

## Test Data Management

### Fixtures (`fixtures.ts`)

Structured test data including:
- User profiles with various permission levels
- JWT payloads for different scenarios
- MCP protocol messages
- Security test payloads
- Performance test configurations

### Test Isolation

- Each test runs in isolation
- Database transactions are rolled back
- Redis keys are namespaced
- Mocks are reset between tests

## CI/CD Integration

### GitHub Actions / GitLab CI

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run test:ci
    - uses: codecov/codecov-action@v3
```

### Coverage Requirements

- **Overall Coverage**: 90% lines, 85% branches
- **Critical Paths**: 95% coverage (auth, security)
- **Quality Gates**: Tests must pass for deployment

## Security Testing Features

### OWASP Top 10 Coverage

1. **Injection**: SQL, NoSQL, Command injection prevention
2. **Broken Authentication**: Session management, JWT security
3. **Sensitive Data Exposure**: Data sanitization, logging security
4. **XML External Entities (XXE)**: Input parsing security
5. **Broken Access Control**: Authorization testing
6. **Security Misconfiguration**: Headers, CORS validation
7. **Cross-Site Scripting (XSS)**: Input/output sanitization
8. **Insecure Deserialization**: JSON parsing security
9. **Known Vulnerabilities**: Dependency scanning
10. **Insufficient Logging**: Security event validation

### Penetration Testing Scenarios

- **Authentication Bypass**: Token manipulation, replay attacks
- **Privilege Escalation**: Role/permission boundary testing
- **Rate Limiting**: DoS protection validation
- **Input Fuzzing**: Malformed data handling
- **Session Security**: Fixation, hijacking prevention

## Performance Testing Strategy

### Load Testing Approach

1. **Baseline Performance**: Establish performance metrics
2. **Load Testing**: Normal traffic simulation
3. **Stress Testing**: Identify breaking points
4. **Spike Testing**: Handle traffic spikes
5. **Volume Testing**: Large data processing
6. **Memory Testing**: Detect memory leaks

### Performance Monitoring

Tests include monitoring for:
- Response times (P50, P95, P99)
- Throughput (requests/second)
- Error rates
- Memory usage
- Database connection efficiency
- Cache hit rates

## Troubleshooting

### Common Issues

**Test Container Startup Failures:**
```bash
# Check Docker daemon
docker ps

# Clean up containers
npm run test:containers:clean
```

**Memory Issues in Performance Tests:**
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run test:performance
```

**Flaky Tests:**
```bash
# Run with increased timeout
JEST_TIMEOUT=60000 npm test

# Run specific test file
npm test -- tests/unit/auth/jwt-service.test.ts
```

### Debug Mode

```bash
# Debug specific test
npm run test:debug -- --testNamePattern="should authenticate user"

# Debug with Chrome DevTools
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Best Practices

### Writing Tests

1. **Follow AAA Pattern**: Arrange, Act, Assert
2. **Use Descriptive Names**: Test intent should be clear
3. **Test One Thing**: Single responsibility per test
4. **Mock External Dependencies**: Isolated unit tests
5. **Use Realistic Test Data**: Representative scenarios

### Security Testing

1. **Think Like an Attacker**: Test malicious scenarios
2. **Cover Edge Cases**: Boundary conditions
3. **Validate Security Events**: Logging and monitoring
4. **Test Error Handling**: Information disclosure prevention
5. **Performance Under Attack**: DoS resilience

### Performance Testing

1. **Establish Baselines**: Know your starting point
2. **Test Realistic Scenarios**: Production-like conditions
3. **Monitor Resource Usage**: CPU, memory, I/O
4. **Test Failure Modes**: Graceful degradation
5. **Automate Performance Regression**: CI/CD integration

## Contributing

When adding new tests:

1. **Follow Naming Conventions**: Clear, descriptive names
2. **Update Coverage Targets**: Maintain quality thresholds
3. **Document Test Purpose**: Comments for complex scenarios
4. **Add Custom Matchers**: Reusable validation logic
5. **Update This README**: Keep documentation current

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest API Testing](https://github.com/visionmedia/supertest)
- [Testcontainers](https://www.testcontainers.org/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [Performance Testing Best Practices](https://martinfowler.com/articles/practical-test-pyramid.html)

---

This test suite provides comprehensive coverage ensuring the Secure MCP Server meets enterprise security, reliability, and performance requirements.