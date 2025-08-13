# MongoDB MCP Server Integration Guide

This project integrates a MongoDB MCP (Model Context Protocol) server with the ai-sdk tool-calling functionality to create an intelligent chat system that can interact with MongoDB databases.

## How It Works

1. **User Input**: Users send messages through the chat interface
2. **System Instructions**: Predefined system instructions guide the AI on how to use MongoDB tools
3. **Tool Calling**: The AI automatically determines when to use MongoDB tools based on user queries
4. **Data Processing**: Results from MongoDB operations are processed and presented in natural language
5. **Response**: The AI provides a comprehensive response including any database operations performed

## System Architecture

```
User Input → Frontend (React) → API Route → AI Model + MCP Tools → MongoDB → Processed Response → User
```

## Key Features

### 1. Automatic Tool Detection
The system automatically detects available MongoDB tools from your MCP server and makes them available to the AI.

### 2. Conversation Context
The chat maintains conversation history, allowing for contextual database operations across multiple messages.

### 3. Intelligent Tool Usage
The AI decides when to use database tools based on:
- User queries that mention data operations
- Requests for information that might be stored in the database
- Follow-up questions about previous database results

### 4. Natural Language Processing
Database results are automatically converted to human-readable responses with explanations of what operations were performed.

## Example Use Cases

### 1. Data Querying
**User**: "Show me all users in the database"
**AI Response**: Uses MongoDB find tool → Processes results → "I found 15 users in the database. Here are the details: [formatted user list]"

### 2. Data Insertion
**User**: "Add a new user named John Doe with email john@example.com"
**AI Response**: Uses MongoDB insert tool → "I've successfully added John Doe to the database with email john@example.com"

### 3. Data Analysis
**User**: "How many orders were placed last month?"
**AI Response**: Uses MongoDB aggregation tools → "Based on the database query, there were 247 orders placed last month"

### 4. Complex Operations
**User**: "Find all customers who made purchases over $100 and update their status to 'premium'"
**AI Response**: Uses multiple MongoDB tools → "I found 23 customers with purchases over $100 and updated their status to 'premium'"

## Configuration

### MongoDB MCP Server Setup
Your `mcp-config.json` is already configured:
```json
{
    "mongodb": {
        "command": "docker",
        "args": ["run", "-i", "--rm", "--network=host", "-e", "MDB_MCP_CONNECTION_STRING", "mcp/mongodb"],
        "env": {
            "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/"
        }
    }
}
```

### Environment Variables
Make sure you have:
- `GOOGLE_GENERATIVE_AI_API_KEY`: Your Google AI API key
- `GOOGLE_GEMINI_MODEL`: (Optional) Specific Gemini model to use

## System Instructions

The AI is configured with these instructions:
- Use MongoDB tools when database operations are needed
- Process results and present them in natural language
- Explain what operations were performed
- Be helpful and provide context for database operations

## Tool Caching

The system implements intelligent caching:
- MCP client connections are cached for 5 minutes
- Reduces connection overhead
- Improves response times
- Automatically handles connection failures

## Error Handling

The system gracefully handles:
- MCP server connection failures
- Invalid database operations
- Tool execution errors
- Network timeouts

## Monitoring

The UI shows:
- MCP connection status (Connected/Disconnected)
- Available tools count
- Real-time connection health

## Testing the Integration

Try these example queries:
1. "What collections are available in the database?"
2. "Show me the structure of the users collection"
3. "Find all documents in the products collection"
4. "Insert a test document into the users collection"
5. "Count how many documents are in each collection"

## Extending the System

To add more functionality:
1. Configure additional MCP servers in `mcp-config.json`
2. The system will automatically detect and use new tools
3. Update system instructions if needed for specific tool usage patterns

## Best Practices

1. **Clear Queries**: Be specific about what data operations you want
2. **Context**: Use follow-up questions to build on previous operations
3. **Safety**: The AI will ask for confirmation on destructive operations
4. **Performance**: Large data operations are automatically optimized

This integration provides a powerful way to interact with MongoDB databases through natural language, making database operations accessible to users without requiring SQL or MongoDB query knowledge.