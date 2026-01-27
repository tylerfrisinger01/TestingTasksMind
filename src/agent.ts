import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

interface TicketData {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  project: string;
}

interface CodeChange {
  filePath: string;
  content: string;
}

interface AnalysisResult {
  summary: string;
  subtasks: string[];
  technicalApproach: string;
  estimatedComplexity: string;
}

export class AISoftwareEngineerAgent {
  private anthropic: Anthropic;
  private octokit: Octokit;
  private jiraBaseUrl: string;
  private jiraAuth: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    this.jiraBaseUrl = process.env.JIRA_BASE_URL || '';
    this.jiraAuth = Buffer.from(
      `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
    ).toString('base64');

    this.anthropic = new Anthropic({ apiKey });
    this.octokit = new Octokit({ auth: githubToken });
  }

  async handleWebhook(payload: any): Promise<void> {
    console.log('Received webhook payload:', JSON.stringify(payload, null, 2));

    if (payload.webhookEvent === 'jira:issue_updated') {
      const issue = payload.issue;
      
      if (issue.fields.assignee) {
        const ticketData: TicketData = {
          id: issue.key,
          title: issue.fields.summary,
          description: issue.fields.description || '',
          assignee: issue.fields.assignee.emailAddress,
          project: issue.fields.project.key
        };

        await this.processTicket(ticketData);
      }
    }
  }

  async processTicket(ticket: TicketData): Promise<void> {
    console.log(`Processing ticket: ${ticket.id} - ${ticket.title}`);

    try {
      const analysis = await this.analyzeTicket(ticket);
      console.log('Analysis complete:', analysis);

      await this.updateJiraWithAnalysis(ticket.id, analysis);

      const codeChanges = await this.generateCode(ticket, analysis);
      console.log(`Generated ${codeChanges.length} code changes`);

      const testResults = await this.runTests(codeChanges);
      console.log('Test results:', testResults);

      if (testResults.success) {
        await this.createPullRequest(ticket, codeChanges, analysis);
        await this.updateJiraStatus(ticket.id, 'In Review');
      } else {
        await this.updateJiraWithError(ticket.id, testResults.errors);
      }
    } catch (error) {
      console.error('Error processing ticket:', error);
      await this.updateJiraWithError(
        ticket.id,
        `Processing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async analyzeTicket(ticket: TicketData): Promise<AnalysisResult> {
    const prompt = `Analyze this software development ticket and provide a structured breakdown:

Ticket: ${ticket.title}
Description: ${ticket.description}

Please provide:
1. A brief summary of what needs to be done
2. A list of subtasks (3-5 items)
3. Technical approach and architecture considerations
4. Estimated complexity (Low/Medium/High)

Format your response as JSON with keys: summary, subtasks (array), technicalApproach, estimatedComplexity`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('Failed to parse JSON response, using fallback');
    }

    return {
      summary: ticket.title,
      subtasks: ['Implement feature', 'Add tests', 'Update documentation'],
      technicalApproach: 'Standard implementation approach',
      estimatedComplexity: 'Medium'
    };
  }

  private async generateCode(
    ticket: TicketData,
    analysis: AnalysisResult
  ): Promise<CodeChange[]> {
    const prompt = `You are an expert software engineer. Generate code changes to implement this ticket:

Ticket: ${ticket.title}
Description: ${ticket.description}

Analysis:
${analysis.summary}

Subtasks:
${analysis.subtasks.map((task, i) => `${i + 1}. ${task}`).join('\n')}

Technical Approach:
${analysis.technicalApproach}

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

Use exactly "### FILE: " followed by the path, then the code in triple backticks.`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    return this.parseCodeChanges(responseText);
  }

  private parseCodeChanges(response: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE:\s*(.+?)\n