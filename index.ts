/**
 * OpenAI Router for Cloudflare Workers
 * @author jizhejiang
 * @date 2025-08-11
 * @description Routes OpenAI and Anthropic API requests through Cloudflare Workers with format conversion
 */

import { formatRequestClaude } from './utils/formatRequestClaude';
import { convertClaudeToOpenAI } from './utils/formatRequestOpenAI';
import { formatResponseOpenAI } from './utils/formatResponseOpenAI';
import { formatResponseClaude } from './utils/formatResponseClaude';
import { createOpenAIToClaudeTransform } from './utils/streamResponseOpenAI';
import { createClaudeToOpenAITransform } from './utils/streamResponseClaude';

export interface Env {
  OPENAI_BASE_URL: string;
  ANTHROPIC_BASE_URL: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // Route based on path
      // Format conversion endpoints
      if (url.pathname === '/v1/chat/completions') {
        // OpenAI format -> Claude API
        return await handleOpenAIToClaude(request, env, corsHeaders);
      } else if (url.pathname === '/v1/messages') {
        // Claude format -> OpenAI API
        return await handleClaudeToOpenAI(request, env, corsHeaders);
      }
      // Direct proxy endpoints (no conversion)
      else if (url.pathname.startsWith('/openai/') || url.pathname === '/openai') {
        return await handleOpenAIRequest(request, env, corsHeaders);
      } else if (url.pathname.startsWith('/anthropic/') || url.pathname === '/anthropic') {
        return await handleAnthropicRequest(request, env, corsHeaders);
      } else if (url.pathname === '/') {
        return handleRootRequest(corsHeaders);
      } else {
        return new Response('Not Found', {
          status: 404,
          headers: corsHeaders,
        });
      }
    } catch (error) {
      console.error('Error processing request:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  },
};

async function handleOpenAIRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = url.pathname.replace('/openai', '');
  const targetUrl = `${env.OPENAI_BASE_URL}${targetPath}${url.search}`;

  const headers = new Headers(request.headers);

  // Add API key if configured
  if (env.OPENAI_API_KEY && !headers.get('Authorization')) {
    headers.set('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body,
  });

  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

async function handleAnthropicRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = url.pathname.replace('/anthropic', '');
  const targetUrl = `${env.ANTHROPIC_BASE_URL}${targetPath}${url.search}`;

  const headers = new Headers(request.headers);

  // Add API key if configured
  if (env.ANTHROPIC_API_KEY && !headers.get('X-API-Key')) {
    headers.set('X-API-Key', env.ANTHROPIC_API_KEY);
  }

  // Ensure anthropic-version header is set
  if (!headers.get('anthropic-version')) {
    headers.set('anthropic-version', '2023-06-01');
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body,
  });

  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/**
 * Handle OpenAI format request and forward to Claude API
 */
async function handleOpenAIToClaude(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse request body
    const openAIRequest = await request.json();
    const isStream = openAIRequest.stream === true;

    // Convert OpenAI request to Claude format
    const claudeRequest = formatRequestClaude(openAIRequest);

    // Prepare headers for Claude API
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('anthropic-version', '2023-06-01');

    // Add API key from request header or environment
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization');
    if (apiKey) {
      // If it starts with 'Bearer ', remove it (Claude uses x-api-key directly)
      const cleanKey = apiKey.startsWith('Bearer ') ? apiKey.slice(7) : apiKey;
      headers.set('x-api-key', cleanKey);
    } else if (env.ANTHROPIC_API_KEY) {
      headers.set('x-api-key', env.ANTHROPIC_API_KEY);
    }

    // Forward to Claude API
    const claudeResponse = await fetch(`${env.ANTHROPIC_BASE_URL}/messages`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(claudeRequest),
    });

    // Check if response is an error
    if (!claudeResponse.ok) {
      // Return error response directly without format conversion
      const errorData = await claudeResponse.json();
      return new Response(JSON.stringify(errorData), {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Handle response based on stream mode
    if (isStream && claudeResponse.body) {
      // Transform Claude SSE to OpenAI format
      const transformedStream = claudeResponse.body.pipeThrough(createClaudeToOpenAITransform());

      return new Response(transformedStream, {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // Convert non-streaming response
      const claudeData = await claudeResponse.json();
      const openAIResponse = formatResponseClaude(claudeData);

      return new Response(JSON.stringify(openAIResponse), {
        status: claudeResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  } catch (error) {
    console.error('Error in OpenAI to Claude conversion:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

/**
 * Handle Claude format request and forward to OpenAI API
 */
async function handleClaudeToOpenAI(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse request body
    const claudeRequest = await request.json();
    const isStream = claudeRequest.stream === true;

    // Convert Claude request to OpenAI format
    const openAIRequest = convertClaudeToOpenAI(claudeRequest);

    // Prepare headers for OpenAI API
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');

    // Add API key from request header or environment
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization');
    if (apiKey) {
      headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);
    } else if (env.OPENAI_API_KEY) {
      headers.set('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
    }

    // Forward to OpenAI API
    const openAIResponse = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(openAIRequest),
    });

    // Check if response is an error
    if (!openAIResponse.ok) {
      // Return error response directly without format conversion
      const errorData = await openAIResponse.json();
      return new Response(JSON.stringify(errorData), {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Handle response based on stream mode
    if (isStream && openAIResponse.body) {
      // Transform OpenAI SSE to Claude format
      const transformedStream = openAIResponse.body.pipeThrough(createOpenAIToClaudeTransform());

      return new Response(transformedStream, {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // Convert non-streaming response
      const openAIData = await openAIResponse.json();
      const claudeResponse = formatResponseOpenAI(openAIData);

      return new Response(JSON.stringify(claudeResponse), {
        status: openAIResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  } catch (error) {
    console.error('Error in Claude to OpenAI conversion:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

function handleRootRequest(corsHeaders: Record<string, string>): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenAI Router</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 8px;
          padding: 2rem;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 1rem;
        }
        .endpoints {
          background: #f7f7f7;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        code {
          background: #e2e2e2;
          padding: 0.2rem 0.4rem;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        .endpoint {
          margin: 0.5rem 0;
        }
        .status {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          background: #10b981;
          color: white;
          border-radius: 4px;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status">Active</div>
        <h1>🚀 OpenAI Router</h1>
        <p>A Cloudflare Workers-based router for OpenAI and Anthropic APIs with bidirectional format conversion.</p>
        
        <div class="endpoints">
          <h2>Format Conversion Endpoints:</h2>
          <div class="endpoint">
            <strong>OpenAI → Claude:</strong> <code>POST /v1/chat/completions</code>
            <br><small>Use OpenAI format to call Claude API</small>
          </div>
          <div class="endpoint">
            <strong>Claude → OpenAI:</strong> <code>POST /v1/messages</code>
            <br><small>Use Claude format to call OpenAI API</small>
          </div>
        </div>
        
        <div class="endpoints">
          <h2>Direct Proxy Endpoints (No Conversion):</h2>
          <div class="endpoint">
            <strong>OpenAI Direct:</strong> <code>/openai/*</code>
            <br><small>Direct proxy to OpenAI API</small>
          </div>
          <div class="endpoint">
            <strong>Anthropic Direct:</strong> <code>/anthropic/*</code>
            <br><small>Direct proxy to Anthropic API</small>
          </div>
        </div>
        
        <div class="endpoints">
          <h2>Features:</h2>
          <div class="endpoint">✅ Bidirectional format conversion</div>
          <div class="endpoint">✅ Streaming support</div>
          <div class="endpoint">✅ Tool/Function calling support</div>
          <div class="endpoint">✅ Complete API compatibility</div>
        </div>
      </div>
    </body>
    </html>
  `;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html',
    },
  });
}
