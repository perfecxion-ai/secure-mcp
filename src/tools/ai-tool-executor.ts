/**
 * Secure AI Tool Executor
 * Implements safe AI-powered tool execution with prompt security
 */

import { promptSecurity, PromptSecurityFramework } from '../security/prompt-security';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { z } from 'zod';

// Tool execution schema
const AIToolRequestSchema = z.object({
  tool: z.string().min(1).max(100),
  prompt: z.string().min(1).max(10000),
  parameters: z.record(z.any()).optional(),
  context: z.string().optional(),
  userId: z.string(),
  sessionId: z.string(),
});

// AI tool categories with security levels
enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

interface AITool {
  name: string;
  description: string;
  securityLevel: SecurityLevel;
  maxPromptLength: number;
  allowedParameters: string[];
  systemPrompt: string;
  validator?: (params: any) => boolean;
  preprocessor?: (prompt: string) => string;
  postprocessor?: (result: string) => string;
}

// Available AI tools with security configurations
const AI_TOOLS = new Map<string, AITool>([
  ['text_summarization', {
    name: 'text_summarization',
    description: 'Summarize text content safely',
    securityLevel: SecurityLevel.LOW,
    maxPromptLength: 5000,
    allowedParameters: ['length', 'style'],
    systemPrompt: 'You are a text summarization assistant. Only provide summaries of the given text.',
    preprocessor: (prompt) => prompt.substring(0, 5000),
    postprocessor: (result) => result.substring(0, 1000),
  }],

  ['code_explanation', {
    name: 'code_explanation',
    description: 'Explain code functionality',
    securityLevel: SecurityLevel.MEDIUM,
    maxPromptLength: 3000,
    allowedParameters: ['language', 'detail_level'],
    systemPrompt: 'You are a code explanation assistant. Explain code without executing or suggesting malicious patterns.',
    validator: (params) => {
      // Validate language is safe
      const allowedLanguages = ['javascript', 'python', 'java', 'typescript', 'go'];
      return !params.language || allowedLanguages.includes(params.language.toLowerCase());
    },
  }],

  ['data_analysis', {
    name: 'data_analysis',
    description: 'Analyze data patterns',
    securityLevel: SecurityLevel.HIGH,
    maxPromptLength: 2000,
    allowedParameters: ['format', 'metrics'],
    systemPrompt: 'You are a data analysis assistant. Analyze patterns without revealing sensitive information.',
    validator: (params) => {
      // Ensure no SQL or code execution
      const dangerous = /SELECT|INSERT|UPDATE|DELETE|DROP|eval|exec/i;
      return !dangerous.test(JSON.stringify(params));
    },
  }],

  ['content_moderation', {
    name: 'content_moderation',
    description: 'Moderate content for safety',
    securityLevel: SecurityLevel.CRITICAL,
    maxPromptLength: 1000,
    allowedParameters: ['policy', 'severity'],
    systemPrompt: 'You are a content moderation assistant. Identify policy violations without repeating harmful content.',
  }],
]);

export class SecureAIToolExecutor {
  private executionHistory: Map<string, {
    count: number;
    lastExecution: number;
    violations: number;
  }> = new Map();

  private rateLimits = {
    [SecurityLevel.LOW]: { requests: 100, window: 60000 }, // 100 per minute
    [SecurityLevel.MEDIUM]: { requests: 50, window: 60000 }, // 50 per minute
    [SecurityLevel.HIGH]: { requests: 20, window: 60000 }, // 20 per minute
    [SecurityLevel.CRITICAL]: { requests: 10, window: 60000 }, // 10 per minute
  };

  /**
   * Execute AI tool with comprehensive security
   */
  public async executeTool(request: {
    tool: string;
    prompt: string;
    parameters?: any;
    context?: string;
    userId: string;
    sessionId: string;
  }): Promise<{
    success: boolean;
    result?: string;
    error?: string;
    securityLog?: any;
  }> {
    try {
      // Validate request schema
      const validated = AIToolRequestSchema.parse(request);

      // Check if tool exists
      const tool = AI_TOOLS.get(validated.tool);
      if (!tool) {
        return {
          success: false,
          error: `Tool not found: ${validated.tool}`,
        };
      }

      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(
        validated.userId,
        tool.securityLevel
      );
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          error: 'Rate limit exceeded',
          securityLog: {
            violation: 'rate_limit',
            remaining: rateLimitCheck.remaining,
            resetAt: rateLimitCheck.resetAt,
          },
        };
      }

      // Validate tool parameters
      if (tool.validator && validated.parameters) {
        if (!tool.validator(validated.parameters)) {
          return {
            success: false,
            error: 'Invalid tool parameters',
            securityLog: {
              violation: 'invalid_parameters',
              tool: tool.name,
            },
          };
        }
      }

      // Validate prompt security
      const promptValidation = await promptSecurity.validatePrompt(
        validated.prompt,
        validated.userId,
        validated.context
      );

      if (!promptValidation.valid) {
        logger.warn('Prompt security validation failed', {
          userId: validated.userId,
          tool: tool.name,
          violations: promptValidation.violations,
          riskScore: promptValidation.risk_score,
        });

        return {
          success: false,
          error: 'Prompt failed security validation',
          securityLog: {
            violations: promptValidation.violations,
            riskScore: promptValidation.risk_score,
          },
        };
      }

      // Apply preprocessing if defined
      let processedPrompt = promptValidation.sanitized || validated.prompt;
      if (tool.preprocessor) {
        processedPrompt = tool.preprocessor(processedPrompt);
      }

      // Create secure execution context
      const executionContext = this.createExecutionContext(
        tool,
        processedPrompt,
        validated.parameters
      );

      // Execute tool (simulated - in production, this would call actual AI service)
      const result = await this.executeInSandbox(executionContext);

      // Validate response
      const responseValidation = promptSecurity.validateResponse(
        result,
        validated.userId
      );

      // Apply postprocessing if defined
      let finalResult = responseValidation.sanitized;
      if (tool.postprocessor) {
        finalResult = tool.postprocessor(finalResult);
      }

      // Log successful execution
      logger.info('AI tool executed successfully', {
        userId: validated.userId,
        sessionId: validated.sessionId,
        tool: tool.name,
        securityLevel: tool.securityLevel,
      });

      // Update execution history
      this.updateExecutionHistory(validated.userId);

      return {
        success: true,
        result: finalResult,
        securityLog: {
          promptValidation: promptValidation.risk_score,
          responseValidation: responseValidation.violations,
        },
      };

    } catch (error) {
      logger.error('AI tool execution error', { error, request });
      return {
        success: false,
        error: 'Tool execution failed',
        securityLog: {
          error: error.message,
        },
      };
    }
  }

  /**
   * Create secure execution context
   */
  private createExecutionContext(
    tool: AITool,
    prompt: string,
    parameters?: any
  ): {
    systemPrompt: string;
    userPrompt: string;
    constraints: any;
  } {
    // Build system prompt with security constraints
    const systemPrompt = tool.systemPrompt ||
      promptSecurity.createSystemPrompt('default');

    // Add tool-specific constraints
    const constraints = {
      maxTokens: tool.securityLevel === SecurityLevel.CRITICAL ? 500 : 2000,
      temperature: tool.securityLevel === SecurityLevel.CRITICAL ? 0.3 : 0.7,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.5,
      stop: ['[SECURITY:', '[SYSTEM:', '\n\n\n'],
    };

    // Build user prompt with context
    let userPrompt = prompt;
    if (parameters) {
      // Safely inject parameters
      const safeParams = this.sanitizeParameters(parameters, tool.allowedParameters);
      userPrompt = `${prompt}\n\nParameters: ${JSON.stringify(safeParams)}`;
    }

    return {
      systemPrompt,
      userPrompt,
      constraints,
    };
  }

  /**
   * Execute tool in sandboxed environment
   */
  private async executeInSandbox(context: {
    systemPrompt: string;
    userPrompt: string;
    constraints: any;
  }): Promise<string> {
    // In production, this would call actual AI service APIs
    // For now, return simulated safe response

    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulated responses based on context
    if (context.userPrompt.includes('summarize')) {
      return 'This is a safely generated summary of the provided content.';
    }

    if (context.userPrompt.includes('explain')) {
      return 'This code performs data validation and error handling.';
    }

    if (context.userPrompt.includes('analyze')) {
      return 'Analysis complete. No sensitive data or security issues detected.';
    }

    return 'Request processed successfully with security constraints applied.';
  }

  /**
   * Check rate limiting for user and tool
   */
  private checkRateLimit(userId: string, securityLevel: SecurityLevel): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const limits = this.rateLimits[securityLevel];
    const now = Date.now();
    const userKey = `${userId}:${securityLevel}`;

    const history = this.executionHistory.get(userKey) || {
      count: 0,
      lastExecution: 0,
      violations: 0,
    };

    // Reset if outside window
    if (now - history.lastExecution > limits.window) {
      history.count = 0;
      history.lastExecution = now;
    }

    const allowed = history.count < limits.requests;
    const remaining = Math.max(0, limits.requests - history.count - 1);
    const resetAt = history.lastExecution + limits.window;

    if (!allowed) {
      history.violations++;
    }

    return { allowed, remaining, resetAt };
  }

  /**
   * Update execution history
   */
  private updateExecutionHistory(userId: string): void {
    const now = Date.now();

    // Update history for each security level
    for (const level of Object.values(SecurityLevel)) {
      const userKey = `${userId}:${level}`;
      const history = this.executionHistory.get(userKey) || {
        count: 0,
        lastExecution: 0,
        violations: 0,
      };

      if (now - history.lastExecution < this.rateLimits[level].window) {
        history.count++;
      } else {
        history.count = 1;
      }

      history.lastExecution = now;
      this.executionHistory.set(userKey, history);
    }

    // Clean old entries
    this.cleanExecutionHistory();
  }

  /**
   * Clean old execution history
   */
  private cleanExecutionHistory(): void {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    for (const [key, history] of this.executionHistory.entries()) {
      if (now - history.lastExecution > maxAge) {
        this.executionHistory.delete(key);
      }
    }
  }

  /**
   * Sanitize parameters based on allowed list
   */
  private sanitizeParameters(params: any, allowed: string[]): any {
    const sanitized: any = {};

    for (const key of allowed) {
      if (key in params) {
        const value = params[key];

        // Sanitize based on type
        if (typeof value === 'string') {
          sanitized[key] = value.substring(0, 100)
            .replace(/[<>]/g, '') // Remove potential HTML
            .trim();
        } else if (typeof value === 'number') {
          sanitized[key] = Math.min(Math.max(value, -1000000), 1000000);
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  /**
   * Get tool information (safe for client exposure)
   */
  public getAvailableTools(): Array<{
    name: string;
    description: string;
    securityLevel: string;
    parameters: string[];
  }> {
    return Array.from(AI_TOOLS.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      securityLevel: tool.securityLevel,
      parameters: tool.allowedParameters,
    }));
  }

  /**
   * Get security metrics
   */
  public getSecurityMetrics(): {
    totalExecutions: number;
    violations: number;
    blockedUsers: string[];
  } {
    let totalExecutions = 0;
    let violations = 0;
    const blockedUsers: string[] = [];

    for (const [key, history] of this.executionHistory.entries()) {
      totalExecutions += history.count;
      violations += history.violations;

      if (history.violations > 5) {
        const userId = key.split(':')[0];
        if (!blockedUsers.includes(userId)) {
          blockedUsers.push(userId);
        }
      }
    }

    return {
      totalExecutions,
      violations,
      blockedUsers,
    };
  }
}

// Export singleton instance
export const aiToolExecutor = new SecureAIToolExecutor();