import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface JiraTicket {
  key: string;
  fields: {
    summary: string;
    description: string;
    assignee?: {
      emailAddress: string;
    };
    status: {
      name: string;
    };
  };
}

interface Subtask {
  id: string;
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface FileChange {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

interface AnalysisResult {
  summary: string;
  subtasks: Subtask[];
  technicalApproach: string;
  estimatedEffort: string;
  risks: string[];
}

class AIAgentOrchestrator {
  private anthropic: Anthropic;
  private octokit: Octokit;
  private jiraBaseUrl: string;
  private jiraEmail: string;
  private jiraApiToken: string;
  private githubRepo: { owner: string; repo: string };
  private workingDirectory: string;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    this.jiraBaseUrl = process.env.JIRA_BASE_URL || '';
    this.jiraEmail = process.env.JIRA_EMAIL || '';
    this.jiraApiToken = process.env.JIRA_API_TOKEN || '';

    const repoString = process.env.GITHUB_REPOSITORY || 'owner/repo';
    const [owner, repo] = repoString.split('/');
    this.githubRepo = { owner, repo };

    this.workingDirectory = process.env.WORKING_DIR || process.cwd();
  }

  /**
   * Main entry point for webhook handling
   */
  async handleWebhook(payload: any): Promise<void> {
    console.log('Received webhook payload:', JSON.stringify(payload, null, 2));

    // Check if this is a ticket assignment event
    if (!this.isTicketAssignmentEvent(payload)) {
      console.log('Not a ticket assignment event, ignoring');
      return;
    }

    const ticketKey = payload.issue?.key;
    if (!ticketKey) {
      console.error('No ticket key found in payload');
      return;
    }

    console.log(`Processing ticket assignment: ${ticketKey}`);

    try {
      // Fetch full ticket details
      const ticket = await this.fetchJiraTicket(ticketKey);

      // Analyze ticket with AI
      const analysis = await this.analyzeTicket(ticket);

      // Update Jira with analysis
      await this.updateJiraWithAnalysis(ticketKey, analysis);

      // Generate code changes
      const fileChanges = await this.generateCode(ticket, analysis);

      // Apply changes to working directory
      await this.applyChanges(fileChanges);

      // Run tests
      const testsPass = await this.runTests();

      if (!testsPass) {
        console.warn('Tests failed, creating PR with failing tests');
      }

      // Create pull request
      const prUrl = await this.createPullRequest(ticket, analysis, testsPass);

      // Update Jira with PR link
      await this.updateJiraWithPR(ticketKey, prUrl);

      console.log(`Successfully processed ticket ${ticketKey}`);
      console.log(`Pull request created: ${prUrl}`);
    } catch (error) {
      console.error(`Error processing ticket ${ticketKey}:`, error);
      await this.updateJiraWithError(ticketKey, error);
      throw error;
    }
  }

  /**
   * Check if webhook payload is a ticket assignment event
   */
  private isTicketAssignmentEvent(payload: any): boolean {
    return (
      payload.webhookEvent === 'jira:issue_updated' &&
      payload.changelog?.items?.some(
        (item: any) => item.field === 'assignee' && item.toString
      )
    );
  }

  /**
   * Fetch ticket details from Jira
   */
  private async fetchJiraTicket(ticketKey: string): Promise<JiraTicket> {
    const auth = Buffer.from(`${this.jiraEmail}:${this.jiraApiToken}`).toString('base64');

    const response = await axios.get(
      `${this.jiraBaseUrl}/rest/api/3/issue/${ticketKey}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Analyze ticket using Claude AI
   */
  private async analyzeTicket(ticket: JiraTicket): Promise<AnalysisResult> {
    const prompt = `You are an expert software engineer analyzing a ticket. Provide a detailed analysis.

Ticket: ${ticket.key}
Summary: ${ticket.fields.summary}
Description: ${ticket.fields.description || 'No description provided'}

Please analyze this ticket and provide:
1. A brief summary of what needs to be done
2. Break it down into 3-5 subtasks with complexity estimates
3. Technical approach and architecture considerations
4. Estimated effort (in story points or hours)
5. Potential risks or challenges

Format your response as JSON with this structure:
{
  "summary": "Brief summary",
  "subtasks": [
    {"id": "1", "description": "Task description", "estimatedComplexity": "low|medium|high"}
  ],
  "technicalApproach": "Detailed technical approach",
  "estimatedEffort": "Effort estimate",
  "risks": ["Risk 1", "Risk 2"]
}`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response as JSON');
    }

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Generate code changes using Claude AI
   */
  private async generateCode(
    ticket: JiraTicket,
    analysis: AnalysisResult
  ): Promise<FileChange[]> {
    // Get current codebase context
    const codebaseContext = await this.getCodebaseContext();

    const prompt = `You are an expert software engineer. Generate code changes to implement the ticket.

Ticket: ${ticket.key}
Summary: ${ticket.fields.summary}
Description: ${ticket.fields.description || 'No description provided'}

Analysis:
${JSON.stringify(analysis, null, 2)}

Current Codebase Context:
${codebaseContext}

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

Use exactly "### FILE: " followed by the path, then the code in triple backticks.

Generate complete, production-ready code that:
1. Implements all subtasks
2. Follows best practices
3. Includes error handling
4. Is well-documented
5. Includes tests if appropriate`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    return this.parseFileChanges(responseText);
  }

  /**
   * Get relevant codebase context
   */
  private async getCodebaseContext(): Promise<string> {
    const contextFiles: string[] = [];
    const maxFiles = 10;
    const maxFileSize = 5000; // characters

    try {
      // Get package.json for dependencies
      const packageJsonPath = path.join(this.workingDirectory, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = fs.readFileSync(packageJsonPath, 'utf-8');
        contextFiles.push(`### FILE: package.json\n${packageJson.slice(0, maxFileSize)}`);
      }

      // Get README for project overview
      const readmePath = path.join(this.workingDirectory, 'README.md');
      if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        contextFiles.push(`### FILE: README.md\n${readme.slice(0, maxFileSize)}`);
      }

      // Get main source files
      const srcDir = path.join(this.workingDirectory, 'src');
      if (fs.existsSync(srcDir)) {
        const files = this.getSourceFiles(srcDir, maxFiles - contextFiles.length);
        files.forEach((file) => {
          const content = fs.readFileSync(file, 'utf-8');
          const relativePath = path.relative(this.workingDirectory, file);
          contextFiles.push(`### FILE: ${relativePath}\n${content.slice(0, maxFileSize)}`);
        });
      }
    } catch (error) {
      console.error('Error getting codebase context:', error);
    }

    return contextFiles.join('\n\n');
  }

  /**
   * Get source files recursively
   */
  private getSourceFiles(dir: string, maxFiles: number): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go'];

    const walk = (currentDir: string) => {
      if (files.length >= maxFiles) return;

      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(fullPath);
        } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    walk(dir);
    return files;
  }

  /**
   * Parse file changes from AI response
   */
  private parseFileChanges(response: string): FileChange[] {
    const fileChanges: FileChange[] = [];
    const fileRegex = /### FILE: (.+?)\n