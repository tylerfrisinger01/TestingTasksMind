import { startWebhookServer } from './webhook';
import { AIAgent } from './agent';

// Get configuration from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

// Start the webhook server
console.log('Starting AI Software Engineer Agent...');
startWebhookServer(OPENAI_API_KEY, PORT);

// Export for programmatic use
export { AIAgent, startWebhookServer };