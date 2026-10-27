export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface Resource {
  uri: string;
  name: string;
  type: string;
  metadata?: Record<string, any>;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface MCPError {
  code: number;
  message: string;
  details?: any;
}

export interface AuthToken {
  token: string;
  expiresAt: Date;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}