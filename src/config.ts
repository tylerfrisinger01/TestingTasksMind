import dotenv from 'dotenv';
import { AgentConfig } from './types';

dotenv.config();

export const config: AgentConfig = {
  jiraHost: process.env.JIRA_HOST || '',
  jiraEmail: process.env.JIRA_EMAIL || '',
  jiraApiToken: process.env.JIRA_API_TOKEN || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubOwner: process.env.GITHUB_OWNER || '',
  githubRepo: process.env.GITHUB_REPO || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
};

export function validateConfig(): void {
  const required = [
    'JIRA_HOST',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_OWNER',
    'GITHUB_REPO',
    'OPENAI_API_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}