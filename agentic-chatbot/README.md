# AI Chatbot with MongoDB MCP Integration

An intelligent chatbot system that integrates MongoDB database operations through the Model Context Protocol (MCP) using ai-sdk tool-calling functionality. Users can interact with MongoDB databases using natural language queries.

## 🚀 Features

- **Natural Language Database Queries**: Ask questions about your data in plain English
- **AI-Powered Tool Calling**: Automatically determines when to use MongoDB tools
- **Real-time MCP Status**: Visual indicators showing MongoDB connection status
- **Conversation Context**: Maintains chat history for contextual database operations
- **Modern UI**: Clean, responsive chat interface with syntax highlighting
- **Error Handling**: Graceful fallbacks when database operations fail

## 🛠️ Technology Stack

- **Frontend**: Next.js 15, React 19, TailwindCSS
- **AI**: Google Gemini via ai-sdk
- **Database Integration**: MongoDB MCP Server
- **Protocol**: Model Context Protocol (MCP)
- **Styling**: Custom CSS with dark theme

## 📋 Prerequisites

- Node.js 18+ 
- Docker (for MongoDB MCP server)
- Google AI API key
- MongoDB instance (local or remote)

## ⚙️ Setup

1. **Clone and install dependencies**:
```bash
git clone <your-repo>
cd agentic-chatbot
npm install
```

2. **Configure environment variables**:
```bash
# Create .env.local file
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_api_key
GOOGLE_GEMINI_MODEL=gemini-2.5-pro  # Optional
```

3. **Configure MongoDB MCP Server**:
The `mcp-config.json` is already configured for local MongoDB:
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

4. **Start MongoDB** (if running locally):
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

5. **Start the development server**:
```bash
npm run dev
```

6. **Open [http://localhost:3000](http://localhost:3000)**

## 🧪 Testing the Integration

Run the test script to verify everything is working:
```bash
node tmp_rovodev_test_mongodb_integration.js
```

## 💬 Example Queries

Try these natural language queries in the chat:

### Database Exploration
- "What collections are available in the database?"
- "Show me the structure of the users collection"
- "How many documents are in each collection?"

### Data Querying
- "Find all users in the database"
- "Show me products with price greater than $100"
- "Get the latest 10 orders"

### Data Manipulation
- "Insert a new user with name John Doe and email john@example.com"
- "Update all users with status 'inactive' to 'active'"
- "Delete test documents from the products collection"

### Analytics
- "Count how many orders were placed last month"
- "Find the average price of all products"
- "Show me users who haven't logged in recently"

## 🏗️ Architecture

```
User Input → React Frontend → Next.js API → AI Model + MCP Tools → MongoDB → Response
```

### Key Components

1. **Frontend (`src/app/page.js`)**: React chat interface with real-time MCP status
2. **API Route (`src/app/api/chatbot/route.js`)**: Handles AI requests with tool calling
3. **MCP Status (`src/app/api/mcp-status/route.js`)**: Monitors MongoDB connection
4. **Configuration (`mcp-config.json`)**: MCP server settings

## 🔧 How It Works

1. **User sends a message** through the chat interface
2. **System analyzes the query** using predefined AI instructions
3. **AI determines if database tools are needed** based on the query context
4. **MongoDB tools are called automatically** if database operations are required
5. **Results are processed and formatted** into natural language responses
6. **User receives a comprehensive answer** with context about operations performed

## 📊 MCP Status Indicators

- 🟢 **Connected**: MongoDB MCP server is running and tools are available
- 🟡 **Checking**: System is verifying the connection
- 🔴 **Disconnected**: MCP server is not available (fallback to basic chat)

## 🛡️ Error Handling

The system gracefully handles:
- MCP server connection failures
- Invalid database operations
- Network timeouts
- Malformed queries

## 📚 Documentation

- [MongoDB MCP Integration Guide](./MONGODB_MCP_INTEGRATION.md) - Detailed integration documentation
- [ai-sdk Documentation](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) - Tool calling reference

## 🚀 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Connect to Vercel
3. Add environment variables
4. Deploy

### Docker
```bash
docker build -t agentic-chatbot .
docker run -p 3000:3000 agentic-chatbot
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Troubleshooting

### Common Issues

1. **MCP Server Not Connecting**:
   - Ensure Docker is running
   - Check MongoDB connection string
   - Verify MCP server image is available

2. **AI Not Responding**:
   - Verify GOOGLE_GENERATIVE_AI_API_KEY is set
   - Check API key permissions
   - Monitor console for errors

3. **Tools Not Working**:
   - Check MCP status indicator
   - Verify MongoDB is accessible
   - Review mcp-config.json settings

### Debug Mode
Enable detailed logging by setting:
```bash
DEBUG=true npm run dev
```