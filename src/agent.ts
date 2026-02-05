import Anthropic from '@anthropic-ai/sdk';

interface TicketWebhook {
  ticketId: string;
  title: string;
  description: string;
  assignee: string;
  priority: string;
  labels: string[];
}

interface SubTask {
  id: string;
  title: string;
  description: string;
  estimatedEffort: string;
  dependencies: string[];
}

interface ImplementationPlan {
  summary: string;
  approach: string;
  subtasks: SubTask[];
  technicalConsiderations: string[];
  risks: string[];
}

interface AnalysisResult {
  ticketId: string;
  complexity: 'low' | 'medium' | 'high';
  estimatedHours: number;
  implementationPlan: ImplementationPlan;
  requiresHumanReview: boolean;
  confidence: number;
}

export class AIAgent {
  private anthropic: Anthropic;
  private model: string = 'claude-3-5-sonnet-20241022';

  constructor(apiKey?: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Main entry point for webhook processing
   */
  async processTicketWebhook(webhook: TicketWebhook): Promise<AnalysisResult> {
    console.log(`Processing ticket: ${webhook.ticketId} - ${webhook.title}`);

    try {
      // Analyze the ticket with AI
      const analysis = await this.analyzeTicket(webhook);

      // Log the results
      console.log(`Analysis complete for ${webhook.ticketId}`);
      console.log(`Complexity: ${analysis.complexity}`);
      console.log(`Estimated hours: ${analysis.estimatedHours}`);
      console.log(`Subtasks: ${analysis.implementationPlan.subtasks.length}`);

      return analysis;
    } catch (error) {
      console.error(`Error processing ticket ${webhook.ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Analyze ticket and generate implementation plan using Claude
   */
  private async analyzeTicket(ticket: TicketWebhook): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(ticket);

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract the text content from the response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

    // Parse the AI response
    return this.parseAnalysisResponse(ticket.ticketId, responseText);
  }

  /**
   * Build the analysis prompt for Claude
   */
  private buildAnalysisPrompt(ticket: TicketWebhook): string {
    return `You are an expert software engineer analyzing a development ticket.

Ticket Details:
- ID: ${ticket.ticketId}
- Title: ${ticket.title}
- Description: ${ticket.description}
- Priority: ${ticket.priority}
- Labels: ${ticket.labels.join(', ')}

Please analyze this ticket and provide a detailed implementation plan in the following JSON format:

{
  "complexity": "low|medium|high",
  "estimatedHours": <number>,
  "implementationPlan": {
    "summary": "<brief overview>",
    "approach": "<technical approach>",
    "subtasks": [
      {
        "id": "subtask-1",
        "title": "<subtask title>",
        "description": "<detailed description>",
        "estimatedEffort": "<time estimate>",
        "dependencies": ["<other subtask ids>"]
      }
    ],
    "technicalConsiderations": ["<consideration 1>", "<consideration 2>"],
    "risks": ["<risk 1>", "<risk 2>"]
  },
  "requiresHumanReview": true|false,
  "confidence": <0-1>
}

Consider:
1. Break down the work into logical subtasks
2. Identify dependencies between subtasks
3. Estimate complexity and time realistically
4. Flag if human review is needed for critical decisions
5. Note any technical risks or challenges

Respond ONLY with valid JSON, no additional text.`;
  }

  /**
   * Parse the AI response into structured data
   */
  private parseAnalysisResponse(ticketId: string, response: string): AnalysisResult {
    try {
      // Extract JSON from response (handle cases where AI adds explanation)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        ticketId,
        complexity: parsed.complexity || 'medium',
        estimatedHours: parsed.estimatedHours || 8,
        implementationPlan: {
          summary: parsed.implementationPlan?.summary || 'No summary provided',
          approach: parsed.implementationPlan?.approach || 'No approach provided',
          subtasks: parsed.implementationPlan?.subtasks || [],
          technicalConsiderations: parsed.implementationPlan?.technicalConsiderations || [],
          risks: parsed.implementationPlan?.risks || [],
        },
        requiresHumanReview: parsed.requiresHumanReview !== false,
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      console.error('Error parsing AI response:', error);
      console.error('Response was:', response);

      // Return a safe default analysis
      return {
        ticketId,
        complexity: 'high',
        estimatedHours: 16,
        implementationPlan: {
          summary: 'Failed to parse AI response - manual review required',
          approach: 'Unable to generate automatic plan',
          subtasks: [
            {
              id: 'manual-review',
              title: 'Manual analysis required',
              description: 'AI analysis failed - human review needed',
              estimatedEffort: '2-4 hours',
              dependencies: [],
            },
          ],
          technicalConsiderations: ['AI parsing failed'],
          risks: ['Unable to automatically analyze ticket'],
        },
        requiresHumanReview: true,
        confidence: 0,
      };
    }
  }

  /**
   * Generate code for a specific subtask
   */
  async generateCode(subtask: SubTask, context: string): Promise<string> {
    const prompt = `You are an expert software engineer. Generate code to implement the following subtask:

Subtask: ${subtask.title}
Description: ${subtask.description}

Context:
${context}

Generate clean, well-documented code. Include:
1. Proper error handling
2. Type safety (TypeScript)
3. Unit test examples
4. Comments explaining complex logic

Respond with the code implementation.`;

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');
  }

  /**
   * Validate generated code
   */
  async validateCode(code: string, requirements: string): Promise<{ valid: boolean; issues: string[] }> {
    const prompt = `Review the following code against the requirements:

Requirements:
${requirements}

Code:
${code}

Analyze the code and respond in JSON format:
{
  "valid": true|false,
  "issues": ["<issue 1>", "<issue 2>"]
}

Check for:
1. Correctness
2. Security vulnerabilities
3. Performance issues
4. Best practices
5. Test coverage

Respond ONLY with valid JSON.`;

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { valid: false, issues: ['Failed to parse validation response'] };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        valid: parsed.valid || false,
        issues: parsed.issues || [],
      };
    } catch (error) {
      return { valid: false, issues: ['Error parsing validation response'] };
    }
  }
}

// Example usage and webhook handler
export async function handleTicketWebhook(webhookPayload: any): Promise<AnalysisResult> {
  // Transform webhook payload to our format
  const ticket: TicketWebhook = {
    ticketId: webhookPayload.issue?.key || webhookPayload.id,
    title: webhookPayload.issue?.fields?.summary || webhookPayload.title,
    description: webhookPayload.issue?.fields?.description || webhookPayload.description || '',
    assignee: webhookPayload.issue?.fields?.assignee?.displayName || webhookPayload.assignee || 'unassigned',
    priority: webhookPayload.issue?.fields?.priority?.name || webhookPayload.priority || 'medium',
    labels: webhookPayload.issue?.fields?.labels || webhookPayload.labels || [],
  };

  const agent = new AIAgent();
  return await agent.processTicketWebhook(ticket);
}

// Export for testing
export { TicketWebhook, SubTask, ImplementationPlan, AnalysisResult };