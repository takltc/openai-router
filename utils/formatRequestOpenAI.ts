/**
 * Claude to OpenAI request format converter
 * @author jizhejiang
 * @date 2025-08-11
 * @update 2025-08-12
 * @description Converts Claude API request format to OpenAI format, including message mapping,
 * system prompts, tools conversion, and parameter mapping
 * 
 * Model Mapping Strategy (v2.0.0+):
 * - Primary: Direct pass-through - model names are transmitted without conversion
 * - Fallback: When mapping is needed (e.g., legacy compatibility):
 *   - claude-3-opus-20240229 → gpt-4
 *   - claude-3-sonnet-20240229 → gpt-4-turbo
 *   - claude-3-haiku-20240307 → gpt-3.5-turbo
 *   - Other models → pass through unchanged
 */

import type {
  ClaudeRequest,
  ClaudeMessage,
  ClaudeContent,
  ClaudeTextContent,
  ClaudeImageContent,
  ClaudeToolUseContent,
  ClaudeToolResultContent,
  ClaudeTool,
  ClaudeSystemMessage,
  OpenAIRequest,
  OpenAIMessage,
  OpenAIMessageContent,
  OpenAITextContent,
  OpenAIImageContent,
  OpenAITool,
  OpenAIFunction,
  OpenAIToolCall,
  RequestConverter,
} from './types';

// Model mapping removed - now passing model names directly without conversion

/**
 * Extract base64 data from data URL
 */
function extractBase64FromDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mediaType: match[1],
    data: match[2],
  };
}

/**
 * Convert Claude image content to OpenAI format
 */
function convertImageContent(content: ClaudeImageContent): OpenAIImageContent {
  const { source } = content;

  // Create data URL from base64 data
  const dataUrl = `data:${source.media_type};base64,${source.data}`;

  return {
    type: 'image_url',
    image_url: {
      url: dataUrl,
      // Use 'auto' by default for image detail level
      detail: 'auto',
    },
  };
}

/**
 * Convert Claude content array to OpenAI content format
 */
function convertContent(content: string | ClaudeContent[]): OpenAIMessageContent {
  // If content is a string, return it directly
  if (typeof content === 'string') {
    return content;
  }

  // If content is an array, convert each item
  const convertedContent: (OpenAITextContent | OpenAIImageContent)[] = [];
  let toolCalls: OpenAIToolCall[] = [];
  let toolResults: string[] = [];

  for (const item of content) {
    switch (item.type) {
      case 'text':
        convertedContent.push({
          type: 'text',
          text: item.text,
        });
        break;

      case 'image':
        convertedContent.push(convertImageContent(item));
        break;

      case 'tool_use':
        // Tool use will be handled separately as tool_calls
        toolCalls.push({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: JSON.stringify(item.input),
          },
        });
        break;

      case 'tool_result':
        // Tool results will be combined into text content
        const resultText =
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content);

        if (item.is_error) {
          toolResults.push(`[Tool Error: ${item.tool_use_id}] ${resultText}`);
        } else {
          toolResults.push(`[Tool Result: ${item.tool_use_id}] ${resultText}`);
        }
        break;

      default:
        // Fallback for unknown content types
        console.warn(`Unknown Claude content type: ${(item as any).type}`);
        break;
    }
  }

  // If we have tool results, add them as text content
  if (toolResults.length > 0) {
    convertedContent.push({
      type: 'text',
      text: toolResults.join('\n'),
    });
  }

  // If only text content and single item, return as string
  if (convertedContent.length === 1 && convertedContent[0].type === 'text') {
    return convertedContent[0].text;
  }

  // Return content array if multiple items or contains images
  return convertedContent.length > 0 ? convertedContent : '';
}

/**
 * Convert Claude message to OpenAI message format
 */
function convertMessage(
  message: ClaudeMessage,
  systemPrompt?: string | null
): OpenAIMessage | OpenAIMessage[] {
  // First, check if this message contains ONLY tool_result items
  // In Claude format, tool results are in user messages, but in OpenAI they should be tool messages
  if (Array.isArray(message.content)) {
    const hasOnlyToolResults = message.content.every(
      item => item.type === 'tool_result'
    );
    
    if (hasOnlyToolResults && message.content.length > 0) {
      // Convert directly to tool messages without creating a user message
      const toolMessages: OpenAIMessage[] = [];
      for (const item of message.content) {
        if (item.type === 'tool_result') {
          const resultContent =
            typeof item.content === 'string' ? item.content : JSON.stringify(item.content);

          toolMessages.push({
            role: 'tool',
            content: item.is_error ? `Error: ${resultContent}` : resultContent,
            tool_call_id: item.tool_use_id,
          });
        }
      }
      return toolMessages;
    }
  }

  // Standard conversion for other messages
  const openAIMessage: OpenAIMessage = {
    role: message.role === 'user' ? 'user' : 'assistant',
    content: '',
  };

  // Handle content conversion
  const content = convertContent(message.content);
  openAIMessage.content = content;

  // Extract tool calls if present
  const toolCalls: OpenAIToolCall[] = [];
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item.type === 'tool_use') {
        toolCalls.push({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: JSON.stringify(item.input),
          },
        });
      }
    }
  }

  // Add tool calls if present
  if (toolCalls.length > 0) {
    openAIMessage.tool_calls = toolCalls;
  }

  // Handle mixed content with tool results (rare case)
  const toolMessages: OpenAIMessage[] = [];
  let hasNonToolResultContent = false;
  
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item.type === 'tool_result') {
        const resultContent =
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content);

        toolMessages.push({
          role: 'tool',
          content: item.is_error ? `Error: ${resultContent}` : resultContent,
          tool_call_id: item.tool_use_id,
        });
      } else if (item.type !== 'tool_use') {
        hasNonToolResultContent = true;
      }
    }
  }

  // Return array if we have tool messages mixed with other content
  if (toolMessages.length > 0 && hasNonToolResultContent) {
    // This is a mixed message - return both the regular message and tool messages
    return [openAIMessage, ...toolMessages];
  }

  return openAIMessage;
}

/**
 * Extract system prompt from Claude system field
 */
function extractSystemPrompt(system?: string | ClaudeSystemMessage[] | ClaudeSystemMessage | null): string | null {
  if (!system) {
    return null;
  }

  if (typeof system === 'string') {
    return system;
  }

  // If a single ClaudeSystemMessage object is provided, normalize to array
  const arr = Array.isArray(system) ? system : [system as ClaudeSystemMessage];

  // Extract text safely from ClaudeSystemMessage array
  const systemTexts = arr
    .filter((msg) => msg && (msg as any).type === 'text')
    .map((msg) => (msg as any).text)
    .filter((t) => typeof t === 'string' && t.length > 0);

  return systemTexts.length > 0 ? systemTexts.join('\n') : null;
}

/**
 * Convert Claude tool to OpenAI function/tool format
 */
function convertTool(claudeTool: ClaudeTool): OpenAITool {
  const openAIFunction: OpenAIFunction = {
    name: claudeTool.name,
    description: claudeTool.description,
    parameters: {
      type: claudeTool.input_schema.type,
      properties: claudeTool.input_schema.properties,
      required: claudeTool.input_schema.required || [],
    },
  };

  return {
    type: 'function',
    function: openAIFunction,
  };
}

/**
 * Convert Claude tool_choice to OpenAI format
 */
function convertToolChoice(claudeToolChoice?: {
  type: 'auto' | 'any' | 'tool';
  name?: string;
}): OpenAIRequest['tool_choice'] {
  if (!claudeToolChoice) {
    return undefined;
  }

  switch (claudeToolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      if (claudeToolChoice.name) {
        return {
          type: 'function',
          function: { name: claudeToolChoice.name },
        };
      }
      return 'required';
    default:
      return 'auto';
  }
}

/**
 * Map Claude model to OpenAI model
 * 
 * Current implementation: Direct pass-through without any conversion.
 * Returns the input model name as-is to support flexible model routing.
 * 
 * Note: If model mapping is needed in the future, implement the mapping logic here.
 * For scenarios where no model name is provided, a default mapping could be used.
 * 
 * @param claudeModel - The Claude model name to map
 * @returns The model name unchanged (pass-through)
 */
function mapModel(claudeModel: string): string {
  // Direct pass-through - no conversion
  // If the model name is not in a predefined mapping, return the original value
  return claudeModel;
}

/**
 * Convert Claude request to OpenAI format
 * Main converter function that handles all aspects of the conversion
 */
export const formatRequestOpenAI: RequestConverter<ClaudeRequest, OpenAIRequest> = (
  request: ClaudeRequest
): OpenAIRequest => {
  // Extract system prompt
  const systemPrompt = extractSystemPrompt(request.system);

  // Convert messages
  const messages: OpenAIMessage[] = [];

  // Add system message if present
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  // Convert all Claude messages
  for (const claudeMessage of request.messages) {
    const converted = convertMessage(claudeMessage, systemPrompt);

    if (Array.isArray(converted)) {
      messages.push(...converted);
    } else {
      messages.push(converted);
    }
  }

  // Build OpenAI request
  const openAIRequest: OpenAIRequest = {
    model: mapModel(request.model),
    messages,
  };

  // Map temperature (same range for both APIs: 0-2 for Claude, 0-2 for OpenAI)
  if (request.temperature !== undefined) {
    openAIRequest.temperature = request.temperature;
  }

  // Map top_p (same parameter name and range)
  if (request.top_p !== undefined) {
    openAIRequest.top_p = request.top_p;
  }

  // Map max_tokens
  if (request.max_tokens !== undefined) {
    openAIRequest.max_tokens = request.max_tokens;
  }

  // Map stop sequences
  if (request.stop_sequences && request.stop_sequences.length > 0) {
    openAIRequest.stop = request.stop_sequences;
  }

  // Map stream flag
  if (request.stream !== undefined) {
    openAIRequest.stream = request.stream;
  }

  // Map user metadata
  if (request.metadata?.user_id) {
    openAIRequest.user = request.metadata.user_id;
  }

  // Convert tools
  if (request.tools && request.tools.length > 0) {
    openAIRequest.tools = request.tools.map(convertTool);
  }

  // Convert tool choice
  if (request.tool_choice) {
    openAIRequest.tool_choice = convertToolChoice(request.tool_choice);
  }

  // Note: Claude's top_k parameter has no direct equivalent in OpenAI
  // We could potentially map it to logit_bias or other parameters,
  // but for now we'll omit it as it's model-specific

  return openAIRequest;
};

/**
 * Validate and format Claude request before conversion
 * This function ensures the Claude request is valid before conversion
 */
export function validateClaudeRequest(request: ClaudeRequest): boolean {
  // Check required fields
  if (!request.model || !request.messages || !request.max_tokens) {
    return false;
  }

  // Check messages array is not empty
  if (request.messages.length === 0) {
    return false;
  }

  // Check message roles alternate correctly (Claude requirement)
  let lastRole: string | null = null;
  for (const message of request.messages) {
    if (message.role === lastRole) {
      console.warn('Claude messages should alternate between user and assistant roles');
    }
    lastRole = message.role;
  }

  // Validate temperature range
  if (request.temperature !== undefined) {
    if (request.temperature < 0 || request.temperature > 2) {
      console.warn(`Temperature ${request.temperature} is out of range (0-2)`);
      return false;
    }
  }

  // Validate top_p range
  if (request.top_p !== undefined) {
    if (request.top_p < 0 || request.top_p > 1) {
      console.warn(`Top_p ${request.top_p} is out of range (0-1)`);
      return false;
    }
  }

  return true;
}

/**
 * Helper function to convert with validation
 */
export function convertClaudeToOpenAI(request: ClaudeRequest): OpenAIRequest | null {
  if (!validateClaudeRequest(request)) {
    console.error('Invalid Claude request format');
    return null;
  }

  try {
    return formatRequestOpenAI(request);
  } catch (error) {
    console.error('Error converting Claude request to OpenAI format:', error);
    return null;
  }
}

// Export default converter
export default formatRequestOpenAI;
