/**
 * API Request Format Converter
 * @author jizhejiang
 * @date 2025-08-11
 * @update 2025-08-12
 * @description Bidirectional converter for request formats between Claude and OpenAI APIs
 *
 * This file contains functions to convert between Claude and OpenAI request formats.
 * The naming can be confusing as formatRequestOpenAI.ts contains functions that convert
 * in both directions:
 * - formatRequestOpenAI: Converts from Claude format TO OpenAI format
 * - convertClaudeToOpenAI: Alias/safe wrapper for formatRequestOpenAI
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
  ClaudeToolUseContent,
  ClaudeToolResultContent,
  ClaudeImageContent,
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
// This helper is currently unused but reserved for future functionality
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractBase64FromDataUrl(_dataUrl: string): { mediaType: string; data: string } | null {
  return null;
}

/**
 * Convert Claude image content to OpenAI format
 */
function convertImageContent(content: ClaudeImageContent): OpenAIImageContent {
  const casted = content as unknown as {
    source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
  };
  const { source } = casted;

  // Support both base64 and URL sources
  let url: string;
  if ((source as { type: string }).type === 'base64') {
    url = `data:${(source as { media_type: string; data: string }).media_type};base64,${(source as { media_type: string; data: string }).data}`;
  } else if ((source as { type: string }).type === 'url') {
    url = (source as { url: string }).url;
  } else {
    url = '';
  }

  return {
    type: 'image_url',
    image_url: {
      url,
      // Use 'auto' by default for image detail level
      detail: 'auto',
    },
  };
}

// Build a canonical signature for a tool call, ignoring common paging/windowing keys
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function canonicalizeToolCallSignature(name: string, argsJson: string): string {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(argsJson || '{}');
  } catch {
    return `${name}|${(argsJson || '').slice(0, 300)}`;
  }
  // Normalize common path fields to avoid ~/ vs absolute path mismatches
  const WORKSPACE_ROOT =
    (globalThis as unknown as { process?: { env?: Record<string, string> } })?.process?.env
      ?.WORKSPACE_ROOT || '/Volumes/JJZ/jerryjiang/code/ai';
  const normalizePath = (p: string): string => {
    if (p.startsWith('~/')) return `${WORKSPACE_ROOT}/${p.slice(2)}`.replace(/\\+/g, '/');
    return p.replace(/\\+/g, '/');
  };
  const PATH_KEYS = new Set(['file_path', 'filepath', 'file', 'path']);
  for (const k of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && PATH_KEYS.has(k)) {
      (obj as Record<string, unknown>)[k] = normalizePath(v);
    }
  }
  const IGNORE_KEYS = new Set([
    'offset',
    'limit',
    'start',
    'end',
    'range',
    'head_limit',
    '-C',
    '-A',
    '-B',
    'count',
    'files_with_matches',
    'output_mode',
    'glob',
    'type',
    'path_only',
    'preview',
    'page',
    'page_size',
  ]);
  const clean: Record<string, unknown> = {};
  const keys = Object.keys(obj)
    .filter((k) => !IGNORE_KEYS.has(k))
    .sort();
  for (const k of keys) clean[k] = (obj as Record<string, unknown>)[k];
  const canonical = JSON.stringify(clean);
  const head = canonical.slice(0, 300);
  return `${name}|${head}`;
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

      case 'image': {
        const img = convertImageContent(item);
        const url = (img.image_url && img.image_url.url) || '';
        // Guard: avoid extremely large data URLs that may exceed upstream limits
        if (typeof url === 'string' && url.startsWith('data:') && url.length > 120000) {
          convertedContent.push({ type: 'text', text: '[Image omitted due to size]' });
        } else {
          convertedContent.push(img);
        }
        break;
      }

      case 'tool_use':
        // Tool use will be handled separately as tool_calls
        toolCalls.push({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: clampText(JSON.stringify(item.input), 120000),
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
        console.warn('Unknown Claude content type');
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
function convertMessage(message: ClaudeMessage): OpenAIMessage | OpenAIMessage[] {
  // First, check if this message contains ONLY tool_result items
  // In Claude format, tool results are in user messages, but in OpenAI they should be tool messages
  if (Array.isArray(message.content)) {
    const hasOnlyToolResults = message.content.every((item) => item.type === 'tool_result');

    if (hasOnlyToolResults && message.content.length > 0) {
      // Convert directly to tool messages without creating a user message
      const toolMessages: OpenAIMessage[] = [];
      for (const item of message.content) {
        if (item.type === 'tool_result') {
          const resultContent =
            typeof item.content === 'string' ? item.content : JSON.stringify(item.content);

          const TOOL_RESULT_PREVIEW = 4000;
          toolMessages.push({
            role: 'tool',
            content: clampText(
              item.is_error ? `Error: ${resultContent}` : resultContent,
              TOOL_RESULT_PREVIEW
            ),
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
  // If assistant emits only tool_calls with no textual content, set content to null to avoid
  // zero-length input constraints while keeping tool_calls.
  if (
    openAIMessage.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.some((i) => i.type === 'tool_use')
  ) {
    const isEmptyString =
      typeof openAIMessage.content === 'string' && openAIMessage.content.trim().length === 0;
    const isEmptyArray =
      Array.isArray(openAIMessage.content) &&
      (openAIMessage.content as (OpenAITextContent | OpenAIImageContent)[]).length === 0;
    if (isEmptyString || isEmptyArray) {
      openAIMessage.content = '.';
    }
  }

  // Extract tool calls if present
  const toolCalls: OpenAIToolCall[] = [];
  if (Array.isArray(message.content)) {
    for (const item of message.content as ClaudeContent[]) {
      if ((item as ClaudeToolUseContent).type === 'tool_use') {
        const TOOL_ARG_PREVIEW = 4000;
        toolCalls.push({
          id: (item as ClaudeToolUseContent).id,
          type: 'function',
          function: {
            name: (item as ClaudeToolUseContent).name,
            arguments: clampText(
              JSON.stringify((item as ClaudeToolUseContent).input),
              TOOL_ARG_PREVIEW
            ),
          },
        });
      }
    }
  }

  // Add tool calls if present
  if (toolCalls.length > 0) {
    // Dedupe by tool call id to avoid duplicates
    const uniqueById = new Map<string, OpenAIToolCall>();
    for (const tc of toolCalls) {
      if (!uniqueById.has(tc.id)) uniqueById.set(tc.id, tc);
    }
    openAIMessage.tool_calls = Array.from(uniqueById.values());
    // If content is empty string or empty array, set to null to comply with providers that
    // require non-empty input length when content is present.
    const isEmptyString =
      typeof openAIMessage.content === 'string' && openAIMessage.content.trim().length === 0;
    const isEmptyArray =
      Array.isArray(openAIMessage.content) &&
      (openAIMessage.content as (OpenAITextContent | OpenAIImageContent)[]).length === 0;
    if (isEmptyString || isEmptyArray) {
      openAIMessage.content = '.';
    }
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
function extractSystemPrompt(
  system?: string | ClaudeSystemMessage[] | ClaudeSystemMessage | null
): string | null {
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
    .filter((msg) => msg && (msg as ClaudeSystemMessage).type === 'text')
    .map((msg) => (msg as ClaudeSystemMessage).text)
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

function clampText(input: string, maxChars: number): string {
  if (typeof input !== 'string') {
    return '';
  }
  if (input.length === 0) {
    return input;
  }
  return input.length > maxChars ? input.slice(0, Math.max(1, maxChars)) : input;
}

function clampOpenAIMessages(messages: OpenAIMessage[], maxChars: number): OpenAIMessage[] {
  return messages.map((m) => {
    const next: OpenAIMessage = { ...m };
    if (typeof next.content === 'string') {
      next.content = clampText(next.content, maxChars);
    } else if (Array.isArray(next.content)) {
      next.content = (next.content as (OpenAITextContent | OpenAIImageContent)[]).map((c) => {
        if (c.type === 'text') {
          return { ...c, text: clampText(c.text, maxChars) } as OpenAITextContent;
        }
        return c;
      });
    }
    return next;
  });
}

// enforceTotalCharBudget is currently unused but reserved for future functionality
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function enforceTotalCharBudget(messages: OpenAIMessage[], budget: number): OpenAIMessage[] {
  let remaining = Math.max(1, budget);
  const result: OpenAIMessage[] = [];

  for (const m of messages) {
    const next: OpenAIMessage = { ...m };
    if (typeof next.content === 'string') {
      const t = next.content as string;
      if (t.length <= remaining) {
        remaining -= t.length;
      } else {
        next.content = t.slice(0, remaining);
        remaining = 0;
      }
    } else if (Array.isArray(next.content)) {
      const arr = (next.content as (OpenAITextContent | OpenAIImageContent)[]).map((c) => {
        if (remaining <= 0) return c.type === 'text' ? { ...c, text: '' } : c;
        if (c.type === 'text') {
          const len = c.text.length;
          if (len <= remaining) {
            remaining -= len;
            return c;
          }
          const trimmed = c.text.slice(0, remaining);
          remaining = 0;
          return { ...c, text: trimmed } as OpenAITextContent;
        }
        return c;
      });
      next.content = arr;
    }
    result.push(next);
  }

  // Ensure at least 1 visible char overall
  if (budget > 0) {
    const hasAnyChar = result.some((m) => {
      if (typeof m.content === 'string') return (m.content as string).length > 0;
      if (Array.isArray(m.content))
        return (m.content as (OpenAITextContent | OpenAIImageContent)[]).some(
          (c) => c.type === 'text' && (c as OpenAITextContent).text.length > 0
        );
      return false;
    });
    if (!hasAnyChar) {
      // Prepend minimal user input
      result.unshift({ role: 'user', content: '.' });
    }
  }

  return result;
}

function findGoodBoundary(text: string): number {
  if (text.length <= 1) return text.length;
  const windowStart = Math.max(0, text.length - 120);
  const tail = text.slice(windowStart);
  const patterns = [/([\.\!\?。！？][\s\n\r])/g, /([\n\r])/g, /(\s)/g];
  let bestIndex = -1;
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(tail)) !== null) {
      bestIndex = windowStart + match.index + (re === patterns[0] ? 1 : 0);
    }
    if (bestIndex >= 0) break;
  }
  return bestIndex >= 0 ? bestIndex : text.length;
}

// Token encoder helper with graceful fallback if tiktoken is unavailable
interface TokenEncoder {
  encode: (text: string) => number[];
  decode: (tokens: number[]) => string;
}

// modelName is currently unused but reserved for future model-specific heuristics
function getTokenEncoder(): TokenEncoder {
  const approxEncode = (text: string): number[] => {
    if (!text) return [];
    const parts = text.match(/\w+|[^\s\w]/g) || [];
    return parts.map((_, idx) => idx + 1);
  };
  const approxDecode = (tokens: number[]): string => {
    const len = Array.isArray(tokens) ? tokens.length : 0;
    if (len <= 0) return '';
    return '.'.repeat(Math.min(len, 10));
  };
  return { encode: approxEncode, decode: approxDecode };
}

function smartTrimByTokens(enc: TokenEncoder, text: string, tokensAllowed: number): string {
  if (tokensAllowed <= 0) return '';
  const tokens = enc.encode(text);
  if (tokens.length <= tokensAllowed) return text;
  const slice = tokens.slice(0, Math.max(1, tokensAllowed));
  const decoded = enc.decode(slice);
  const cut = findGoodBoundary(decoded);
  const trimmed = decoded.slice(0, Math.max(1, cut));
  return trimmed.length > 0 ? trimmed : '.';
}

function groupMessagesForBudget(messages: OpenAIMessage[]): OpenAIMessage[][] {
  const groups: OpenAIMessage[][] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const group: OpenAIMessage[] = [msg];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        group.push(messages[j]);
        j++;
      }
      groups.push(group);
      i = j - 1;
    } else {
      groups.push([msg]);
    }
  }
  return groups;
}

function countMessageTokens(enc: TokenEncoder, m: OpenAIMessage): number {
  let tokens = 0;
  if (typeof m.content === 'string') {
    tokens += enc.encode(m.content).length;
  } else if (Array.isArray(m.content)) {
    for (const c of m.content as (OpenAITextContent | OpenAIImageContent)[]) {
      if (c.type === 'text') tokens += enc.encode(c.text).length;
      else if (c.type === 'image_url') tokens += enc.encode(c.image_url.url || '').length;
    }
  }
  if (m.tool_calls && Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls as Array<{ function: { name: string; arguments: string } }>) {
      tokens += enc.encode(tc.function.name).length;
      tokens += enc.encode(tc.function.arguments || '').length;
    }
  }
  return tokens;
}

export function enforceTotalTokenBudget(
  messages: OpenAIMessage[],
  budgetTokens: number,
  /* eslint-disable @typescript-eslint/no-unused-vars */ _unusedModel: string
): OpenAIMessage[] {
  const enc = getTokenEncoder();
  let remaining = Math.max(1, budgetTokens);

  const groups = groupMessagesForBudget(messages);
  const keptGroups: OpenAIMessage[][] = [];

  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const group = groups[gi];
    const groupTokens = group.reduce((sum, m) => sum + countMessageTokens(enc, m), 0);
    if (groupTokens <= remaining) {
      keptGroups.push(group);
      remaining -= groupTokens;
      continue;
    }

    const trimmedGroup: OpenAIMessage[] = [];
    for (let mi = 0; mi < group.length; mi++) {
      const m = { ...group[mi] } as OpenAIMessage;
      if (remaining <= 0) {
        if (typeof m.content === 'string') m.content = '';
        else if (Array.isArray(m.content)) {
          m.content = (m.content as (OpenAITextContent | OpenAIImageContent)[]).map((c) =>
            c.type === 'text' ? ({ ...c, text: '' } as OpenAITextContent) : c
          );
        }
        trimmedGroup.push(m);
        continue;
      }

      if (Array.isArray(m.content)) {
        const arr = (m.content as (OpenAITextContent | OpenAIImageContent)[]).map((c) => {
          if (remaining <= 0) {
            if (c.type === 'text') {
              return { ...c, text: '' } as OpenAITextContent;
            }
            return c;
          }
          if (c.type === 'text') {
            const newText = smartTrimByTokens(enc, c.text, remaining);
            const used = enc.encode(newText).length;
            remaining -= used;
            return { ...c, text: newText } as OpenAITextContent;
          }
          const url = (c as OpenAIImageContent).image_url.url || '';
          if (url.startsWith('data:')) {
            const placeholder = '[image omitted]';
            const used = enc.encode(placeholder).length;
            if (used <= remaining) {
              remaining -= used;
              return { type: 'text', text: placeholder } as OpenAITextContent;
            }
            return { type: 'text', text: '.' } as OpenAITextContent;
          }
          return c;
        });
        m.content = arr;
      } else if (typeof m.content === 'string') {
        const newText = smartTrimByTokens(enc, m.content, remaining);
        const used = enc.encode(newText).length;
        remaining -= used;
        m.content = newText;
      }

      trimmedGroup.push(m);
    }

    keptGroups.push(trimmedGroup);
    remaining = 0;
    break;
  }

  const result = keptGroups.reverse().flat();

  const hasAnyChar = result.some((m) => {
    if (typeof m.content === 'string') return m.content.trim().length > 0;
    if (Array.isArray(m.content))
      return (m.content as (OpenAITextContent | OpenAIImageContent)[]).some(
        (c) => c.type === 'text' && (c as OpenAITextContent).text.trim().length > 0
      );
    return false;
  });
  if (!hasAnyChar) {
    if (result.length > 0) {
      const first = result.find((m) => m.role === 'user') || result[0];
      if (typeof first.content === 'string') first.content = '.';
      else if (Array.isArray(first.content))
        (first.content as (OpenAITextContent | OpenAIImageContent)[]).unshift({
          type: 'text',
          text: '.',
        });
    } else {
      result.push({ role: 'user', content: '.' });
    }
  }

  return result;
}

function ensureToolCallAdjacency(messages: OpenAIMessage[]): OpenAIMessage[] {
  const arr = [...messages];

  for (let i = 0; i < arr.length; i++) {
    const msg = arr[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const neededIds = new Set((msg.tool_calls as OpenAIToolCall[]).map((tc) => tc.id));

      // Count immediate matching tool messages
      let insertPos = i + 1;
      let k = i + 1;
      while (k < arr.length && arr[k].role === 'tool') {
        const tm = arr[k];
        const id = (tm as OpenAIMessage & { tool_call_id?: string }).tool_call_id;
        if (id && neededIds.has(id)) {
          neededIds.delete(id);
          insertPos = k + 1;
          k++;
          continue;
        }
        break; // stop at first non-matching immediate tool message
      }

      // Search for additional matching tool messages later
      const toMoveIndices: number[] = [];
      for (let p = k; p < arr.length; p++) {
        const tm = arr[p];
        if (tm.role !== 'tool') continue;
        const id = (tm as OpenAIMessage & { tool_call_id?: string }).tool_call_id;
        if (id && neededIds.has(id)) {
          toMoveIndices.push(p);
          neededIds.delete(id);
        }
      }

      // Move found tool messages to be adjacent after current assistant
      if (toMoveIndices.length > 0) {
        const moved: OpenAIMessage[] = [];
        for (let idx = toMoveIndices.length - 1; idx >= 0; idx--) {
          const p = toMoveIndices[idx];
          const [tm] = arr.splice(p, 1);
          moved.unshift(tm);
        }
        arr.splice(insertPos, 0, ...moved);
        insertPos += moved.length;
      }

      // Dedupe adjacent tool messages by tool_call_id after reordering
      let dedupeStart = i + 1;
      while (dedupeStart < arr.length && arr[dedupeStart].role === 'tool') {
        const seenToolIds = new Set<string>();
        let j = dedupeStart;
        while (j < arr.length && arr[j].role === 'tool') {
          const id = (arr[j] as OpenAIMessage & { tool_call_id?: string }).tool_call_id;
          if (id && seenToolIds.has(id)) {
            arr.splice(j, 1);
            continue;
          }
          if (id) seenToolIds.add(id);
          j++;
        }
        break;
      }
    }
  }

  return arr;
}

/**
 * Ensure OpenAI messages meet minimal input requirements
 * - Remove empty text fragments
 * - Ensure at least one non-empty user text is present
 * - If first non-system message isn't user, prepend a minimal user message
 */
function sanitizeOpenAIMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  const sanitized: OpenAIMessage[] = [];

  // Remove empty text fragments in content arrays
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const filtered = (msg.content as (OpenAITextContent | OpenAIImageContent)[]).filter(
        (c) =>
          c.type !== 'text' ||
          (typeof (c as OpenAITextContent).text === 'string' &&
            (c as OpenAITextContent).text.trim().length > 0)
      );
      sanitized.push({ ...msg, content: filtered as (OpenAITextContent | OpenAIImageContent)[] });
    } else if (typeof msg.content === 'string') {
      // Keep as-is (including empty) to preserve tool_calls pairing; we'll add minimal input if needed later
      sanitized.push(msg);
    } else {
      sanitized.push(msg);
    }
  }

  // Detect if there is any non-empty text from user/assistant
  const hasNonEmptyUserOrAssistantText = sanitized.some((m) => {
    if (m.role === 'user' || m.role === 'assistant') {
      if (typeof m.content === 'string') {
        return m.content.trim().length > 0;
      }
      if (Array.isArray(m.content)) {
        return (m.content as (OpenAITextContent | OpenAIImageContent)[]).some((c) => {
          if (c.type !== 'text') return false;
          const t = (c as OpenAITextContent).text;
          return typeof t === 'string' && t.trim().length > 0;
        });
      }
    }
    return false;
  });

  // Find index of first non-system message
  const firstNonSystemIndex = sanitized.findIndex((m) => m.role !== 'system');

  // If no non-empty user/assistant text present, or first non-system message isn't user, prepend minimal user input
  if (
    !hasNonEmptyUserOrAssistantText ||
    (firstNonSystemIndex !== -1 && sanitized[firstNonSystemIndex].role !== 'user')
  ) {
    sanitized.unshift({ role: 'user', content: 'Continue.' });
  }

  return sanitized;
}

/**
 * Converts a request from Claude API format to OpenAI API format
 *
 * Note: Despite the name suggesting it formats OpenAI requests, this function
 * converts FROM Claude format TO OpenAI format. This naming is historical and
 * preserved for compatibility.
 *
 * @param request - A request object in Claude API format
 * @returns A request object in OpenAI API format
 * @throws Error if conversion fails
 *
 * Example:
 * ```typescript
 * const claudeRequest = {
 *   model: 'claude-3-sonnet-20240229',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   max_tokens: 1000
 * };
 * const openAIRequest = formatRequestOpenAI(claudeRequest);
 * // openAIRequest is now in OpenAI format
 * ```
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
    const converted = convertMessage(claudeMessage);

    if (Array.isArray(converted)) {
      messages.push(...converted);
    } else {
      messages.push(converted);
    }
  }

  // Adjust tool message adjacency and add placeholders if needed
  const adjusted = ensureToolCallAdjacency(messages);

  const sanitized = sanitizeOpenAIMessages(adjusted);
  // 使用可配置预算并保守留余量，默认遵循 129024 限制但为不同 provider 预留余地
  const DEFAULT_CHAR_BUDGET = 250000; // 对部分 provider 放宽
  const DEFAULT_TOKEN_BUDGET = 129000; // 遵循 129024 限制
  const clampedChars = clampOpenAIMessages(sanitized, DEFAULT_CHAR_BUDGET);

  // 为工具定义等元数据预留 token 开销，避免总输入超限
  const encForBudget = getTokenEncoder();
  const toolsOverheadTokens =
    Array.isArray(request.tools) && request.tools.length > 0
      ? encForBudget.encode(JSON.stringify(request.tools)).length
      : 0;
  const SAFETY_TOKENS = 1024; // 额外安全余量
  const effectiveTokenBudget = Math.max(
    1024,
    DEFAULT_TOKEN_BUDGET - toolsOverheadTokens - SAFETY_TOKENS
  );

  const tokenBudgeted = enforceTotalTokenBudget(
    clampedChars,
    effectiveTokenBudget,
    mapModel(request.model)
  );
  const openAIRequest: OpenAIRequest = {
    model: mapModel(request.model),
    messages: tokenBudgeted,
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
  } else {
    // 给缺省请求一个保守的默认生成上限，避免 provider 计入过多生成预算
    openAIRequest.max_tokens = Math.min(1024, openAIRequest.max_tokens || 1024);
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
  if (!request.model || !request.messages) {
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
 * Safely converts a request from Claude API format to OpenAI API format with validation
 *
 * This is a wrapper around formatRequestOpenAI that includes validation of the input request.
 * It validates the Claude request before attempting conversion.
 *
 * @param request - A request object in Claude API format
 * @returns A request object in OpenAI API format, or null if validation/conversion fails
 *
 * Example:
 * ```typescript
 * const claudeRequest = {
 *   model: 'claude-3-sonnet-20240229',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   max_tokens: 1000
 * };
 * const openAIRequest = convertClaudeToOpenAI(claudeRequest);
 * // openAIRequest is now in OpenAI format, or null if invalid
 * ```
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

/**
 * Converts a request from OpenAI API format to Claude API format
 */
export function convertOpenAIToClaude(request: OpenAIRequest): ClaudeRequest {
  type ClaudeBase64MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  // Extract system messages and normalize remaining messages
  const systemTexts: string[] = [];
  const nonSystemMessages: OpenAIMessage[] = [];

  const extractTextContent = (content: OpenAIMessageContent): string => {
    if (typeof content === 'string') return content;
    try {
      const texts = (content as Array<OpenAITextContent | OpenAIImageContent>)
        .filter((c) => (c as OpenAITextContent).type === 'text')
        .map((c) => (c as OpenAITextContent).text)
        .filter((t) => typeof t === 'string' && t.length > 0);
      return texts.join('\n');
    } catch {
      return '';
    }
  };

  for (const msg of request.messages || []) {
    if (msg.role === 'system') {
      const text = extractTextContent(msg.content);
      if (text) systemTexts.push(text);
      continue;
    }
    nonSystemMessages.push(msg);
  }

  // Helpers to map image content from OpenAI to Claude
  const convertOpenAIImageToClaude = (img: OpenAIImageContent): ClaudeImageContent => {
    const url = img.image_url?.url || '';
    if (url.startsWith('data:')) {
      // data URL: data:<mediaType>;base64,<data>
      const match = url.match(/^data:([^;]+);base64,(.+)$/i);
      if (match) {
        const mediaType = match[1] as ClaudeBase64MediaType;
        const data = match[2];
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data,
          },
        } as ClaudeImageContent;
      }
    }
    return {
      type: 'image',
      source: {
        type: 'url',
        url,
      },
    } as ClaudeImageContent;
  };

  // Convert OpenAI messages to Claude messages
  const claudeMessages: ClaudeMessage[] = [];
  let pendingToolResults: ClaudeToolResultContent[] = [];

  const flushPendingToolResults = (): void => {
    if (pendingToolResults.length > 0) {
      claudeMessages.push({
        role: 'user',
        content: pendingToolResults as unknown as ClaudeContent[],
      });
      pendingToolResults = [];
    }
  };

  for (const msg of nonSystemMessages) {
    if (msg.role === 'tool' || msg.role === 'function') {
      // Accumulate tool results to emit as a single Claude 'user' message
      const raw = typeof msg.content === 'string' ? msg.content : extractTextContent(msg.content);
      let parsed: string | Record<string, unknown> = raw;
      try {
        // Attempt to parse JSON tool results
        parsed = JSON.parse(raw);
      } catch {
        // keep raw string
      }
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: (msg as OpenAIMessage).tool_call_id || '',
        content: parsed,
      });
      continue;
    }

    // Flush any pending tool results before non-tool messages
    flushPendingToolResults();

    if (msg.role === 'user') {
      const parts: ClaudeContent[] = [];
      if (typeof msg.content === 'string') {
        parts.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if ((c as OpenAITextContent).type === 'text') {
            parts.push({ type: 'text', text: (c as OpenAITextContent).text });
          } else if ((c as OpenAIImageContent).type === 'image_url') {
            parts.push(convertOpenAIImageToClaude(c as OpenAIImageContent));
          }
        }
      }
      claudeMessages.push({ role: 'user', content: parts as unknown as ClaudeContent[] });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: ClaudeContent[] = [];
      // Text parts
      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) parts.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if ((c as OpenAITextContent).type === 'text') {
            const text = (c as OpenAITextContent).text;
            if (text && text.length > 0) parts.push({ type: 'text', text });
          } else if ((c as OpenAIImageContent).type === 'image_url') {
            parts.push(convertOpenAIImageToClaude(c as OpenAIImageContent));
          }
        }
      }
      // Tool calls
      if (Array.isArray((msg as OpenAIMessage).tool_calls)) {
        const toolCalls = ((msg as OpenAIMessage).tool_calls || []) as OpenAIToolCall[];
        for (const call of toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // keep empty
          }
          parts.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: args,
          } as ClaudeToolUseContent);
        }
      } else if ((msg as OpenAIMessage).function_call) {
        const fc = (msg as OpenAIMessage).function_call as { name: string; arguments: string };
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fc.arguments || '{}');
        } catch {
          // ignore parse error
        }
        parts.push({
          type: 'tool_use',
          id: `fc_${Date.now()}`,
          name: fc.name,
          input: args,
        } as ClaudeToolUseContent);
      }

      claudeMessages.push({ role: 'assistant', content: parts as unknown as ClaudeContent[] });
      continue;
    }
  }

  // Flush any trailing tool results
  flushPendingToolResults();

  // Map tools definition
  const convertTools = (tools?: OpenAITool[]): ClaudeTool[] | undefined => {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    const result: ClaudeTool[] = [];
    for (const t of tools) {
      if (!t || t.type !== 'function') continue;
      const fn = t.function;
      const params = (fn?.parameters || {}) as Record<string, unknown>;
      const properties = (params as { properties?: Record<string, unknown> }).properties || {};
      const required = (params as { required?: string[] }).required || [];
      const input_schema = {
        type: 'object' as const,
        properties,
        required,
        additionalProperties: fn?.strict === true ? false : undefined,
      };
      result.push({ name: fn.name, description: fn.description || '', input_schema });
    }
    return result.length > 0 ? result : undefined;
  };

  // Map tool choice
  const convertToolChoice = (
    choice: OpenAIRequest['tool_choice']
  ): ClaudeRequest['tool_choice'] | undefined => {
    if (!choice) return undefined;
    if (choice === 'auto') return { type: 'auto' };
    if (choice === 'required') return { type: 'any' };
    if (choice === 'none') return undefined;
    if ((choice as { type?: string }).type === 'function') {
      const name = (choice as { function?: { name?: string } }).function?.name;
      if (name) return { type: 'tool', name };
    }
    return undefined;
  };

  // Build final Claude request
  const claudeRequest: ClaudeRequest = {
    model: request.model,
    messages: claudeMessages,
    system: systemTexts.length > 0 ? systemTexts.join('\n') : undefined,
    max_tokens: Math.max(1, Number(request.max_tokens || 0) || 1024),
    temperature: request.temperature,
    top_p: request.top_p,
    stop_sequences: Array.isArray(request.stop)
      ? (request.stop as string[])
      : typeof request.stop === 'string'
        ? [request.stop]
        : undefined,
    stream: request.stream,
    metadata: request.user ? { user_id: request.user } : undefined,
    tools: convertTools(request.tools),
    tool_choice: convertToolChoice(request.tool_choice),
  };

  return claudeRequest;
}

// Export default converter
export default formatRequestOpenAI;
