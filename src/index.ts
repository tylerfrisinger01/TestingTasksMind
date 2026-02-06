import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { webhookHandler } from './webhook';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook endpoint for Jira
app.post('/webhook/jira', webhookHandler);

app.listen(PORT, () => {
  console.log(`🤖 AI Software Engineer Agent running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/jira`);
});