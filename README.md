[English](./README.md) | [中文](./README.zh-CN.md)

# openai-router

A Cloudflare Worker that provides bidirectional translation between OpenAI and Anthropic APIs. This allows you to use OpenAI-compatible clients with Claude models, or Claude-compatible clients with OpenAI models.

## Features

openai-router acts as a powerful translation layer that:
- **Bidirectional conversion**: OpenAI format ⟷ Anthropic format
- **Direct proxy support**: Route requests directly without format conversion
- **Streaming responses**: Full support for both streaming and non-streaming modes
- **Tool/Function calling**: Complete support for function calls and tools
- **CORS enabled**: Ready for web applications
- **Multiple endpoints**: Four different endpoint types for different use cases

This tool is particularly useful for:
- Using OpenAI clients with Claude models
- Using Claude clients with OpenAI models  
- Migrating between different AI providers seamlessly
- Testing and comparing responses from different models

## Quick Start

### Manual Setup

**Step 1:** Get your API keys:
- OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys)
- Anthropic API key from [Anthropic Console](https://console.anthropic.com/)

**Step 2:** Choose your usage mode:

#### Mode 1: Use OpenAI format with Claude models
Configure your OpenAI client to use openai-router:

```bash
export OPENAI_BASE_URL="https://your-worker-domain.com"
export OPENAI_API_KEY="your-anthropic-api-key"  # Use Claude API key here
```

#### Mode 2: Use Claude format with OpenAI models  
Configure your Claude client to use openai-router:

```bash
export ANTHROPIC_BASE_URL="https://your-worker-domain.com"
export ANTHROPIC_API_KEY="your-openai-api-key"  # Use OpenAI API key here
```

**Step 2 (alternative):** If you don't want to host your own instance, you can use a public endpoint (replace with your preferred public instance):

```bash
# Example for Mode 1 (OpenAI format → Claude models)
export OPENAI_BASE_URL="https://your-public-instance.com"
export OPENAI_API_KEY="your-anthropic-api-key"
```

## API Endpoints

### Format Conversion Endpoints
- **`POST /v1/chat/completions`** - Accepts OpenAI format, routes to Claude API
- **`POST /v1/messages`** - Accepts Claude format, routes to OpenAI API

### Direct Proxy Endpoints (No Conversion)
- **`/openai/*`** - Direct proxy to OpenAI API
- **`/anthropic/*`** - Direct proxy to Anthropic API

## Self-Hosting

For better reliability and control, you can deploy your own instance of openai-router.

1. **Clone and deploy:**
   ```bash
   git clone https://github.com/jizhejiang/openai-router
   cd openai-router
   npm install -g wrangler
   wrangler deploy
   ```

2. **Set environment variables:**
   
   ```bash
   # Required: API base URLs
   wrangler secret put OPENAI_BASE_URL      # Default: https://api.openai.com/v1
   wrangler secret put ANTHROPIC_BASE_URL   # Default: https://api.anthropic.com/v1
   
   # Optional: Default API keys (can also be provided in request headers)
   wrangler secret put OPENAI_API_KEY
   wrangler secret put ANTHROPIC_API_KEY
   ```
   
3. **Configure your clients:**
   - Set the API endpoint to your deployed Worker URL
   - Use the appropriate API key for your target service

## Development

```bash
npm install          # Install dependencies
npm run dev         # Start the development server
npm run test        # Run tests
npm run deploy      # Deploy to Cloudflare Workers
```

## Usage Examples

### Using with OpenAI SDK (to call Claude)
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-worker-domain.com/v1',
  apiKey: 'your-anthropic-api-key', // Claude API key
});

const response = await client.chat.completions.create({
  model: 'claude-3-sonnet-20240229',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Using with Anthropic SDK (to call OpenAI)
```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'https://your-worker-domain.com',
  apiKey: 'your-openai-api-key', // OpenAI API key
});

const response = await client.messages.create({
  model: 'gpt-4',
  max_tokens: 1000,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Disclaimer

**Important Legal Notice:**

- **Third-Party Tool**: openai-router is an independent, unofficial tool and is not affiliated with, endorsed by, or supported by OpenAI, Anthropic, or any other API provider.
- **Terms of Service**: Users are responsible for ensuring their usage complies with the terms of service of all relevant parties, including OpenAI, Anthropic, and any other API providers.
- **API Key Responsibility**: Users must use their own valid API keys and are solely responsible for any usage, costs, or violations associated with those keys.
- **No Warranty**: This software is provided "as is" without any warranty of any kind. The author is not responsible for any damages, service interruptions, or legal issues that may arise from its use.
- **Data Privacy**: While openai-router does not intentionally store user data, users should review the privacy policies of all connected services.
- **Compliance**: Users are responsible for ensuring their usage complies with all applicable laws and regulations in their jurisdiction.

**Use at your own risk.**
