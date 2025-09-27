import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
dotenvConfig();

// Environment validation schema
const envSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server configuration
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),

  // Database configuration
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.string().transform(val => val === 'true').default('false'),
  DATABASE_POOL_MIN: z.string().regex(/^\d+$/).transform(Number).default('2'),
  DATABASE_POOL_MAX: z.string().regex(/^\d+$/).transform(Number).default('20'),
  DATABASE_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('30000'),

  // Redis configuration
  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().regex(/^\d+$/).transform(Number).default('0'),
  REDIS_CONNECT_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('10000'),
  REDIS_COMMAND_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  REDIS_RETRY_DELAY_ON_FAILURE: z.string().regex(/^\d+$/).transform(Number).default('100'),
  REDIS_MAX_RETRY_DELAY: z.string().regex(/^\d+$/).transform(Number).default('2000'),

  // Vault configuration
  VAULT_URL: z.string().url(),
  VAULT_TOKEN: z.string().min(1),
  VAULT_NAMESPACE: z.string().optional(),
  VAULT_ROLE_ID: z.string().optional(),
  VAULT_SECRET_ID: z.string().optional(),
  VAULT_KV_MOUNT: z.string().default('secret'),
  VAULT_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('10000'),

  // JWT configuration
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('secure-mcp-server'),
  JWT_AUDIENCE: z.string().default('secure-mcp-client'),

  // MFA configuration
  MFA_ISSUER: z.string().default('Secure MCP Server'),
  MFA_WINDOW: z.string().regex(/^\d+$/).transform(Number).default('1'),

  // SSO configuration (SAML)
  SAML_ENABLED: z.string().transform(val => val === 'true').default('false'),
  SAML_ENTRY_POINT: z.string().url().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CALLBACK_URL: z.string().url().optional(),
  SAML_CERT: z.string().optional(),
  SAML_PRIVATE_KEY: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/).transform(Number).default('100'),
  RATE_LIMIT_SKIP_SUCCESSFUL: z.string().transform(val => val === 'true').default('false'),
  RATE_LIMIT_SKIP_FAILED: z.string().transform(val => val === 'true').default('false'),

  // CORS configuration
  CORS_ORIGINS: z.string().transform(val => val.split(',')).default('http://localhost:3000'),
  CORS_CREDENTIALS: z.string().transform(val => val === 'true').default('true'),
  CORS_MAX_AGE: z.string().regex(/^\d+$/).transform(Number).default('86400'),

  // Security headers
  SECURITY_FORCE_HTTPS: z.string().transform(val => val === 'true').default('true'),
  SECURITY_HSTS_MAX_AGE: z.string().regex(/^\d+$/).transform(Number).default('31536000'),
  SECURITY_FRAME_OPTIONS: z.enum(['DENY', 'SAMEORIGIN']).default('DENY'),

  // Logging configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  LOG_REDACT_SENSITIVE: z.string().transform(val => val === 'true').default('true'),

  // Monitoring
  METRICS_ENABLED: z.string().transform(val => val === 'true').default('true'),
  METRICS_PORT: z.string().regex(/^\d+$/).transform(Number).default('9090'),
  METRICS_PATH: z.string().default('/metrics'),
  TRACING_ENABLED: z.string().transform(val => val === 'true').default('true'),
  TRACING_ENDPOINT: z.string().url().optional(),
  TRACING_SERVICE_NAME: z.string().default('secure-mcp-server'),

  // WebSocket configuration
  WS_PING_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('60000'),
  WS_PING_INTERVAL: z.string().regex(/^\d+$/).transform(Number).default('25000'),
  WS_MAX_CONNECTIONS: z.string().regex(/^\d+$/).transform(Number).default('1000'),
  WS_MAX_MESSAGE_SIZE: z.string().regex(/^\d+$/).transform(Number).default('1048576'), // 1MB

  // MCP Protocol configuration
  MCP_PROTOCOL_VERSION: z.string().default('2024-11-05'),
  MCP_MAX_TOOLS: z.string().regex(/^\d+$/).transform(Number).default('100'),
  MCP_MAX_RESOURCES: z.string().regex(/^\d+$/).transform(Number).default('1000'),
  MCP_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('30000'),
  MCP_RATE_LIMIT_PER_CONNECTION: z.string().regex(/^\d+$/).transform(Number).default('100'),

  // Clustering configuration
  CLUSTERING_ENABLED: z.string().transform(val => val === 'true').default('false'),
  CLUSTERING_WORKERS: z.string().default('auto'),

  // Health check configuration
  HEALTH_CHECK_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  HEALTH_CHECK_INTERVAL: z.string().regex(/^\d+$/).transform(Number).default('30000'),

  // Encryption configuration
  ENCRYPTION_ALGORITHM: z.string().default('aes-256-gcm'),
  ENCRYPTION_KEY_DERIVATION: z.string().default('pbkdf2'),
  ENCRYPTION_ITERATIONS: z.string().regex(/^\d+$/).transform(Number).default('100000'),

  // Session configuration
  SESSION_SECRET: z.string().min(32),
  SESSION_TIMEOUT: z.string().regex(/^\d+$/).transform(Number).default('3600000'), // 1 hour
  SESSION_COOKIE_SECURE: z.string().transform(val => val === 'true').default('true'),
  SESSION_COOKIE_HTTP_ONLY: z.string().transform(val => val === 'true').default('true'),
  SESSION_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Invalid environment configuration:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
};

const env = parseEnv();

// Application configuration interface
export interface AppConfig {
  env: string;
  server: {
    port: number;
    host: string;
  };
  database: {
    url: string;
    ssl: boolean;
    pool: {
      min: number;
      max: number;
    };
    timeout: number;
  };
  redis: {
    url: string;
    password?: string;
    db: number;
    connectTimeout: number;
    commandTimeout: number;
    retryDelayOnFailure: number;
    maxRetryDelay: number;
  };
  vault: {
    url: string;
    token: string;
    namespace?: string;
    roleId?: string;
    secretId?: string;
    kvMount: string;
    timeout: number;
  };
  jwt: {
    secret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  mfa: {
    issuer: string;
    window: number;
  };
  saml: {
    enabled: boolean;
    entryPoint?: string;
    issuer?: string;
    callbackUrl?: string;
    cert?: string;
    privateKey?: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests: boolean;
    skipFailedRequests: boolean;
  };
  cors: {
    origins: string[];
    credentials: boolean;
    maxAge: number;
  };
  security: {
    forceHttps: boolean;
    hstsMaxAge: number;
    frameOptions: string;
  };
  logging: {
    level: string;
    format: string;
    redactSensitive: boolean;
  };
  monitoring: {
    enabled: boolean;
    port: number;
    path: string;
  };
  tracing: {
    enabled: boolean;
    endpoint?: string;
    serviceName: string;
  };
  websocket: {
    pingTimeout: number;
    pingInterval: number;
    maxConnections: number;
    maxMessageSize: number;
  };
  mcp: {
    protocolVersion: string;
    maxTools: number;
    maxResources: number;
    timeout: number;
    rateLimitPerConnection: number;
  };
  clustering: {
    enabled: boolean;
    workers: number | 'auto';
  };
  healthCheck: {
    timeout: number;
    interval: number;
  };
  encryption: {
    algorithm: string;
    keyDerivation: string;
    iterations: number;
  };
  session: {
    secret: string;
    timeout: number;
    cookie: {
      secure: boolean;
      httpOnly: boolean;
      sameSite: 'strict' | 'lax' | 'none';
    };
  };
}

// Export validated configuration
export const config: AppConfig = {
  env: env.NODE_ENV,
  server: {
    port: env.PORT,
    host: env.HOST,
  },
  database: {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    pool: {
      min: env.DATABASE_POOL_MIN,
      max: env.DATABASE_POOL_MAX,
    },
    timeout: env.DATABASE_TIMEOUT,
  },
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    connectTimeout: env.REDIS_CONNECT_TIMEOUT,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT,
    retryDelayOnFailure: env.REDIS_RETRY_DELAY_ON_FAILURE,
    maxRetryDelay: env.REDIS_MAX_RETRY_DELAY,
  },
  vault: {
    url: env.VAULT_URL,
    token: env.VAULT_TOKEN,
    namespace: env.VAULT_NAMESPACE,
    roleId: env.VAULT_ROLE_ID,
    secretId: env.VAULT_SECRET_ID,
    kvMount: env.VAULT_KV_MOUNT,
    timeout: env.VAULT_TIMEOUT,
  },
  jwt: {
    secret: env.JWT_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
  mfa: {
    issuer: env.MFA_ISSUER,
    window: env.MFA_WINDOW,
  },
  saml: {
    enabled: env.SAML_ENABLED,
    entryPoint: env.SAML_ENTRY_POINT,
    issuer: env.SAML_ISSUER,
    callbackUrl: env.SAML_CALLBACK_URL,
    cert: env.SAML_CERT,
    privateKey: env.SAML_PRIVATE_KEY,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    skipSuccessfulRequests: env.RATE_LIMIT_SKIP_SUCCESSFUL,
    skipFailedRequests: env.RATE_LIMIT_SKIP_FAILED,
  },
  cors: {
    origins: env.CORS_ORIGINS,
    credentials: env.CORS_CREDENTIALS,
    maxAge: env.CORS_MAX_AGE,
  },
  security: {
    forceHttps: env.SECURITY_FORCE_HTTPS,
    hstsMaxAge: env.SECURITY_HSTS_MAX_AGE,
    frameOptions: env.SECURITY_FRAME_OPTIONS,
  },
  logging: {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    redactSensitive: env.LOG_REDACT_SENSITIVE,
  },
  monitoring: {
    enabled: env.METRICS_ENABLED,
    port: env.METRICS_PORT,
    path: env.METRICS_PATH,
  },
  tracing: {
    enabled: env.TRACING_ENABLED,
    endpoint: env.TRACING_ENDPOINT,
    serviceName: env.TRACING_SERVICE_NAME,
  },
  websocket: {
    pingTimeout: env.WS_PING_TIMEOUT,
    pingInterval: env.WS_PING_INTERVAL,
    maxConnections: env.WS_MAX_CONNECTIONS,
    maxMessageSize: env.WS_MAX_MESSAGE_SIZE,
  },
  mcp: {
    protocolVersion: env.MCP_PROTOCOL_VERSION,
    maxTools: env.MCP_MAX_TOOLS,
    maxResources: env.MCP_MAX_RESOURCES,
    timeout: env.MCP_TIMEOUT,
    rateLimitPerConnection: env.MCP_RATE_LIMIT_PER_CONNECTION,
  },
  clustering: {
    enabled: env.CLUSTERING_ENABLED,
    workers: env.CLUSTERING_WORKERS === 'auto' ? 'auto' : parseInt(env.CLUSTERING_WORKERS, 10),
  },
  healthCheck: {
    timeout: env.HEALTH_CHECK_TIMEOUT,
    interval: env.HEALTH_CHECK_INTERVAL,
  },
  encryption: {
    algorithm: env.ENCRYPTION_ALGORITHM,
    keyDerivation: env.ENCRYPTION_KEY_DERIVATION,
    iterations: env.ENCRYPTION_ITERATIONS,
  },
  session: {
    secret: env.SESSION_SECRET,
    timeout: env.SESSION_TIMEOUT,
    cookie: {
      secure: env.SESSION_COOKIE_SECURE,
      httpOnly: env.SESSION_COOKIE_HTTP_ONLY,
      sameSite: env.SESSION_COOKIE_SAME_SITE,
    },
  },
};

// Configuration validation function
export const validateConfig = (): void => {
  const requiredInProduction = [
    'DATABASE_URL',
    'REDIS_URL',
    'VAULT_URL',
    'VAULT_TOKEN',
    'JWT_SECRET',
    'SESSION_SECRET',
  ];

  if (config.env === 'production') {
    const missing = requiredInProduction.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    }

    // Additional production validations
    if (config.jwt.secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }

    if (config.session.secret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }

    if (!config.security.forceHttps) {
      logger.warn('SECURITY_FORCE_HTTPS is disabled in production');
    }

    if (!config.session.cookie.secure) {
      logger.warn('SESSION_COOKIE_SECURE is disabled in production');
    }
  }

  logger.info('Configuration validated successfully', {
    environment: config.env,
    server: `${config.server.host}:${config.server.port}`,
    clustering: config.clustering.enabled,
    monitoring: config.monitoring.enabled,
    tracing: config.tracing.enabled,
  });
};

// Export environment schema for testing
export { envSchema };