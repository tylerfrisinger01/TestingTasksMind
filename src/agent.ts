import OpenAI from 'openai';

interface TicketData {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
}

interface SubTask {
  title: string;
  description: string;
  estimatedEffort: string;
}

interface AnalysisResult {
  summary: string;
  complexity: 'low' | 'medium' | 'high';
  subtasks: SubTask[];
  technicalApproach: string;
  estimatedTime: string;
}

interface CodeGenerationResult {
  files: Array<{
    path: string;
    content: string;
    language: string;
  }>;
  testStrategy: string;
  implementationNotes: string;
}

export class AIAgent {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async analyzeTicket(ticket: TicketData): Promise<AnalysisResult> {
    console.log(`Analyzing ticket: ${ticket.id} - ${ticket.title}`);

    const prompt = `You are an expert software engineer analyzing a ticket.

Ticket Details:
- ID: ${ticket.id}
- Title: ${ticket.title}
- Description: ${ticket.description}
- Priority: ${ticket.priority || 'Not specified'}
- Labels: ${ticket.labels?.join(', ') || 'None'}

Please analyze this ticket and provide:
1. A brief summary of what needs to be done
2. Complexity assessment (low/medium/high)
3. Break it down into 2-4 subtasks
4. Technical approach recommendation
5. Estimated time to complete

Return your response in JSON format with this structure:
{
  "summary": "Brief summary",
  "complexity": "low|medium|high",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What needs to be done",
      "estimatedEffort": "time estimate"
    }
  ],
  "technicalApproach": "Recommended approach",
  "estimatedTime": "Total estimated time"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert software engineer who analyzes tickets and breaks them down into actionable subtasks. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      // Parse JSON response
      const analysis = JSON.parse(content) as AnalysisResult;
      console.log(`Analysis complete. Complexity: ${analysis.complexity}`);
      
      return analysis;
    } catch (error) {
      console.error('Error analyzing ticket:', error);
      throw new Error(`Failed to analyze ticket: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateCode(ticket: TicketData, analysis: AnalysisResult): Promise<CodeGenerationResult> {
    console.log(`Generating code for ticket: ${ticket.id}`);

    const prompt = `You are an expert software engineer. Generate code to implement this ticket.

Ticket: ${ticket.title}
Description: ${ticket.description}

Analysis:
${JSON.stringify(analysis, null, 2)}

Generate the necessary code files to implement this feature. Include:
1. All required source files with complete, production-ready code
2. Test files if applicable
3. Any configuration changes needed

Return your response in JSON format:
{
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "content": "complete file content",
      "language": "typescript"
    }
  ],
  "testStrategy": "How to test this implementation",
  "implementationNotes": "Important notes about the implementation"
}

Make sure all code is complete, follows best practices, and includes proper error handling.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert software engineer who writes clean, production-ready code. Always respond with valid JSON containing complete file contents.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      const codeResult = JSON.parse(content) as CodeGenerationResult;
      console.log(`Generated ${codeResult.files.length} files`);
      
      return codeResult;
    } catch (error) {
      console.error('Error generating code:', error);
      throw new Error(`Failed to generate code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async processTicket(ticket: TicketData): Promise<{
    analysis: AnalysisResult;
    code: CodeGenerationResult;
  }> {
    console.log(`Processing ticket: ${ticket.id}`);

    // Step 1: Analyze the ticket
    const analysis = await this.analyzeTicket(ticket);

    // Step 2: Generate code based on analysis
    const code = await this.generateCode(ticket, analysis);

    console.log(`Ticket ${ticket.id} processed successfully`);

    return {
      analysis,
      code
    };
  }

  async reviewCode(code: string, context: string): Promise<{
    approved: boolean;
    issues: string[];
    suggestions: string[];
  }> {
    console.log('Reviewing generated code...');

    const prompt = `You are a senior software engineer reviewing code.

Context: ${context}

Code to review:
\`\`\`
${code}
\`\`\`

Review this code for:
1. Correctness and functionality
2. Best practices and code quality
3. Security issues
4. Performance concerns
5. Test coverage

Return your review in JSON format:
{
  "approved": true/false,
  "issues": ["list of critical issues that must be fixed"],
  "suggestions": ["list of improvement suggestions"]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a senior software engineer conducting thorough code reviews. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      const review = JSON.parse(content);
      console.log(`Code review complete. Approved: ${review.approved}`);
      
      return review;
    } catch (error) {
      console.error('Error reviewing code:', error);
      throw new Error(`Failed to review code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}