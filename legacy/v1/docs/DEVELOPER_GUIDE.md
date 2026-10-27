# Developer Guide

## Secure MCP Server - Development Documentation

### Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Architecture Overview](#architecture-overview)
4. [Code Structure](#code-structure)
5. [Development Workflow](#development-workflow)
6. [API Development](#api-development)
7. [Tool Development](#tool-development)
8. [Testing Guidelines](#testing-guidelines)
9. [Code Quality Standards](#code-quality-standards)
10. [Security Guidelines](#security-guidelines)
11. [Performance Guidelines](#performance-guidelines)
12. [Contributing Guidelines](#contributing-guidelines)
13. [Release Process](#release-process)

## Getting Started

### Prerequisites

- Node.js 20+ and npm 10+
- Docker Desktop 4.0+
- Git 2.30+
- Visual Studio Code (recommended)
- PostgreSQL client tools
- Redis client tools

### Quick Start

```bash
# Clone the repository
git clone https://github.com/enterprise/secure-mcp-server.git
cd secure-mcp-server

# Install dependencies
npm install

# Set up environment
cp .env.example .env.development
# Edit .env.development with your local settings

# Start development dependencies
docker-compose -f docker-compose.dev.yml up -d

# Initialize database
npm run db:migrate:dev
npm run db:seed:dev

# Start development server with hot reload
npm run dev

# In another terminal, run tests in watch mode
npm run test:watch
```

## Development Environment Setup

### Required Tools Installation

```bash
# macOS
brew install node@20 postgresql redis docker kubectl helm
brew install --cask visual-studio-code docker postman

# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm postgresql-client redis-tools docker.io
sudo snap install code postman kubectl helm

# Windows (using Chocolatey)
choco install nodejs postgresql redis docker-desktop vscode postman
```

### VSCode Extensions

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-azuretools.vscode-docker",
    "ms-kubernetes-tools.vscode-kubernetes-tools",
    "prisma.prisma",
    "redhat.vscode-yaml",
    "streetsidesoftware.code-spell-checker",
    "wayou.vscode-todo-highlight",
    "gruntfuggly.todo-tree",
    "eamodio.gitlens",
    "mhutchie.git-graph",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "visualstudioexptteam.vscodeintellicode",
    "ms-vscode.vscode-typescript-tslint-plugin"
  ]
}
```

### VSCode Settings

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "typescript.updateImportsOnFileMove.enabled": "always",
  "typescript.preferences.importModuleSpecifier": "relative",
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.git": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/coverage": true
  },
  "todo-tree.general.tags": [
    "TODO",
    "FIXME",
    "HACK",
    "NOTE",
    "SECURITY",
    "PERFORMANCE"
  ]
}
```

### Environment Configuration

```bash
# .env.development
NODE_ENV=development
PORT=3000
HOST=localhost

# Database
DATABASE_URL=postgresql://dev_user:dev_password@localhost:5432/mcp_development
DATABASE_LOG=true
DATABASE_POOL_MIN=1
DATABASE_POOL_MAX=5

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=dev_password

# Authentication
JWT_SECRET=development_jwt_secret_change_in_production
JWT_EXPIRY=1d
REFRESH_TOKEN_EXPIRY=7d

# Security (relaxed for development)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
RATE_LIMIT_ENABLED=false
HTTPS_ENABLED=false

# Logging
LOG_LEVEL=debug
LOG_FORMAT=pretty

# Development tools
DEBUG=mcp:*
REPL_ENABLED=true
SWAGGER_ENABLED=true
```

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  MCP Client │  │  Web Client │  │   CLI Tool  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         └─────────────────┼─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                      Transport Layer                         │
│  ┌─────────────────────────────────────────────────┐        │
│  │            WebSocket / HTTP Gateway              │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Auth Service  │  │Tool Registry │  │Context Mgmt  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Rate Limiter  │  │  Validator   │  │   Logger     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                       Data Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  PostgreSQL  │  │    Redis     │  │    Vault     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Design Patterns

#### 1. Repository Pattern

```typescript
// Base repository interface
interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(filter?: Partial<T>): Promise<T[]>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<boolean>;
}

// Implementation
class UserRepository implements Repository<User> {
  constructor(private db: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async findAll(filter?: Partial<User>): Promise<User[]> {
    return this.db.user.findMany({ where: filter });
  }

  async create(data: CreateUserDto): Promise<User> {
    return this.db.user.create({ data });
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    return this.db.user.update({
      where: { id },
      data
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.user.delete({ where: { id } });
    return !!result;
  }
}
```

#### 2. Service Layer Pattern

```typescript
// Service layer for business logic
class UserService {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService,
    private auditService: AuditService
  ) {}

  async registerUser(dto: RegisterUserDto): Promise<User> {
    // Validate business rules
    await this.validateEmailUniqueness(dto.email);
    await this.validatePasswordStrength(dto.password);

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = await this.userRepo.create({
      ...dto,
      password: hashedPassword
    });

    // Send welcome email
    await this.emailService.sendWelcomeEmail(user);

    // Audit log
    await this.auditService.log('user.created', { userId: user.id });

    return user;
  }

  private async validateEmailUniqueness(email: string): Promise<void> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }
  }

  private validatePasswordStrength(password: string): void {
    const requirements = [
      { regex: /.{12,}/, message: 'Password must be at least 12 characters' },
      { regex: /[A-Z]/, message: 'Password must contain uppercase letter' },
      { regex: /[a-z]/, message: 'Password must contain lowercase letter' },
      { regex: /[0-9]/, message: 'Password must contain number' },
      { regex: /[^A-Za-z0-9]/, message: 'Password must contain special character' }
    ];

    for (const req of requirements) {
      if (!req.regex.test(password)) {
        throw new ValidationError(req.message);
      }
    }
  }
}
```

#### 3. Dependency Injection

```typescript
// DI Container setup
import { Container } from 'inversify';

const container = new Container();

// Bind dependencies
container.bind<PrismaClient>(TYPES.Database).toConstantValue(new PrismaClient());
container.bind<Redis>(TYPES.Cache).toConstantValue(new Redis());
container.bind<UserRepository>(TYPES.UserRepository).to(UserRepository);
container.bind<UserService>(TYPES.UserService).to(UserService);

// Usage in controller
class UserController {
  constructor(
    @inject(TYPES.UserService) private userService: UserService
  ) {}

  async register(req: Request, res: Response) {
    const user = await this.userService.registerUser(req.body);
    res.status(201).json(user);
  }
}
```

## Code Structure

### Directory Structure

```
src/
├── auth/                 # Authentication & authorization
│   ├── strategies/       # Passport strategies
│   ├── guards/           # Route guards
│   ├── decorators/       # Custom decorators
│   ├── jwt.service.ts    # JWT handling
│   └── auth.module.ts    # Module definition
│
├── tools/                # MCP tool implementations
│   ├── base/             # Base tool classes
│   ├── builtin/          # Built-in tools
│   ├── custom/           # Custom tools
│   ├── registry.ts       # Tool registry
│   └── validator.ts      # Tool validation
│
├── server/               # Server implementations
│   ├── http/             # HTTP server
│   ├── websocket/        # WebSocket server
│   ├── middleware/       # Express middleware
│   └── routes/           # API routes
│
├── database/             # Database layer
│   ├── entities/         # Database entities
│   ├── repositories/     # Repository implementations
│   ├── migrations/       # Database migrations
│   └── seeds/            # Seed data
│
├── config/               # Configuration
│   ├── default.ts        # Default config
│   ├── development.ts    # Dev config
│   ├── production.ts     # Prod config
│   └── index.ts          # Config loader
│
├── utils/                # Utility functions
│   ├── logger.ts         # Logging utility
│   ├── validator.ts      # Validation helpers
│   ├── crypto.ts         # Cryptography helpers
│   └── errors.ts         # Custom error classes
│
├── monitoring/           # Monitoring & metrics
│   ├── metrics.ts        # Prometheus metrics
│   ├── health.ts         # Health checks
│   └── tracing.ts        # Distributed tracing
│
└── index.ts              # Application entry point
```

### Module Structure

```typescript
// Example module structure (auth.module.ts)
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' }
    })
  ],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    SamlStrategy
  ],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
```

## Development Workflow

### Git Workflow

```bash
# 1. Create feature branch
git checkout -b feature/MCP-123-add-new-tool

# 2. Make changes and commit
git add .
git commit -m "feat(tools): add new filesystem tool

- Implement read/write operations
- Add comprehensive tests
- Update documentation

Closes #123"

# 3. Keep branch updated
git fetch origin
git rebase origin/main

# 4. Push changes
git push origin feature/MCP-123-add-new-tool

# 5. Create pull request
gh pr create --title "feat(tools): add new filesystem tool" \
  --body "## Description\nAdds new filesystem tool with read/write operations\n\n## Testing\n- Unit tests added\n- Integration tests passing\n\n## Checklist\n- [ ] Tests passing\n- [ ] Documentation updated\n- [ ] Security review completed"
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/config changes
- `perf`: Performance improvements
- `security`: Security improvements

### Branch Naming Convention

```
feature/MCP-<ticket>-<description>    # New features
bugfix/MCP-<ticket>-<description>     # Bug fixes
hotfix/MCP-<ticket>-<description>     # Production hotfixes
release/<version>                      # Release branches
chore/<description>                    # Maintenance tasks
```

## API Development

### Creating New Endpoints

```typescript
// 1. Define DTO (Data Transfer Object)
// dto/create-tool.dto.ts
import { IsString, IsObject, IsBoolean, IsOptional } from 'class-validator';

export class CreateToolDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsObject()
  schema: object;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

// 2. Implement controller
// controllers/tools.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('tools')
@Controller('api/tools')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ToolsController {
  constructor(private toolService: ToolService) {}

  @Get()
  @ApiOperation({ summary: 'List all tools' })
  @UseInterceptors(CacheInterceptor)
  async listTools(@Query() query: ListToolsDto) {
    return this.toolService.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create new tool' })
  @Roles('admin')
  @UseGuards(RolesGuard)
  async createTool(@Body() dto: CreateToolDto) {
    return this.toolService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tool by ID' })
  async getTool(@Param('id') id: string) {
    const tool = await this.toolService.findById(id);
    if (!tool) {
      throw new NotFoundException(`Tool ${id} not found`);
    }
    return tool;
  }
}

// 3. Implement service
// services/tools.service.ts
@Injectable()
export class ToolService {
  constructor(
    private toolRepo: ToolRepository,
    private validator: ToolValidator,
    private eventEmitter: EventEmitter2
  ) {}

  async create(dto: CreateToolDto): Promise<Tool> {
    // Validate tool schema
    await this.validator.validateSchema(dto.schema);

    // Create tool
    const tool = await this.toolRepo.create(dto);

    // Emit event
    this.eventEmitter.emit('tool.created', { tool });

    return tool;
  }

  async findAll(query: ListToolsDto): Promise<PaginatedResult<Tool>> {
    const { page = 1, limit = 20, ...filters } = query;

    const [tools, total] = await this.toolRepo.findAndCount({
      where: filters,
      skip: (page - 1) * limit,
      take: limit
    });

    return {
      data: tools,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }
}
```

### API Documentation

```typescript
// Swagger documentation
@ApiTags('authentication')
@Controller('api/auth')
export class AuthController {
  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate user and return JWT tokens'
  })
  @ApiBody({
    description: 'Login credentials',
    type: LoginDto,
    examples: {
      default: {
        value: {
          email: 'user@example.com',
          password: 'SecurePassword123!'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJSUzI1NiIs...',
        refreshToken: 'eyJhbGciOiJSUzI1NiIs...',
        expiresIn: 3600
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials'
  })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

## Tool Development

### Creating Custom Tools

```typescript
// 1. Define tool interface
// tools/interfaces/tool.interface.ts
export interface Tool {
  name: string;
  description: string;
  version: string;
  execute(params: any, context: ToolContext): Promise<ToolResult>;
  validate(params: any): ValidationResult;
}

// 2. Implement base tool class
// tools/base/base-tool.ts
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  version = '1.0.0';

  protected logger: Logger;
  protected metrics: MetricsCollector;

  constructor() {
    this.logger = new Logger(this.constructor.name);
    this.metrics = new MetricsCollector(this.name);
  }

  abstract execute(params: any, context: ToolContext): Promise<ToolResult>;

  validate(params: any): ValidationResult {
    const schema = this.getSchema();
    const { error } = schema.validate(params);

    if (error) {
      return {
        valid: false,
        errors: error.details.map(d => d.message)
      };
    }

    return { valid: true };
  }

  protected abstract getSchema(): Joi.Schema;

  protected async trackExecution<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();

    try {
      const result = await fn();
      this.metrics.recordSuccess(Date.now() - start);
      return result;
    } catch (error) {
      this.metrics.recordError(Date.now() - start);
      throw error;
    }
  }
}

// 3. Implement custom tool
// tools/custom/database-tool.ts
export class DatabaseTool extends BaseTool {
  name = 'database';
  description = 'Execute database queries';

  constructor(private db: DatabaseConnection) {
    super();
  }

  async execute(params: DatabaseParams, context: ToolContext): Promise<ToolResult> {
    return this.trackExecution(async () => {
      // Validate permissions
      if (!context.user.permissions.includes('database:query')) {
        throw new ForbiddenError('Insufficient permissions');
      }

      // Log query for audit
      await this.auditLog(context.user, params.query);

      // Execute query with timeout
      const result = await this.db.query(params.query, {
        timeout: params.timeout || 30000
      });

      return {
        success: true,
        data: result.rows,
        metadata: {
          rowCount: result.rowCount,
          duration: result.duration
        }
      };
    });
  }

  protected getSchema(): Joi.Schema {
    return Joi.object({
      query: Joi.string().required().max(10000),
      timeout: Joi.number().optional().min(1000).max(60000)
    });
  }

  private async auditLog(user: User, query: string): Promise<void> {
    await this.logger.audit({
      userId: user.id,
      action: 'database.query',
      details: { query },
      timestamp: new Date()
    });
  }
}

// 4. Register tool
// tools/registry.ts
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }

    this.tools.set(tool.name, tool);
    this.logger.info(`Registered tool: ${tool.name}`);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
```

### Tool Testing

```typescript
// tools/__tests__/database-tool.test.ts
describe('DatabaseTool', () => {
  let tool: DatabaseTool;
  let mockDb: jest.Mocked<DatabaseConnection>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    tool = new DatabaseTool(mockDb);
  });

  describe('execute', () => {
    it('should execute valid query', async () => {
      const params = {
        query: 'SELECT * FROM users LIMIT 10'
      };

      const context = createMockContext({
        user: { permissions: ['database:query'] }
      });

      mockDb.query.mockResolvedValue({
        rows: [{ id: 1, name: 'Test' }],
        rowCount: 1,
        duration: 50
      });

      const result = await tool.execute(params, context);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalledWith(
        params.query,
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it('should reject without permissions', async () => {
      const context = createMockContext({
        user: { permissions: [] }
      });

      await expect(
        tool.execute({ query: 'SELECT 1' }, context)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should validate query parameters', () => {
      const result = tool.validate({
        query: 'a'.repeat(10001) // Too long
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('query exceeds maximum length');
    });
  });
});
```

## Testing Guidelines

### Test Structure

```typescript
// Standard test structure
describe('ComponentName', () => {
  // Setup and teardown
  beforeAll(async () => {
    // Global setup
  });

  beforeEach(() => {
    // Test-specific setup
  });

  afterEach(() => {
    // Cleanup
  });

  afterAll(async () => {
    // Global cleanup
  });

  // Group related tests
  describe('methodName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = component.method(input);

      // Assert
      expect(result).toEqual(expectedOutput);
    });

    it('should handle edge case', () => {
      // Test edge cases
    });

    it('should handle error case', () => {
      // Test error scenarios
    });
  });
});
```

### Testing Utilities

```typescript
// test-utils/helpers.ts
export function createMockRequest(overrides?: Partial<Request>): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: null,
    ...overrides
  } as Request;
}

export function createMockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis()
  } as unknown as Response;

  return res;
}

export async function createTestDatabase(): Promise<PrismaClient> {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://test:test@localhost:5433/test'
      }
    }
  });

  await db.$executeRaw`CREATE SCHEMA IF NOT EXISTS test`;
  await db.$connect();

  return db;
}

export class TestFixtures {
  static user(overrides?: Partial<User>): User {
    return {
      id: 'user_123',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['user'],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }

  static tool(overrides?: Partial<Tool>): Tool {
    return {
      id: 'tool_123',
      name: 'test-tool',
      description: 'Test tool',
      enabled: true,
      schema: {},
      ...overrides
    };
  }
}
```

### Integration Testing

```typescript
// integration/api.test.ts
describe('API Integration Tests', () => {
  let app: INestApplication;
  let db: PrismaClient;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = app.get(PrismaClient);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate valid user', async () => {
      // Create test user
      const user = await db.user.create({
        data: {
          email: 'test@example.com',
          password: await bcrypt.hash('password123', 10)
        }
      });

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });
  });
});
```

## Code Quality Standards

### ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'security', 'jest'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended',
    'plugin:jest/recommended',
    'prettier'
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'complexity': ['error', 10],
    'max-lines-per-function': ['error', 50],
    'max-depth': ['error', 3]
  }
};
```

### Prettier Configuration

```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "none",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

### Code Review Checklist

- [ ] **Functionality**: Does the code do what it's supposed to do?
- [ ] **Tests**: Are there adequate tests? Do they cover edge cases?
- [ ] **Security**: Are there any security vulnerabilities?
- [ ] **Performance**: Are there any performance concerns?
- [ ] **Readability**: Is the code easy to understand?
- [ ] **Maintainability**: Will this code be easy to modify?
- [ ] **Documentation**: Is the code properly documented?
- [ ] **Error Handling**: Are errors handled appropriately?
- [ ] **Logging**: Is there appropriate logging?
- [ ] **Dependencies**: Are new dependencies necessary and secure?

## Security Guidelines

### Security Best Practices

```typescript
// 1. Input validation
import { sanitize } from 'dompurify';
import { validate } from 'class-validator';

class SecurityMiddleware {
  async validateInput(req: Request, res: Response, next: NextFunction) {
    // Sanitize HTML content
    if (req.body.content) {
      req.body.content = sanitize(req.body.content);
    }

    // Validate against schema
    const errors = await validate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    next();
  }

  // 2. SQL injection prevention
  async secureQuery(query: string, params: any[]) {
    // Always use parameterized queries
    return db.query(query, params);
    // Never do: db.query(`SELECT * FROM users WHERE id = ${userId}`)
  }

  // 3. XSS prevention
  renderResponse(data: any) {
    return {
      ...data,
      // Escape all user-generated content
      content: this.escapeHtml(data.content)
    };
  }

  // 4. CSRF protection
  verifyCsrfToken(req: Request) {
    const token = req.headers['x-csrf-token'];
    const sessionToken = req.session.csrfToken;

    if (!token || token !== sessionToken) {
      throw new ForbiddenError('Invalid CSRF token');
    }
  }

  // 5. Rate limiting
  @RateLimit({ points: 100, duration: 60 })
  async handleRequest(req: Request, res: Response) {
    // Process request
  }
}
```

### Secure Coding Checklist

- [ ] Never trust user input
- [ ] Use parameterized queries
- [ ] Implement proper authentication
- [ ] Use HTTPS everywhere
- [ ] Store passwords using bcrypt/argon2
- [ ] Implement rate limiting
- [ ] Use security headers
- [ ] Validate all inputs
- [ ] Escape all outputs
- [ ] Keep dependencies updated
- [ ] Use least privilege principle
- [ ] Implement proper error handling
- [ ] Add security logging
- [ ] Regular security audits

## Performance Guidelines

### Performance Optimization

```typescript
// 1. Database query optimization
class OptimizedRepository {
  // Use indexing
  @Index(['email', 'status'])
  class User {
    email: string;
    status: string;
  }

  // Use projection to fetch only needed fields
  async findUsersLight() {
    return db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true
      }
    });
  }

  // Use pagination
  async findPaginated(page: number, limit: number) {
    return db.user.findMany({
      skip: (page - 1) * limit,
      take: limit
    });
  }

  // Use database transactions
  async transferCredits(fromId: string, toId: string, amount: number) {
    return db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: fromId },
        data: { credits: { decrement: amount } }
      });

      await tx.user.update({
        where: { id: toId },
        data: { credits: { increment: amount } }
      });
    });
  }
}

// 2. Caching strategy
class CacheService {
  private cache: Redis;

  async getWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    // Try cache first
    const cached = await this.cache.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch and cache
    const data = await fetcher();
    await this.cache.setex(key, ttl, JSON.stringify(data));

    return data;
  }

  async invalidate(pattern: string) {
    const keys = await this.cache.keys(pattern);
    if (keys.length > 0) {
      await this.cache.del(...keys);
    }
  }
}

// 3. Async processing
class QueueService {
  async processAsync(job: Job) {
    // Add to queue for background processing
    await this.queue.add('process-job', job, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
  }
}
```

### Performance Monitoring

```typescript
// Performance monitoring utilities
class PerformanceMonitor {
  private metrics = new Map<string, number[]>();

  measure(name: string, fn: () => void) {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(duration);

    // Alert if slow
    if (duration > 1000) {
      logger.warn(`Slow operation: ${name} took ${duration}ms`);
    }
  }

  getStats(name: string) {
    const times = this.metrics.get(name) || [];
    return {
      count: times.length,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      p95: this.percentile(times, 95)
    };
  }

  private percentile(arr: number[], p: number) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }
}
```

## Contributing Guidelines

### How to Contribute

1. **Fork the repository**
   ```bash
   gh repo fork enterprise/secure-mcp-server
   ```

2. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature
   ```

3. **Make your changes**
   - Write clean, documented code
   - Add tests for new functionality
   - Update documentation

4. **Run tests**
   ```bash
   npm run test
   npm run lint
   npm run security:check
   ```

5. **Submit pull request**
   - Fill out PR template
   - Link related issues
   - Request reviews

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests added
- [ ] Security review if needed
```

### Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards others

## Release Process

### Version Management

```bash
# Semantic versioning: MAJOR.MINOR.PATCH
# MAJOR: Breaking changes
# MINOR: New features (backward compatible)
# PATCH: Bug fixes

# Update version
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.1 -> 1.1.0
npm version major  # 1.1.0 -> 2.0.0
```

### Release Checklist

```bash
#!/bin/bash
# release.sh

VERSION=$1

echo "Releasing version $VERSION"

# 1. Run tests
npm test
npm run test:integration
npm run test:security

# 2. Build
npm run build

# 3. Update changelog
echo "## Version $VERSION - $(date +%Y-%m-%d)" >> CHANGELOG.md
git log --pretty=format:"- %s" $(git describe --tags --abbrev=0)..HEAD >> CHANGELOG.md

# 4. Commit changes
git add .
git commit -m "chore: release v$VERSION"

# 5. Tag release
git tag -a "v$VERSION" -m "Release v$VERSION"

# 6. Push to repository
git push origin main --tags

# 7. Build Docker image
docker build -t secure-mcp-server:$VERSION .
docker tag secure-mcp-server:$VERSION secure-mcp-server:latest

# 8. Push to registry
docker push secure-mcp-server:$VERSION
docker push secure-mcp-server:latest

# 9. Deploy to staging
kubectl set image deployment/mcp-server mcp-server=secure-mcp-server:$VERSION -n staging

# 10. Run smoke tests
npm run test:smoke

echo "Release $VERSION completed!"
```

### Deployment Pipeline

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: |
          npm test
          npm run test:integration

      - name: Build
        run: npm run build

      - name: Build Docker image
        run: |
          docker build -t secure-mcp-server:${{ github.ref_name }} .
          docker tag secure-mcp-server:${{ github.ref_name }} secure-mcp-server:latest

      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push secure-mcp-server:${{ github.ref_name }}
          docker push secure-mcp-server:latest

      - name: Create release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/**
            CHANGELOG.md
          generate_release_notes: true
```

## Resources

### Documentation
- [MCP Specification](https://modelcontextprotocol.io)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [OWASP Security Guide](https://owasp.org/www-project-secure-coding-practices/)

### Tools
- [VS Code](https://code.visualstudio.com/)
- [Postman](https://www.postman.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [pgAdmin](https://www.pgadmin.org/)
- [Redis Commander](https://github.com/joeferner/redis-commander)

### Learning Resources
- Internal Wiki: https://wiki.enterprise.com/mcp
- Video Tutorials: https://learn.enterprise.com/mcp
- Slack Channel: #mcp-development
- Office Hours: Thursdays 2-3 PM

## Support

- **Documentation**: [Full Documentation](./docs/)
- **Issues**: [GitHub Issues](https://github.com/enterprise/secure-mcp-server/issues)
- **Slack**: #mcp-development
- **Email**: mcp-team@enterprise.com