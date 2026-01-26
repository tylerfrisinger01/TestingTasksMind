import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { config } from './config';

interface JiraWebhookPayload {
  webhookEvent: string;
  issue: {
    key: string;
    fields: {
      summary: string;
      description: string;
      assignee?: {
        displayName: string;
        emailAddress: string;
      };
      status: {
        name: string;
      };
      project: {
        key: string;
      };
    };
  };
}

interface Subtask {
  title: string;
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface CodeFile {
  path: string;
  content: string;
}

interface GeneratedCode {
  files: CodeFile[];
  packages: {
    npm?: string[];
    pip?: string[];
  };
}

class AIAgentOrchestrator {
  private octokit: Octokit;
  private openai: OpenAI;
  private jiraBaseUrl: string;
  private jiraAuth: string;

  constructor() {
    this.octokit = new Octokit({
      auth: config.github.token,
    });

    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });

    this.jiraBaseUrl = config.jira.baseUrl;
    this.jiraAuth = Buffer.from(
      `${config.jira.email}:${config.jira.apiToken}`
    ).toString('base64');
  }

  /**
   * Main webhook handler for Jira events
   */
  async handleJiraWebhook(payload: JiraWebhookPayload): Promise<void> {
    console.log(`Received webhook event: ${payload.webhookEvent}`);

    // Only process when ticket is assigned
    if (
      payload.webhookEvent === 'jira:issue_updated' &&
      payload.issue.fields.assignee
    ) {
      const assigneeName = payload.issue.fields.assignee.displayName;
      
      // Check if assigned to AI agent
      if (this.isAIAgent(assigneeName)) {
        console.log(`AI Agent assigned to ticket: ${payload.issue.key}`);
        await this.processTicket(payload.issue);
      }
    }
  }

  /**
   * Check if assignee is the AI agent
   */
  private isAIAgent(assigneeName: string): boolean {
    return (
      assigneeName.toLowerCase().includes('ai') ||
      assigneeName.toLowerCase().includes('bot') ||
      assigneeName === config.jira.agentName
    );
  }

  /**
   * Main ticket processing pipeline
   */
  async processTicket(issue: JiraWebhookPayload['issue']): Promise<void> {
    try {
      console.log(`Processing ticket: ${issue.key}`);

      // Step 1: Update Jira status to "In Progress"
      await this.updateJiraStatus(issue.key, 'In Progress');

      // Step 2: Analyze ticket with AI
      const analysis = await this.analyzeTicket(issue);
      console.log('Ticket analysis complete');

      // Step 3: Break down into subtasks
      const subtasks = await this.generateSubtasks(issue, analysis);
      console.log(`Generated ${subtasks.length} subtasks`);

      // Step 4: Create subtasks in Jira
      await this.createJiraSubtasks(issue.key, subtasks);

      // Step 5: Generate code
      const generatedCode = await this.generateCode(issue, analysis, subtasks);
      console.log(`Generated ${generatedCode.files.length} files`);

      // Step 6: Create branch and commit code
      const branchName = await this.createBranchAndCommit(
        issue.key,
        generatedCode
      );
      console.log(`Created branch: ${branchName}`);

      // Step 7: Run tests (simulated)
      const testsPass = await this.runTests(branchName);
      console.log(`Tests ${testsPass ? 'passed' : 'failed'}`);

      if (testsPass) {
        // Step 8: Create pull request
        const prUrl = await this.createPullRequest(
          issue.key,
          branchName,
          issue.fields.summary,
          analysis
        );
        console.log(`Pull request created: ${prUrl}`);

        // Step 9: Update Jira with PR link
        await this.addJiraComment(
          issue.key,
          `Pull request created: ${prUrl}\n\nGenerated ${generatedCode.files.length} files with automated code changes.`
        );

        // Step 10: Update status to "In Review"
        await this.updateJiraStatus(issue.key, 'In Review');
      } else {
        await this.addJiraComment(
          issue.key,
          'Automated tests failed. Manual review required.'
        );
        await this.updateJiraStatus(issue.key, 'To Do');
      }
    } catch (error) {
      console.error(`Error processing ticket ${issue.key}:`, error);
      await this.addJiraComment(
        issue.key,
        `Error during automated processing: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      await this.updateJiraStatus(issue.key, 'To Do');
    }
  }

  /**
   * Analyze ticket using GPT-4o
   */
  private async analyzeTicket(
    issue: JiraWebhookPayload['issue']
  ): Promise<string> {
    const prompt = `Analyze this software development ticket and provide a detailed technical analysis:

Title: ${issue.fields.summary}
Description: ${issue.fields.description || 'No description provided'}

Provide:
1. Technical requirements
2. Affected components/files
3. Potential challenges
4. Recommended approach
5. Testing strategy`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert software architect analyzing development tickets.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    return response.choices[0].message.content || '';
  }

  /**
   * Generate subtasks using AI
   */
  private async generateSubtasks(
    issue: JiraWebhookPayload['issue'],
    analysis: string
  ): Promise<Subtask[]> {
    const prompt = `Based on this ticket and analysis, break it down into specific subtasks:

Ticket: ${issue.fields.summary}
Description: ${issue.fields.description || 'No description provided'}

Analysis:
${analysis}

Generate 3-7 concrete subtasks. Return as JSON array with format:
[
  {
    "title": "Subtask title",
    "description": "Detailed description",
    "estimatedComplexity": "low|medium|high"
  }
]`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a project manager breaking down development tasks. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{"subtasks": []}';
    const parsed = JSON.parse(content);
    return parsed.subtasks || parsed;
  }

  /**
   * Generate code using AI
   */
  private async generateCode(
    issue: JiraWebhookPayload['issue'],
    analysis: string,
    subtasks: Subtask[]
  ): Promise<GeneratedCode> {
    const prompt = `Generate complete code to implement this ticket:

Ticket: ${issue.fields.summary}
Description: ${issue.fields.description || 'No description provided'}

Analysis:
${analysis}

Subtasks:
${subtasks.map((st, i) => `${i + 1}. ${st.title}: ${st.description}`).join('\n')}

Generate all necessary code files. Use this EXACT format:

### FILE: path/to/file1.ts
\`\`\`
// Complete file content
\`\`\`

### FILE: path/to/file2.ts
\`\`\`
// Complete file content
\`\`\`

After all files, list required packages:

### PACKAGES
- npm: package1, package2
- pip: package1, package2

Only include packages actually used in the code.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert software engineer. Generate production-ready code.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    });

    const content = response.choices[0].message.content || '';
    return this.parseGeneratedCode(content);
  }

  /**
   * Parse AI-generated code response
   */
  private parseGeneratedCode(content: string): GeneratedCode {
    const files: CodeFile[] = [];
    const packages: { npm?: string[]; pip?: string[] } = {};

    // Extract files
    const fileRegex = /### FILE: (.+?)\n