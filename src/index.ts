import { AIAgent } from './agent';
import { WebhookHandler } from './webhook';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const agent = new AIAgent(OPENAI_API_KEY);
const webhookHandler = new WebhookHandler(agent, PORT);

webhookHandler.start();

console.log('AI Software Engineer Agent started successfully');

export { AIAgent, WebhookHandler };