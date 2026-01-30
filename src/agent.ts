import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

interface Ticket {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  status: string;
}

interface Subtask {
  title: string;
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface CodeChange {
  filePath: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

interface TestResult {
  passed: boolean;
  output: string;
  errors?: string[];
}

interface AgentConfig {
  anthropicApiKey: string;
  githubToken: string;
  jiraConfig: {
    host: string;
    email: string;
    apiToken: string;
  };
  repository: {
    owner: string;
    repo: string;
  };
}

export class AISoftwareEngineerAgent {
  private anthropic: Anthropic;
  private octokit: Octokit;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    this.octokit = new Octokit({
      auth: config.githubToken,
    });
  }

  /**
   * Main entry point - processes a ticket from webhook
   */
  async processTicket(ticket: Ticket): Promise<string> {
    try {
      console.log(`Processing ticket: ${ticket.id} - ${ticket.title}`);

      // Step 1: Analyze the ticket with AI
      const analysis = await this.analyzeTicket(ticket);
      console.log('Ticket analysis complete');

      // Step 2: Break down into subtasks
      const subtasks = await this.breakdownIntoSubtasks(analysis);
      console.log(`Created ${subtasks.length} subtasks`);

      // Step 3: Generate code for each subtask
      const codeChanges: CodeChange[] = [];
      for (const subtask of subtasks) {
        const changes = await this.generateCode(subtask, ticket);
        codeChanges.push(...changes);
      }
      console.log(`Generated ${codeChanges.length} code changes`);

      // Step 4: Run tests
      const testResults = await this.runTests(codeChanges);
      console.log(`Tests ${testResults.passed ? 'passed' : 'failed'}`);

      // Step 5: If tests fail, iterate with AI to fix
      let finalCodeChanges = codeChanges;
      if (!testResults.passed) {
        console.log('Tests failed, attempting to fix...');
        finalCodeChanges = await this.fixFailedTests(
          codeChanges,
          testResults,
          ticket
        );
        
        // Re-run tests
        const retestResults = await this.runTests(finalCodeChanges);
        if (!retestResults.passed) {
          throw new Error('Unable to fix test failures after retry');
        }
      }

      // Step 6: Create pull request
      const prUrl = await this.createPullRequest(ticket, finalCodeChanges);
      console.log(`Pull request created: ${prUrl}`);

      // Step 7: Update Jira ticket
      await this.updateJiraTicket(ticket.id, prUrl);

      return prUrl;
    } catch (error) {
      console.error('Error processing ticket:', error);
      throw error;
    }
  }

  /**
   * Analyzes ticket using Claude AI
   */
  private async analyzeTicket(ticket: Ticket): Promise<string> {
    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Analyze this software development ticket and provide a detailed technical analysis:

Ticket ID: ${ticket.id}
Title: ${ticket.title}
Description: ${ticket.description}

Please provide:
1. Technical requirements
2. Affected components/files
3. Potential challenges
4. Implementation approach
5. Testing strategy`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === 'text') {
      return content.text;
    }
    throw new Error('Unexpected response format from Claude');
  }

  /**
   * Breaks down the ticket into manageable subtasks
   */
  private async breakdownIntoSubtasks(analysis: string): Promise<Subtask[]> {
    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Based on this technical analysis, break down the work into specific subtasks:

${analysis}

Return a JSON array of subtasks with this format:
[
  {
    "title": "Subtask title",
    "description": "Detailed description",
    "estimatedComplexity": "low|medium|high"
  }
]

Return ONLY the JSON array, no other text.`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === 'text') {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
    throw new Error('Failed to parse subtasks from AI response');
  }

  /**
   * Generates code changes for a subtask
   */
  private async generateCode(
    subtask: Subtask,
    ticket: Ticket
  ): Promise<CodeChange[]> {
    // Get repository context
    const repoContext = await this.getRepositoryContext();

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are an expert software engineer. Generate code changes to implement this subtask.

Ticket: ${ticket.title}
Subtask: ${subtask.title}
Description: ${subtask.description}

Repository Context:
${repoContext}

IMPORTANT: Return files using this EXACT format (no JSON):

### FILE: path/to/file1.js
\`\`\`
// Complete file content here
console.log("example");
\`\`\`

### FILE: path/to/file2.html
\`\`\`
<!-- Complete file content here -->
<html>...</html>
\`\`\`

Use exactly "### FILE: " followed by the path, then the code in triple backticks.`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === 'text') {
      return this.parseCodeChanges(content.text);
    }
    throw new Error('Failed to generate code');
  }

  /**
   * Parses code changes from AI response
   */
  private parseCodeChanges(response: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE: (.+?)\n