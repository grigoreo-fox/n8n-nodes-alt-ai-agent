# @grigoreo-fox/n8n-nodes-alt-ai-agent

This is an n8n community node that provides an alternative AI Agent with enhanced memory capabilities. It functions almost identically to the stock n8n AI Agent but adds **tool call memory persistence** - automatically saving tool interactions to the conversation memory for better context retention across agent iterations.

The core differentiating feature is implemented in [`toolAwareMemory.ts`](./nodes/AltAiAgent/toolAwareMemory.ts), which intelligently intercepts and folds tool call summaries into the agent's memory, providing richer context for multi-step reasoning tasks.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Table of Contents

- [Installation](#installation)
- [Key Features](#key-features)
- [Operations](#operations)
- [Configuration](#configuration)  
- [Tool Memory Feature](#tool-memory-feature)
- [Limitations](#limitations)
- [Compatibility](#compatibility)
- [Usage Examples](#usage-examples)
- [Resources](#resources)
- [Version History](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

Install via npm:
```bash
npm install @grigoreo-fox/n8n-nodes-alt-ai-agent
```

Or install directly in n8n using Community Nodes:
1. Go to **Settings** > **Community Nodes**
2. Enter: `@grigoreo-fox/n8n-nodes-alt-ai-agent`
3. Click **Install**

## Key Features

### 🧠 **Enhanced Memory with Tool Call Persistence**
Unlike the standard AI Agent, this node automatically saves tool call details to memory, including:
- Tool names and arguments used
- Tool execution results and observations  
- Formatted summaries for better context retention

### 🔧 **Full Tool Integration**
- Connect multiple tools via n8n's AI Tool connection type
- Automatic tool discovery and binding
- Support for custom tool implementations

### 💬 **Flexible Conversation Management**
- System message customization
- Memory integration for conversation history
- Configurable iteration limits

## Operations

The Alt AI Agent supports the following operations:

- **Chat & Execute**: Process user messages and execute multi-step plans using connected tools
- **Tool Orchestration**: Coordinate multiple tool calls within a single agent session
- **Memory Integration**: Persist conversation context including tool interactions

## Configuration

### Required Connections
- **Chat Model**: Connect an AI Language Model (OpenAI, Anthropic, etc.)

### Optional Connections  
- **Memory**: Connect a Memory node to persist conversation history
- **Tools**: Connect one or more Tool nodes for agent capabilities

### Node Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| System Message | string | (default prompt) | Initial instructions sent to the agent |
| Prompt (User Message) | string | `={{ $json.input }}` | The user message/task for the agent |
| Max Iterations | number | 10 | Maximum agent reasoning iterations |
| **Save Tool Calls to Memory** | boolean | **true** | 🔑 **Key Feature**: Persist tool calls in memory |
| Return Intermediate Steps | boolean | true | Include agent reasoning steps in output |

## Tool Memory Feature

The core innovation of this node is the **toolAwareMemory** system (implemented in [`toolAwareMemory.ts`](./nodes/AltAiAgent/toolAwareMemory.ts)):

### How It Works
1. **Intercepts Memory Saves**: Wraps the standard LangChain memory with a proxy
2. **Captures Tool Calls**: Extracts tool names, arguments, and results from agent steps  
3. **Formats Summaries**: Creates human-readable tool execution summaries
4. **Persists Context**: Automatically saves tool call history alongside conversation

### Example Tool Memory Output
```
tool call: web_search({"query": "n8n community nodes"}) => {"results": "Found 10 results about n8n community nodes..."}

tool call: send_email({"to": "user@example.com", "subject": "Report"}) => {"status": "sent", "message_id": "abc123"}

User: Thanks for sending that email! Can you search for more information about workflow automation?
```

### Benefits
- **Enhanced Context**: Agent remembers what tools were used and their results
- **Better Decision Making**: Avoid redundant tool calls by referencing previous executions  
- **Debugging**: Clear visibility into tool interaction history
- **Continuity**: Maintain tool context across conversation turns

## Limitations

⚠️ **Important Limitations**:

- **No Structured Output**: This node does not support structured output formatting
- **No Streaming**: Real-time streaming responses are not available  
- **Memory Dependency**: Tool call persistence requires a connected Memory node

These limitations are trade-offs for the enhanced memory functionality.

## Compatibility

- **Minimum n8n version**: 1.0.0
- **Tested with**: n8n 1.x.x series
- **LangChain**: Compatible with LangChain 0.3.x
- **Node.js**: Requires Node.js 18+

## Usage Examples

### Basic Agent with Tool Memory
```yaml
1. Connect OpenAI Chat Model
2. Connect Buffer Memory  
3. Connect HTTP Request Tool
4. Enable "Save Tool Calls to Memory" (default: true)
5. Set prompt: "Help me analyze the website example.com"
```

The agent will automatically save HTTP request details to memory for future reference.

### Multi-Step Task with Memory
```yaml
Prompt: "Search for the latest n8n updates and email me a summary"

Agent Flow:
1. Uses web search tool → Saves search results to memory
2. Analyzes findings → References previous search in context  
3. Uses email tool → Saves email status to memory
4. Provides confirmation → Full tool history available
```

## Resources

- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/#community-nodes)
- [LangChain Agents Documentation](https://js.langchain.com/docs/modules/agents/)
- [n8n AI Agent Documentation](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
- [Source Code](https://github.com/grigoreo-fox/n8n-nodes-alt-ai-agent)

## Version History

### v0.1.0
- Initial release
- Implemented toolAwareMemory system for persistent tool call context
- Full compatibility with n8n AI Tool ecosystem  
- Enhanced memory integration with tool call summaries

---

## Contributing

This is an open source project. Contributions, issues, and feature requests are welcome!

## License

MIT License - see LICENSE file for details.

---

*Built with ❤️ for the n8n community*