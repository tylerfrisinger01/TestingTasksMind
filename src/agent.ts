import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Ticket {
  id: string;
  title: string;
  description: string;
  projectKey: string;
  assignee: string;
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

interface AnalysisResult {
  summary: string;
  subtasks: Subtask[];
  technicalApproach: string;
  estimatedEffort: string;
}

export class AIAgent {
  private openai: OpenAI;
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private baseBranch: string;

  constructor(
    openaiApiKey: string,
    githubToken: string,
    repoOwner: string,
    repoName: string,
    baseBranch: string = 'main'
  ) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.octokit = new Octokit({ auth: githubToken });
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.baseBranch = baseBranch;
  }

  async processTicket(ticket: Ticket): Promise<string> {
    console.log(`Processing ticket: ${ticket.id} - ${ticket.title}`);

    try {
      // Step 1: Analyze the ticket
      const analysis = await this.analyzeTicket(ticket);
      console.log('Ticket analysis complete:', analysis.summary);

      // Step 2: Get repository context
      const repoContext = await this.getRepositoryContext();

      // Step 3: Generate code changes
      const codeChanges = await this.generateCode(ticket, analysis, repoContext);
      console.log(`Generated ${codeChanges.length} code changes`);

      // Step 4: Create a new branch
      const branchName = `feature/${ticket.projectKey}-${ticket.id}`;
      await this.createBranch(branchName);

      // Step 5: Apply code changes
      await this.applyCodeChanges(codeChanges, branchName);

      // Step 6: Run tests
      const testsPass = await this.runTests();
      
      if (!testsPass) {
        console.warn('Tests failed, but continuing with PR creation');
      }

      // Step 7: Create pull request
      const prUrl = await this.createPullRequest(
        branchName,
        ticket,
        analysis,
        testsPass
      );

      console.log(`Pull request created: ${prUrl}`);
      return prUrl;
    } catch (error) {
      console.error('Error processing ticket:', error);
      throw error;
    }
  }

  private async analyzeTicket(ticket: Ticket): Promise<AnalysisResult> {
    const prompt = `Analyze this software development ticket and provide a structured breakdown:

Ticket ID: ${ticket.id}
Title: ${ticket.title}
Description: ${ticket.description}

Please provide:
1. A brief summary of what needs to be done
2. Break down into 3-5 subtasks with complexity estimates
3. Technical approach and considerations
4. Estimated effort (hours)

Format your response as JSON with this structure:
{
  "summary": "Brief summary",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What needs to be done",
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "technicalApproach": "Technical details",
  "estimatedEffort": "X hours"
}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert software architect. Analyze tickets and provide structured breakdowns in JSON format.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    return JSON.parse(content) as AnalysisResult;
  }

  private async getRepositoryContext(): Promise<string> {
    try {
      // Get repository structure
      const { data: tree } = await this.octokit.git.getTree({
        owner: this.repoOwner,
        repo: this.repoName,
        tree_sha: this.baseBranch,
        recursive: 'true'
      });

      // Filter for relevant files (source code, configs)
      const relevantFiles = tree.tree
        .filter(item => 
          item.type === 'blob' && 
          item.path &&
          (item.path.match(/\.(ts|js|tsx|jsx|json|md)$/) ||
           item.path === 'package.json' ||
           item.path === 'tsconfig.json')
        )
        .slice(0, 50); // Limit to first 50 files

      const fileContents = await Promise.all(
        relevantFiles.slice(0, 10).map(async (file) => {
          try {
            const { data } = await this.octokit.repos.getContent({
              owner: this.repoOwner,
              repo: this.repoName,
              path: file.path!,
              ref: this.baseBranch
            });

            if ('content' in data) {
              const content = Buffer.from(data.content, 'base64').toString('utf-8');
              return `### FILE: ${file.path}\n${content.slice(0, 1000)}\n`;
            }
            return '';
          } catch (error) {
            return '';
          }
        })
      );

      const structure = relevantFiles.map(f => f.path).join('\n');
      
      return `Repository Structure:\n${structure}\n\nSample Files:\n${fileContents.join('\n')}`;
    } catch (error) {
      console.error('Error getting repository context:', error);
      return 'Repository context unavailable';
    }
  }

  private async generateCode(
    ticket: Ticket,
    analysis: AnalysisResult,
    repoContext: string
  ): Promise<CodeChange[]> {
    const prompt = `You are an expert software engineer. Generate code changes to implement this ticket.

Ticket: ${ticket.title}
Description: ${ticket.description}

Analysis:
${JSON.stringify(analysis, null, 2)}

Repository Context:
${repoContext}

Generate complete code for the necessary files. Use this EXACT format:

### FILE: path/to/file1.ts
\`\`\`
// Complete file content here
\`\`\`

### FILE: path/to/file2.ts
\`\`\`
// Complete file content here
\`\`\`

Include all necessary imports, error handling, and TypeScript types.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert software engineer. Generate complete, production-ready code.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 16000
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No code generated');
    }

    return this.parseCodeChanges(content);
  }

  private parseCodeChanges(content: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE: (.+?)\n