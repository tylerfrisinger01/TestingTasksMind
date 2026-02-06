import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: string;
    status: {
      name: string;
    };
    issuetype: {
      name: string;
    };
  };
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

export class AIAgent {
  private openai: OpenAI;
  private octokit: Octokit;
  private jiraBaseUrl: string;
  private jiraAuth: string;

  constructor() {
    // Initialize OpenAI
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize GitHub Octokit
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Initialize Jira configuration
    this.jiraBaseUrl = `https://${process.env.JIRA_HOST}`;
    this.jiraAuth = Buffer.from(
      `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
    ).toString('base64');
  }

  /**
   * Main entry point for processing a ticket
   */
  async processTicket(issue: JiraIssue): Promise<void> {
    try {
      console.log(`\n🚀 Starting AI agent processing for ${issue.key}`);
      
      // Step 1: Analyze the ticket with AI
      console.log('📊 Step 1: Analyzing ticket...');
      const analysis = await this.analyzeTicket(issue);
      console.log('✅ Analysis complete');

      // Step 2: Break down into subtasks
      console.log('📋 Step 2: Breaking down into subtasks...');
      const subtasks = await this.breakdownIntoSubtasks(issue, analysis);
      console.log(`✅ Created ${subtasks.length} subtasks`);

      // Step 3: Generate code for each subtask
      console.log('💻 Step 3: Generating code...');
      const codeChanges = await this.generateCode(issue, subtasks, analysis);
      console.log(`✅ Generated ${codeChanges.length} code changes`);

      // Step 4: Create branch and commit changes
      console.log('🌿 Step 4: Creating branch and committing...');
      const branchName = await this.createBranchAndCommit(issue, codeChanges);
      console.log(`✅ Created branch: ${branchName}`);

      // Step 5: Run tests (simulated for now)
      console.log('🧪 Step 5: Running tests...');
      const testsPass = await this.runTests(branchName);
      console.log(`✅ Tests ${testsPass ? 'passed' : 'failed'}`);

      // Step 6: Create pull request
      if (testsPass) {
        console.log('📬 Step 6: Creating pull request...');
        const prUrl = await this.createPullRequest(issue, branchName);
        console.log(`✅ Pull request created: ${prUrl}`);

        // Update Jira ticket
        await this.updateJiraTicket(issue.key, prUrl);
        console.log('✅ Jira ticket updated');
      } else {
        console.log('⚠️ Tests failed, skipping PR creation');
      }

      console.log(`\n✨ Processing complete for ${issue.key}\n`);
    } catch (error) {
      console.error(`❌ Error processing ticket ${issue.key}:`, error);
      throw error;
    }
  }

  /**
   * Analyze the ticket using GPT-4o
   */
  private async analyzeTicket(issue: JiraIssue): Promise<string> {
    const prompt = `
Analyze this software development ticket and provide a detailed technical analysis:

Ticket: ${issue.key}
Title: ${issue.fields.summary}
Description: ${issue.fields.description || 'No description provided'}
Type: ${issue.fields.issuetype.name}

Please provide:
1. Technical requirements
2. Potential challenges
3. Recommended approach
4. Dependencies and integrations needed
5. Estimated complexity (low/medium/high)
`;

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
      temperature: 0.7,
      max_tokens: 2000,
    });

    return response.choices[0].message.content || '';
  }

  /**
   * Break down the ticket into subtasks
   */
  private async breakdownIntoSubtasks(
    issue: JiraIssue,
    analysis: string
  ): Promise<Subtask[]> {
    const prompt = `
Based on this ticket and analysis, break it down into specific, actionable subtasks:

Ticket: ${issue.key}
Title: ${issue.fields.summary}
Description: ${issue.fields.description || 'No description provided'}

Analysis:
${analysis}

Create 3-7 subtasks. For each subtask, provide:
1. A clear, specific title
2. Detailed description of what needs to be done
3. Estimated complexity (low/medium/high)

Format as JSON array:
[
  {
    "title": "Subtask title",
    "description": "Detailed description",
    "estimatedComplexity": "low"
  }
]
`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at breaking down software tasks. Always respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content || '[]';
    
    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/