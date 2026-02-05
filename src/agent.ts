import Anthropic from "@anthropic-ai/sdk";

interface TicketData {
  id: string;
  title: string;
  description: string;
  assignee?: string;
}

interface SubTask {
  id: string;
  description: string;
  estimatedComplexity: "low" | "medium" | "high";
}

interface CodeChange {
  filePath: string;
  content: string;
  operation: "create" | "modify" | "delete";
}

interface AgentResult {
  ticket: TicketData;
  analysis: string;
  subtasks: SubTask[];
  codeChanges: CodeChange[];
  testResults?: {
    passed: boolean;
    details: string;
  };
  pullRequestUrl?: string;
}

export class AIAgent {
  private anthropic: Anthropic;
  private model: string = "claude-3-5-sonnet-20241022";

  constructor(apiKey?: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Main entry point: Process a ticket end-to-end
   */
  async processTicket(ticket: TicketData): Promise<AgentResult> {
    console.log(`Processing ticket: ${ticket.id} - ${ticket.title}`);

    // Step 1: Analyze the ticket
    const analysis = await this.analyzeTicket(ticket);
    console.log("Analysis complete");

    // Step 2: Break down into subtasks
    const subtasks = await this.breakdownIntoSubtasks(ticket, analysis);
    console.log(`Generated ${subtasks.length} subtasks`);

    // Step 3: Generate code changes
    const codeChanges = await this.generateCode(ticket, analysis, subtasks);
    console.log(`Generated ${codeChanges.length} code changes`);

    // Step 4: Run tests (simulated for now)
    const testResults = await this.runTests(codeChanges);
    console.log(`Tests ${testResults.passed ? "passed" : "failed"}`);

    // Step 5: Create PR (simulated for now)
    const pullRequestUrl = await this.createPullRequest(
      ticket,
      codeChanges,
      testResults
    );

    return {
      ticket,
      analysis,
      subtasks,
      codeChanges,
      testResults,
      pullRequestUrl,
    };
  }

  /**
   * Analyze ticket using AI
   */
  private async analyzeTicket(ticket: TicketData): Promise<string> {
    const prompt = `Analyze this software development ticket and provide a technical analysis:

Title: ${ticket.title}
Description: ${ticket.description}

Provide:
1. Technical requirements
2. Potential challenges
3. Recommended approach
4. Dependencies and integrations needed`;

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    return content.type === "text" ? content.text : "";
  }

  /**
   * Break down ticket into subtasks
   */
  private async breakdownIntoSubtasks(
    ticket: TicketData,
    analysis: string
  ): Promise<SubTask[]> {
    const prompt = `Based on this ticket and analysis, break it down into specific subtasks:

Title: ${ticket.title}
Description: ${ticket.description}

Analysis: ${analysis}

Generate 3-7 concrete subtasks. For each subtask, provide:
- A clear description
- Estimated complexity (low/medium/high)

Format as JSON array:
[
  {
    "id": "subtask-1",
    "description": "Description here",
    "estimatedComplexity": "medium"
  }
]`;

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return [];
    }

    try {
      // Extract JSON from response
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("Failed to parse subtasks:", error);
    }

    // Fallback: create basic subtasks
    return [
      {
        id: "subtask-1",
        description: "Implement core functionality",
        estimatedComplexity: "high",
      },
      {
        id: "subtask-2",
        description: "Add tests",
        estimatedComplexity: "medium",
      },
      {
        id: "subtask-3",
        description: "Update documentation",
        estimatedComplexity: "low",
      },
    ];
  }

  /**
   * Generate code changes using AI
   */
  private async generateCode(
    ticket: TicketData,
    analysis: string,
    subtasks: SubTask[]
  ): Promise<CodeChange[]> {
    const prompt = `Generate code to implement this ticket:

Title: ${ticket.title}
Description: ${ticket.description}

Analysis: ${analysis}

Subtasks:
${subtasks.map((st) => `- ${st.description}`).join("\n")}

Generate the necessary code files. For each file, use this format:

### FILE: path/to/file.ts
\`\`\`typescript
// Complete file content
\`\`\`

Focus on creating working, production-ready code.`;

    const message = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return [];
    }

    return this.parseCodeChanges(content.text);
  }

  /**
   * Parse code changes from AI response
   */
  private parseCodeChanges(response: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE: (.+?)\n