/**
 * Type definitions for OpenAI and Claude API formats
 * @author jizhejiang
 * @date 2025-08-11
 */

// ================= OpenAI Types =================

/**
 * OpenAI message role types
 */
export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * OpenAI message content types
 */
export interface OpenAITextContent {
  type: 'text';
  text: string;
}

export interface OpenAIImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type OpenAIMessageContent = string | (OpenAITextContent | OpenAIImageContent)[];

/**
 * OpenAI message format
 */
export interface OpenAIMessage {
  role: OpenAIRole;
  content: OpenAIMessageContent;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * OpenAI tool/function definitions
 */
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI request format
 */
export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  functions?: OpenAIFunction[];
  function_call?: 'none' | 'auto' | { name: string };
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  logprobs?: boolean;
  top_logprobs?: number;
}

/**
 * OpenAI response format
 */
export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  system_fingerprint?: string;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: {
    content: Array<{
      token: string;
      logprob: number;
      bytes: number[];
      top_logprobs: Array<{
        token: string;
        logprob: number;
        bytes: number[];
      }>;
    }>;
  };
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ================= Claude Types =================

/**
 * Claude message role types
 */
export type ClaudeRole = 'user' | 'assistant';

/**
 * Claude content types
 */
export interface ClaudeTextContent {
  type: 'text';
  text: string;
}

export type ClaudeImageContent =
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    }
  | {
      type: 'image';
      source: {
        type: 'url';
        url: string;
      };
    };

export interface ClaudeToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Record<string, unknown>;
  is_error?: boolean;
}

export type ClaudeContent =
  | ClaudeTextContent
  | ClaudeImageContent
  | ClaudeToolUseContent
  | ClaudeToolResultContent;

/**
 * Claude message format
 */
export interface ClaudeMessage {
  role: ClaudeRole;
  content: string | ClaudeContent[];
}

/**
 * Claude tool definition
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    /**
     * Whether extra properties outside the schema are allowed.
     * Mapped from OpenAI function.strict === true → additionalProperties: false
     */
    additionalProperties?: boolean;
  };
}

/**
 * Claude system message format
 */
export interface ClaudeSystemMessage {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Claude request format
 */
export interface ClaudeRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string | ClaudeSystemMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: {
    user_id?: string;
  };
  tools?: ClaudeTool[];
  tool_choice?: {
    type: 'auto' | 'any' | 'tool';
    name?: string;
  };
}

// ================= OpenAI Response Format Types =================

export interface OpenAIResponseFormatText {
  type: 'text';
}

export interface OpenAIResponseFormatJsonObject {
  type: 'json_object';
}

export interface OpenAIResponseFormatJsonSchema {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export type OpenAIResponseFormat =
  | OpenAIResponseFormatText
  | OpenAIResponseFormatJsonObject
  | OpenAIResponseFormatJsonSchema;

/**
 * Claude response format
 */
export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ClaudeContent[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ================= Stream Types =================

/**
 * OpenAI stream chunk format
 */
export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: {
    content: Array<{
      token: string;
      logprob: number;
      bytes: number[];
      top_logprobs: Array<{
        token: string;
        logprob: number;
        bytes: number[];
      }>;
    }>;
  };
}

export interface OpenAIStreamDelta {
  role?: OpenAIRole;
  content?: string;
  function_call?: {
    name?: string;
    arguments?: string;
  };
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * Claude stream event types
 */
export interface ClaudeStreamMessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: [];
    stop_reason: null;
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export interface ClaudeStreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
}

export interface ClaudeStreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

export interface ClaudeStreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface ClaudeStreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface ClaudeStreamMessageStop {
  type: 'message_stop';
}

export interface ClaudeStreamPing {
  type: 'ping';
}

export interface ClaudeStreamError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export type ClaudeStreamEvent =
  | ClaudeStreamMessageStart
  | ClaudeStreamContentBlockStart
  | ClaudeStreamContentBlockDelta
  | ClaudeStreamContentBlockStop
  | ClaudeStreamMessageDelta
  | ClaudeStreamMessageStop
  | ClaudeStreamPing
  | ClaudeStreamError;

// ================= SSE Event Types =================

/**
 * Server-Sent Events (SSE) format
 */
export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Generic SSE parser result
 */
export interface ParsedSSEMessage {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

// ================= Error Types =================

/**
 * OpenAI error format
 */
export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}

/**
 * Claude error format
 */
export interface ClaudeError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ================= Conversion Helper Types =================

/**
 * Model mapping configuration
 */
export interface ModelMapping {
  openai: string;
  claude: string;
}

/**
 * Stream state for conversion
 */
export interface StreamConversionState {
  messageId: string;
  created: number;
  model: string;
  currentToolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  contentBlockStarted?: boolean;
  /**
   * Mapping of tool_use id → OpenAI tool_calls index during streaming conversion
   */
  toolCallIdToIndex?: Map<string, number>;
  /**
   * Next available OpenAI tool_calls index when a new tool_use appears
   */
  nextToolCallIndex?: number;
}

/**
 * Format converter function types
 */
export type RequestConverter<TFrom, TTo> = (request: TFrom) => TTo;
export type ResponseConverter<TFrom, TTo> = (response: TFrom, model?: string) => TTo;
export type StreamConverter<TFrom, TTo> = (
  chunk: TFrom,
  state: StreamConversionState
) => TTo | null;

// ================= Utility Types =================

/**
 * Deep partial type helper
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Extract array element type
 */
export type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

/**
 * API provider types
 */
export type APIProvider = 'openai' | 'claude' | 'anthropic';

/**
 * Request/Response pair type
 */
export interface APIExchange<TRequest, TResponse> {
  request: TRequest;
  response: TResponse;
}

/**
 * Streaming configuration
 */
export interface StreamConfig {
  onChunk?: (chunk: unknown) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  signal?: AbortSignal;
}
