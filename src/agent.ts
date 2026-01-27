import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Ticket {
  id: string;
  key: string;
  summary: string;
  description: string;
  assignee: string;
  status: string;
}

interface Subtask {
  id: string;
  description: string;
  files: string[];
  completed: boolean;
}

interface CodeChange {
  file: string;
  content: string;
}

export class AIAgent {
  private openai: OpenAI;
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private workingDir: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    this.repoOwner = process.env.GITHUB_REPO_OWNER || '';
    this.repoName = process.env.GITHUB_REPO_NAME || '';
    this.workingDir = process.env.WORKING_DIR || './workspace';
  }

  /**
   * Main entry point for processing a ticket
   */
  async processTicket(ticket: Ticket): Promise<void> {
    console.log(`Processing ticket: ${ticket.key} - ${ticket.summary}`);

    try {
      // Step 1: Analyze the ticket with AI
      const analysis = await this.analyzeTicket(ticket);
      console.log('Ticket analysis complete');

      // Step 2: Break down into subtasks
      const subtasks = await this.breakdownIntoSubtasks(ticket, analysis);
      console.log(`Created ${subtasks.length} subtasks`);

      // Step 3: Generate code for each subtask
      const codeChanges = await this.generateCode(ticket, subtasks);
      console.log(`Generated code changes for ${codeChanges.length} files`);

      // Step 4: Apply code changes to working directory
      await this.applyCodeChanges(codeChanges);
      console.log('Code changes applied');

      // Step 5: Run tests
      const testsPass = await this.runTests();
      console.log(`Tests ${testsPass ? 'passed' : 'failed'}`);

      if (!testsPass) {
        console.log('Attempting to fix test failures...');
        const fixedCode = await this.fixTestFailures(ticket, codeChanges);
        await this.applyCodeChanges(fixedCode);
        const retestPass = await this.runTests();
        
        if (!retestPass) {
          throw new Error('Unable to fix test failures');
        }
      }

      // Step 6: Create pull request
      const prUrl = await this.createPullRequest(ticket, subtasks);
      console.log(`Pull request created: ${prUrl}`);

    } catch (error) {
      console.error(`Error processing ticket ${ticket.key}:`, error);
      throw error;
    }
  }

  /**
   * Analyze ticket using GPT-4o to understand requirements
   */
  private async analyzeTicket(ticket: Ticket): Promise<string> {
    const prompt = `Analyze this software development ticket and provide a detailed technical analysis:

Ticket: ${ticket.key}
Summary: ${ticket.summary}
Description: ${ticket.description}

Provide:
1. Technical requirements
2. Affected components/modules
3. Potential challenges
4. Implementation approach
5. Testing considerations`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert software architect analyzing development tickets.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    });

    return response.choices[0].message.content || '';
  }

  /**
   * Break down ticket into manageable subtasks
   */
  private async breakdownIntoSubtasks(
    ticket: Ticket,
    analysis: string
  ): Promise<Subtask[]> {
    const prompt = `Based on this ticket and analysis, break it down into specific implementation subtasks:

Ticket: ${ticket.key} - ${ticket.summary}
Description: ${ticket.description}

Analysis:
${analysis}

Create a JSON array of subtasks with this structure:
[
  {
    "id": "subtask-1",
    "description": "Detailed description of what needs to be done",
    "files": ["path/to/file1.ts", "path/to/file2.ts"]
  }
]

Focus on concrete, implementable tasks. Each subtask should be specific and testable.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at breaking down software tasks into implementable subtasks.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);
    const subtasks = parsed.subtasks || [];

    return subtasks.map((st: any, index: number) => ({
      id: st.id || `subtask-${index + 1}`,
      description: st.description,
      files: st.files || [],
      completed: false,
    }));
  }

  /**
   * Generate code changes using AI
   */
  private async generateCode(
    ticket: Ticket,
    subtasks: Subtask[]
  ): Promise<CodeChange[]> {
    const codeChanges: CodeChange[] = [];

    // Get existing codebase context
    const codebaseContext = await this.getCodebaseContext(subtasks);

    const prompt = `Generate complete code to implement this ticket:

Ticket: ${ticket.key} - ${ticket.summary}
Description: ${ticket.description}

Subtasks:
${subtasks.map((st, i) => `${i + 1}. ${st.description}`).join('\n')}

Existing codebase context:
${codebaseContext}

Generate complete file contents for all necessary files. Use this EXACT format:

### FILE: path/to/file1.ts
\`\`\`
// Complete file content here
\`\`\`

### FILE: path/to/file2.ts
\`\`\`
// Complete file content here
\`\`\`

Include all necessary imports, error handling, and TypeScript types. Make the code production-ready.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert software engineer. Generate complete, production-ready code.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 16000,
    });

    const generatedCode = response.choices[0].message.content || '';
    
    // Parse the generated code
    const fileMatches = generatedCode.matchAll(/### FILE: (.+?)\n