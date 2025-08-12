[English](./README.md) | [中文](./README.zh-CN.md)

# openai-router

一个Cloudflare Worker，提供OpenAI和Anthropic API之间的双向转换。这使您能够将OpenAI兼容的客户端与Claude模型一起使用，或将Claude兼容的客户端与OpenAI模型一起使用。

## 功能

openai-router作为一个强大的转换层，可以：
- **双向转换**：OpenAI格式 ⟷ Anthropic格式
- **直接代理支持**：直接路由请求而不进行格式转换
- **流式响应**：完全支持流式和非流式模式
- **工具/函数调用**：完整支持函数调用和工具
- **CORS支持**：为Web应用程序做好准备
- **多种端点**：四种不同的端点类型适用于不同用例

这个工具特别适用于：
- 使用OpenAI客户端调用Claude模型
- 使用Claude客户端调用OpenAI模型
- 在不同AI提供商之间无缝迁移
- 测试和比较不同模型的响应

## 快速开始

### 手动设置

**第一步：** 获取您的API密钥：
- OpenAI API密钥来自 [OpenAI Platform](https://platform.openai.com/api-keys)
- Anthropic API密钥来自 [Anthropic Console](https://console.anthropic.com/)

**第二步：** 选择您的使用模式：

#### 模式1：使用OpenAI格式调用Claude模型
配置您的OpenAI客户端使用openai-router：

```bash
export OPENAI_BASE_URL="https://your-worker-domain.com"
export OPENAI_API_KEY="your-anthropic-api-key"  # 这里使用Claude API密钥
```

#### 模式2：使用Claude格式调用OpenAI模型  
配置您的Claude客户端使用openai-router：

```bash
export ANTHROPIC_BASE_URL="https://your-worker-domain.com"
export ANTHROPIC_API_KEY="your-openai-api-key"  # 这里使用OpenAI API密钥
```

**第二步（替代方案）：** 如果您不想托管自己的实例，您可以使用公共端点（替换为您偏好的公共实例）：

```bash
# 模式1示例（OpenAI格式 → Claude模型）
export OPENAI_BASE_URL="https://your-public-instance.com"
export OPENAI_API_KEY="your-anthropic-api-key"
```

## API端点

### 格式转换端点
- **`POST /v1/chat/completions`** - 接受OpenAI格式，路由到Claude API
- **`POST /v1/messages`** - 接受Claude格式，路由到OpenAI API

### 直接代理端点（无转换）
- **`/openai/*`** - 直接代理到OpenAI API
- **`/anthropic/*`** - 直接代理到Anthropic API

## 自行托管

为了获得更好的可靠性和控制权，您可以部署自己的openai-router实例。

1. **克隆并部署：**
   ```bash
   git clone https://github.com/jizhejiang/openai-router
   cd openai-router
   npm install -g wrangler
   wrangler deploy
   ```

2. **设置环境变量：**
   
   ```bash
   # 必需：API基础URL
   wrangler secret put OPENAI_BASE_URL      # 默认：https://api.openai.com/v1
   wrangler secret put ANTHROPIC_BASE_URL   # 默认：https://api.anthropic.com/v1
   
   # 可选：默认API密钥（也可以在请求头中提供）
   wrangler secret put OPENAI_API_KEY
   wrangler secret put ANTHROPIC_API_KEY
   ```
   
3. **配置您的客户端：**
   - 将API端点设置为您部署的Worker URL
   - 为您的目标服务使用相应的API密钥

## 开发

```bash
npm install          # 安装依赖
npm run dev         # 启动开发服务器
npm run test        # 运行测试
npm run deploy      # 部署到Cloudflare Workers
```

## 使用示例

### 使用OpenAI SDK调用Claude
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-worker-domain.com/v1',
  apiKey: 'your-anthropic-api-key', // Claude API密钥
});

const response = await client.chat.completions.create({
  model: 'claude-3-sonnet-20240229',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### 使用Anthropic SDK调用OpenAI
```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'https://your-worker-domain.com',
  apiKey: 'your-openai-api-key', // OpenAI API密钥
});

const response = await client.messages.create({
  model: 'gpt-4',
  max_tokens: 1000,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## 免责声明

**重要法律声明：**

- **第三方工具**：openai-router是一个独立的、非官方的工具，与OpenAI、Anthropic或任何其他API提供商没有任何关联，也未获得它们的认可或支持。
- **服务条款**：用户有责任确保其使用行为遵守所有相关方（包括OpenAI、Anthropic及任何其他API提供商）的服务条款。
- **API密钥责任**：用户必须使用自己有效的API密钥，并对与这些密钥相关的任何使用、费用或违规行为负全部责任。
- **无担保**：本软件按"原样"提供，不附带任何形式的担保。作者不对因使用本软件而导致的任何损害、服务中断或法律问题负责。
- **数据隐私**：虽然openai-router不会有意存储用户数据，但用户应自行审阅所有连接服务的隐私政策。
- **合规性**：用户有责任确保其使用行为符合其所在司法管辖区的适用法律和法规。

**请自行承担使用风险。**
