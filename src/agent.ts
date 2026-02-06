import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

interface Ticket {
  id: string;
  key: string;
  summary: string;
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
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

interface AgentConfig {
  anthropicApiKey: string;
  githubToken: string;
  jiraUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
}

export class AIAgent {
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
   * Main entry point - processes a ticket end-to-end
   */
  async processTicket(ticket: Ticket): Promise<string> {
    try {
      console.log(`🤖 Processing ticket: ${ticket.key} - ${ticket.summary}`);

      // Step 1: Analyze the ticket
      const analysis = await this.analyzeTicket(ticket);
      console.log('✅ Ticket analyzed');

      // Step 2: Break down into subtasks
      const subtasks = await this.breakdownIntoSubtasks(ticket, analysis);
      console.log(`✅ Created ${subtasks.length} subtasks`);

      // Step 3: Get repository context
      const repoContext = await this.getRepositoryContext();
      console.log('✅ Repository context gathered');

      // Step 4: Generate code changes
      const codeChanges = await this.generateCode(ticket, subtasks, repoContext);
      console.log(`✅ Generated ${codeChanges.length} code changes`);

      // Step 5: Create branch and commit changes
      const branchName = await this.createBranchAndCommit(ticket, codeChanges);
      console.log(`✅ Created branch: ${branchName}`);

      // Step 6: Run tests (simulated for now)
      const testsPass = await this.runTests(branchName);
      console.log(`✅ Tests ${testsPass ? 'passed' : 'failed'}`);

      // Step 7: Create pull request
      const prUrl = await this.createPullRequest(ticket, branchName, subtasks);
      console.log(`✅ Pull request created: ${prUrl}`);

      // Step 8: Update Jira ticket
      await this.updateJiraTicket(ticket.key, prUrl);
      console.log('✅ Jira ticket updated');

      return prUrl;
    } catch (error) {
      console.error('❌ Error processing ticket:', error);
      throw error;
    }
  }

  /**
   * Analyzes the ticket using Claude AI
   */
  private async analyzeTicket(ticket: Ticket): Promise<string> {
    const prompt = `Analyze this software development ticket and provide a technical analysis:

Ticket: ${ticket.key}
Summary: ${ticket.summary}
Description: ${ticket.description}

Please provide:
1. Technical requirements
2. Potential challenges
3. Recommended approach
4. Files that likely need changes
5. Testing considerations`;

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

    const content = message.content[0];
    return content.type === 'text' ? content.text : '';
  }

  /**
   * Breaks down the ticket into actionable subtasks
   */
  private async breakdownIntoSubtasks(
    ticket: Ticket,
    analysis: string
  ): Promise<Subtask[]> {
    const prompt = `Based on this ticket and analysis, break it down into specific subtasks:

Ticket: ${ticket.key}
Summary: ${ticket.summary}
Description: ${ticket.description}

Analysis:
${analysis}

Create 3-7 specific, actionable subtasks. Return as JSON array with format:
[
  {
    "title": "Subtask title",
    "description": "Detailed description",
    "estimatedComplexity": "low|medium|high"
  }
]`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    const responseText = content.type === 'text' ? content.text : '';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // Fallback subtasks
    return [
      {
        title: 'Implement core functionality',
        description: ticket.description,
        estimatedComplexity: 'medium',
      },
    ];
  }

  /**
   * Gets repository context (file structure, key files)
   */
  private async getRepositoryContext(): Promise<string> {
    try {
      // Get repository tree
      const { data: tree } = await this.octokit.git.getTree({
        owner: this.config.githubOwner,
        repo: this.config.githubRepo,
        tree_sha: this.config.defaultBranch,
        recursive: 'true',
      });

      // Filter to important files
      const importantFiles = tree.tree
        .filter(
          (item) =>
            item.type === 'blob' &&
            (item.path?.endsWith('.ts') ||
              item.path?.endsWith('.js') ||
              item.path?.endsWith('.tsx') ||
              item.path?.endsWith('.jsx') ||
              item.path?.includes('package.json') ||
              item.path?.includes('README'))
        )
        .slice(0, 50)
        .map((item) => item.path);

      return `Repository structure:\n${importantFiles.join('\n')}`;
    } catch (error) {
      console.error('Error getting repository context:', error);
      return 'Repository context unavailable';
    }
  }

  /**
   * Generates code changes using Claude AI
   */
  private async generateCode(
    ticket: Ticket,
    subtasks: Subtask[],
    repoContext: string
  ): Promise<CodeChange[]> {
    const prompt = `You are an expert software engineer. Generate code changes to implement this ticket:

Ticket: ${ticket.key}
Summary: ${ticket.summary}
Description: ${ticket.description}

Subtasks:
${subtasks.map((st, i) => `${i + 1}. ${st.title}: ${st.description}`).join('\n')}

Repository Context:
${repoContext}

IMPORTANT: Return files using this EXACT format (no JSON):

### FILE: path/to/file1.ts
\`\`\`
// Complete file content here
export function example() {
  return "hello";
}
\`\`\`

### FILE: path/to/file2.ts
\`\`\`
// Complete file content here
import { example } from './file1';
\`\`\`

Use exactly "### FILE: " followed by the path, then the code in triple backticks.
Generate complete, production-ready code with proper error handling and types.`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    const responseText = content.type === 'text' ? content.text : '';

    return this.parseCodeChanges(responseText);
  }

  /**
   * Parses code changes from AI response
   */
  private parseCodeChanges(response: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE: (.+?)\n