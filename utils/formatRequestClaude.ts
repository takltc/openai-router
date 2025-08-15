/**
 * OpenAI to Claude request format converter
 * @author jizhejiang
 * @date 2025-08-11
 * @update 2025-08-12
 * @description Converts OpenAI API request format to Claude format, including message mapping,
 * system prompts, function_call/tool_use conversion, and parameter mapping
 *
 * Model Mapping Strategy (v2.0.0+):
 * - Primary: Direct pass-through - model names are transmitted without conversion
 * - Fallback: When mapping is needed (e.g., legacy compatibility):
 *   - gpt-4 → claude-3-opus-20240229
 *   - gpt-4-turbo → claude-3-sonnet-20240229
 *   - gpt-3.5-turbo → claude-3-haiku-20240307
 *   - Other models → pass through unchanged
 */

import type {
  OpenAIRequest,
  OpenAIMessage,
  OpenAIMessageContent,
  OpenAIImageContent,
  OpenAITool,
  OpenAIFunction,
  OpenAIToolCall,
  ClaudeRequest,
  ClaudeMessage,
  ClaudeContent,
  ClaudeImageContent,
  ClaudeToolUseContent,
  ClaudeToolResultContent,
  ClaudeTool,
  ClaudeSystemMessage,
  RequestConverter,
  OpenAIResponseFormat,
} from './types';

// Model mapping removed - now passing model names directly without conversion

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract base64 data and media type from OpenAI image URL
 */
function extractBase64FromImageUrl(url: string): { mediaType: string; data: string } | null {
  // Handle data URLs
  const dataUrlMatch = url.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mediaType: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  // For HTTP(S) URLs: we'll pass through as Claude URL source later,
  // so here we simply return null to indicate base64 not available
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return null;
  }

  return null;
}

/**
 * Map OpenAI media type to Claude supported types
 */
function mapMediaType(mediaType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const normalized = mediaType.toLowerCase();

  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return 'image/jpeg';
  } else if (normalized.includes('png')) {
    return 'image/png';
  } else if (normalized.includes('gif')) {
    return 'image/gif';
  } else if (normalized.includes('webp')) {
    return 'image/webp';
  }

  // Default to JPEG for unknown types
  console.warn(`Unknown media type ${mediaType}, defaulting to image/jpeg`);
  return 'image/jpeg';
}

/**
 * Convert OpenAI image content to Claude format
 */
function convertImageContent(content: OpenAIImageContent): ClaudeImageContent | null {
  const { image_url } = content;
  const extracted = extractBase64FromImageUrl(image_url.url);

  if (!extracted) {
    // If it's an HTTP(S) URL, pass through as Claude URL source
    if (image_url.url.startsWith('http://') || image_url.url.startsWith('https://')) {
      return {
        type: 'image',
        source: {
          type: 'url',
          url: image_url.url,
        },
      };
    }
    return null;
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mapMediaType(extracted.mediaType),
      data: extracted.data,
    },
  };
}

/**
 * Convert OpenAI message content to Claude content format
 */
function convertMessageContent(
  content: OpenAIMessageContent,
  toolCalls?: OpenAIToolCall[],
  toolCallId?: string
): string | ClaudeContent[] {
  // Handle tool result messages
  if (toolCallId) {
    const toolResult: ClaudeToolResultContent = {
      type: 'tool_result',
      tool_use_id: toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };

    // Check if content indicates an error
    if (typeof content === 'string' && content.toLowerCase().startsWith('error:')) {
      toolResult.is_error = true;
    }

    return [toolResult];
  }

  // Handle string content
  if (typeof content === 'string') {
    // If we have tool calls, combine text with tool use
    if (toolCalls && toolCalls.length > 0) {
      const claudeContent: ClaudeContent[] = [];

      // Add text content if not empty
      if (content.trim()) {
        claudeContent.push({
          type: 'text',
          text: content,
        });
      }

      // Add tool use content
      for (const toolCall of toolCalls) {
        let toolInput;
        try {
          toolInput = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error('Failed to parse tool call arguments in convertMessageContent (array):', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            stack: parseError instanceof Error ? parseError.stack : undefined,
            toolCallSummary: {
              id: toolCall.id,
              name: toolCall.function.name,
              argumentsPreview: toolCall.function.arguments?.substring(0, 200) || '',
            },
          });
          toolInput = {};
        }
        const toolUse: ClaudeToolUseContent = {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: toolInput,
        };
        claudeContent.push(toolUse);
      }

      return claudeContent;
    }

    // Simple string content
    return content;
  }

  // Handle array content or null/undefined content with tool_calls
  const claudeContent: ClaudeContent[] = [];

  // Process array content if it exists
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        claudeContent.push({
          type: 'text',
          text: item.text,
        });
      } else if (item.type === 'image_url') {
        const imageContent = convertImageContent(item);
        if (imageContent) {
          claudeContent.push(imageContent);
        } else {
          // If image cannot be converted, add a text placeholder
          claudeContent.push({
            type: 'text',
            text: `[Image: ${item.image_url.url}]`,
          });
        }
      }
    }
  }

  // Add tool calls if present (regardless of content being null/undefined/array)
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      let toolInput;
      try {
        toolInput = JSON.parse(toolCall.function.arguments);
      } catch (parseError) {
        console.error('Failed to parse tool call arguments in convertMessageContent (toolCalls):', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
          toolCallSummary: {
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsPreview: toolCall.function.arguments?.substring(0, 200) || '',
          },
        });
        toolInput = {};
      }
      const toolUse: ClaudeToolUseContent = {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: toolInput,
      };
      claudeContent.push(toolUse);
    }
  }

  // If only one text content, return as string
  if (claudeContent.length === 1 && claudeContent[0].type === 'text') {
    return claudeContent[0].text;
  }

  return claudeContent;
}

/**
 * Convert OpenAI message to Claude message format
 */
function convertMessage(message: OpenAIMessage): ClaudeMessage | null {
  // Handle system messages - will be extracted separately
  if (message.role === 'system') {
    return null;
  }

  // Handle function/tool messages
  if (message.role === 'function' || message.role === 'tool') {
    // Tool results are handled as part of user messages in Claude
    // Create a user message with tool_result content
    const toolResultContent: ClaudeToolResultContent = {
      type: 'tool_result',
      tool_use_id: message.tool_call_id || message.name || 'unknown',
      content:
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    };

    // Check if it's an error response
    if (typeof message.content === 'string' && message.content.toLowerCase().includes('error')) {
      toolResultContent.is_error = true;
    }

    return {
      role: 'user',
      content: [toolResultContent],
    };
  }

  // Convert user or assistant messages
  const claudeRole = message.role === 'user' ? 'user' : 'assistant';

  // Handle function_call (legacy OpenAI format)
  if (message.function_call) {
    const toolUse: ClaudeToolUseContent = {
      type: 'tool_use',
      id: `func_${Date.now()}`,
      name: message.function_call.name,
      input: (() => {
        try {
          return JSON.parse(message.function_call.arguments);
        } catch (parseError) {
          console.error('Failed to parse function call arguments in convertMessage:', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            stack: parseError instanceof Error ? parseError.stack : undefined,
            functionCallSummary: {
              name: message.function_call.name,
              argumentsPreview: message.function_call.arguments?.substring(0, 200) || '',
            },
          });
          return {};
        }
      })(),
    };

    const content: ClaudeContent[] = [];

    // Add text content if present
    if (message.content && typeof message.content === 'string' && message.content.trim()) {
      content.push({
        type: 'text',
        text: message.content,
      });
    }

    content.push(toolUse);

    return {
      role: claudeRole,
      content,
    };
  }

  // Convert content with tool_calls
  // Handle assistant messages without content but with tool_calls
  const messageContent = message.content !== undefined ? message.content : '';
  const content = convertMessageContent(messageContent, message.tool_calls, message.tool_call_id);

  return {
    role: claudeRole,
    content,
  };
}

/**
 * Extract system messages from OpenAI messages
 */
function extractSystemMessages(messages: OpenAIMessage[]): {
  system: string | ClaudeSystemMessage[] | undefined;
  otherMessages: OpenAIMessage[];
} {
  const systemMessages: string[] = [];
  const otherMessages: OpenAIMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((item) => (item.type === 'text' ? item.text : '[non-text content]'))
              .join(' ');
      systemMessages.push(content);
    } else {
      otherMessages.push(message);
    }
  }

  if (systemMessages.length === 0) {
    return { system: undefined, otherMessages };
  }

  // Combine multiple system messages
  const combinedSystem = systemMessages.join('\n\n');

  // Return as simple string or as ClaudeSystemMessage array for caching
  return {
    system: combinedSystem,
    otherMessages,
  };
}

/**
 * Convert OpenAI tool/function to Claude tool format
 */
function convertTool(openAITool: OpenAITool | OpenAIFunction): ClaudeTool {
  // Handle both OpenAITool and OpenAIFunction formats
  const func = 'function' in openAITool ? openAITool.function : openAITool;

  const parameterRecord = func.parameters as Record<string, unknown>;
  const propsCandidate = (parameterRecord as { properties?: unknown }).properties;
  const properties = isRecord(propsCandidate)
    ? (propsCandidate as Record<string, unknown>)
    : parameterRecord;
  const requiredCandidate = (parameterRecord as { required?: unknown }).required;
  const required =
    Array.isArray(requiredCandidate) && requiredCandidate.every((x) => typeof x === 'string')
      ? (requiredCandidate as string[])
      : [];

  return {
    name: func.name,
    description: func.description || `Function ${func.name}`,
    input_schema: {
      type: 'object',
      properties,
      required,
      // Map OpenAI function.strict → additionalProperties: false when strict === true
      ...(func.strict === true ? { additionalProperties: false } : {}),
    },
  };
}

/**
 * Convert OpenAI tool_choice to Claude format
 */
function convertToolChoice(
  openAIToolChoice?: OpenAIRequest['tool_choice']
): ClaudeRequest['tool_choice'] {
  if (!openAIToolChoice) {
    return undefined;
  }

  if (typeof openAIToolChoice === 'string') {
    switch (openAIToolChoice) {
      case 'none':
        return undefined; // Claude doesn't have a 'none' option
      case 'auto':
        return { type: 'auto' };
      case 'required':
        return { type: 'any' };
      default:
        return { type: 'auto' };
    }
  }

  // Handle specific function choice
  if (openAIToolChoice.type === 'function' && openAIToolChoice.function?.name) {
    return {
      type: 'tool',
      name: openAIToolChoice.function.name,
    };
  }

  return { type: 'auto' };
}

/**
 * Map OpenAI model to Claude model
 *
 * Current implementation: Direct pass-through without any conversion.
 * Returns the input model name as-is to support flexible model routing.
 *
 * Note: If model mapping is needed in the future, implement the mapping logic here.
 * For scenarios where no model name is provided, a default mapping could be used.
 *
 * @param openAIModel - The OpenAI model name to map
 * @returns The model name unchanged (pass-through)
 */
function mapModel(openAIModel: string): string {
  // Direct pass-through - no conversion
  // If the model name is not in a predefined mapping, return the original value
  return openAIModel;
}

/**
 * Calculate max_tokens if not specified
 *
 * Current implementation: Returns a universal default value for all models.
 * This ensures compatibility with any model name without hardcoded checks.
 *
 * @param model - The model name (unused in current implementation)
 * @returns Default max_tokens value of 4096
 */
function calculateMaxTokens(): number {
  // Default high ceiling to avoid premature truncation when caller omits max_tokens.
  // Note: Upstream providers may clamp or reject if exceeding model limits.
  // If needed, introduce model-specific caps via configuration.
  return 262000; // ≈262K
}

/**
 * Convert OpenAI request to Claude format
 * Main converter function that handles all aspects of the conversion
 */
export const formatRequestClaude: RequestConverter<OpenAIRequest, ClaudeRequest> = (
  request: OpenAIRequest
): ClaudeRequest => {
  // Extract system messages
  const { system, otherMessages } = extractSystemMessages(request.messages);

  // Convert non-system messages
  const claudeMessages: ClaudeMessage[] = [];

  for (const openAIMessage of otherMessages) {
    const converted = convertMessage(openAIMessage);
    if (converted) {
      claudeMessages.push(converted);
    }
  }

  // Ensure every tool_use has matching tool_result
  const completedMessages = ensureToolResultCoverage(claudeMessages);

  // Ensure messages alternate between user and assistant
  // Claude requires this strict alternation
  const validatedMessages = validateMessageAlternation(completedMessages);

  // Map model
  const claudeModel = mapModel(request.model);

  // Build Claude request
  const claudeRequest: ClaudeRequest = {
    model: claudeModel,
    messages: validatedMessages,
    max_tokens: request.max_tokens || calculateMaxTokens(),
  };

  // Add system prompt if present
  if (system) {
    claudeRequest.system = system;
  }

  // Map temperature (same range 0-2 for both APIs)
  if (request.temperature !== undefined) {
    claudeRequest.temperature = request.temperature;
  }

  // Map top_p (same parameter name and range)
  if (request.top_p !== undefined) {
    claudeRequest.top_p = request.top_p;
  }

  // Map stop sequences
  if (request.stop) {
    if (typeof request.stop === 'string') {
      claudeRequest.stop_sequences = [request.stop];
    } else {
      claudeRequest.stop_sequences = request.stop;
    }
  }

  // Map stream flag
  if (request.stream !== undefined) {
    claudeRequest.stream = request.stream;
  }

  // Map user metadata
  if (request.user) {
    claudeRequest.metadata = {
      user_id: request.user,
    };
  }

  // Convert tools (both 'tools' and legacy 'functions' format)
  const tools: ClaudeTool[] = [];

  if (request.tools && request.tools.length > 0) {
    tools.push(...request.tools.map(convertTool));
  }

  if (request.functions && request.functions.length > 0) {
    tools.push(...request.functions.map(convertTool));
  }

  if (tools.length > 0) {
    claudeRequest.tools = tools;
  }

  // Convert tool choice
  if (request.tool_choice) {
    claudeRequest.tool_choice = convertToolChoice(request.tool_choice);
  } else if (request.function_call) {
    // Handle legacy function_call parameter
    if (typeof request.function_call === 'string') {
      switch (request.function_call) {
        case 'none':
          // Explicitly disable tool usage by setting any tool_choice and omitting tools
          delete claudeRequest.tools;
          break;
        case 'auto':
          claudeRequest.tool_choice = { type: 'auto' };
          break;
        default:
          claudeRequest.tool_choice = { type: 'auto' };
      }
    } else if (request.function_call.name) {
      claudeRequest.tool_choice = {
        type: 'tool',
        name: request.function_call.name,
      };
    }
  }

  // If tool_choice is explicitly 'none' in OpenAI format, ensure tools are not sent to Claude
  if (request.tool_choice === 'none') {
    delete claudeRequest.tools;
    delete claudeRequest.tool_choice;
  }

  // Response format mapping
  if (request.response_format) {
    const rf = request.response_format as OpenAIResponseFormat;
    if (rf.type === 'json_object') {
      const jsonHint = 'Respond with a valid, strictly formatted JSON object only, no extra text.';
      if (typeof claudeRequest.system === 'string') {
        claudeRequest.system = `${claudeRequest.system}\n\n${jsonHint}`;
      } else if (Array.isArray(claudeRequest.system)) {
        claudeRequest.system = [...claudeRequest.system, { type: 'text', text: jsonHint }];
      } else {
        claudeRequest.system = jsonHint;
      }
    } else if (rf.type === 'json_schema') {
      // Enforce schema via system instruction; Anthropic 无原生 json_schema 参数
      const name = rf.json_schema?.name || 'json_schema';
      const schema = rf.json_schema?.schema || {};
      const strict = rf.json_schema?.strict === true;
      const schemaHint = `You must return JSON that strictly conforms to the provided JSON Schema named "${name}". Strict: ${strict}. Schema: ${JSON.stringify(schema)}. No extra text.`;
      if (typeof claudeRequest.system === 'string') {
        claudeRequest.system = `${claudeRequest.system}\n\n${schemaHint}`;
      } else if (Array.isArray(claudeRequest.system)) {
        claudeRequest.system = [...claudeRequest.system, { type: 'text', text: schemaHint }];
      } else {
        claudeRequest.system = schemaHint;
      }
    }
  }

  // Note: Some OpenAI parameters have no Claude equivalents:
  // - n (number of completions)
  // - presence_penalty
  // - frequency_penalty
  // - logit_bias
  // - response_format
  // - seed
  // - logprobs
  // - top_logprobs

  // Note: Claude's top_k parameter has no OpenAI equivalent
  // Could be set to a reasonable default if needed

  return claudeRequest;
};

/**
 * Validate and fix message alternation for Claude
 * Claude requires strict user/assistant alternation
 */
function validateMessageAlternation(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const validated: ClaudeMessage[] = [];
  let lastRole: ClaudeMessage['role'] | null = null;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // If same role appears consecutively, merge them
    if (lastRole === message.role && validated.length > 0) {
      const lastMessage = validated[validated.length - 1];

      // Merge content for consecutive messages of the same role
      if (typeof lastMessage.content === 'string' && typeof message.content === 'string') {
        lastMessage.content = `${lastMessage.content}\n\n${message.content}`;
      } else {
        // Convert to array and merge
        const lastContent = Array.isArray(lastMessage.content)
          ? lastMessage.content
          : typeof lastMessage.content === 'string'
            ? [{ type: 'text' as const, text: lastMessage.content }]
            : [];

        const currentContent = Array.isArray(message.content)
          ? message.content
          : typeof message.content === 'string'
            ? [{ type: 'text' as const, text: message.content }]
            : [];

        lastMessage.content = [...lastContent, ...currentContent];
      }
    } else {
      validated.push(message);
      lastRole = message.role;
    }
  }

  // Ensure first message is from user
  if (validated.length > 0 && validated[0].role !== 'user') {
    // Add a minimal user message at the beginning
    validated.unshift({
      role: 'user',
      content: 'Continue.',
    });
  }

  return validated;
}

/**
 * Ensure every assistant tool_use has a corresponding user tool_result.
 * If a tool_use is missing its result, we leave it as-is since the API will
 * provide a clear error message about which tool_call_id is missing.
 * This approach is similar to gemini-router's handling.
 */
function ensureToolResultCoverage(messages: ClaudeMessage[]): ClaudeMessage[] {
  // For now, just return messages as-is without injecting empty results
  // The API will provide clear error messages if tool results are missing
  // This prevents masking the actual issue with empty results
  return messages;
}

// Export additional utilities for testing
export const __testing = {
  extractBase64FromImageUrl,
  mapMediaType,
  convertImageContent,
  convertMessageContent,
  convertMessage,
  extractSystemMessages,
  convertTool,
  convertToolChoice,
  mapModel,
  calculateMaxTokens,
  validateMessageAlternation,
};
