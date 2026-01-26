import Anthropic from "@anthropic-ai/sdk";

interface TicketAnalysis {
  summary: string;
  complexity: "low" | "medium" | "high";
  estimatedHours: number;
  suggestedApproach: string;
  requiredFiles: string[];
  dependencies: string[];
  risks: string[];
}

interface ImplementationPlan {
  steps: string[];
  filesToCreate: string[];
  filesToModify: string[];
  testingStrategy: string;
}

export class AIAgent {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey,
    });
  }

  async analyzeTicket(
    ticketTitle: string,
    ticketDescription: string
  ): Promise<TicketAnalysis> {
    const prompt = `Analyze this software development ticket and provide a structured analysis.

Ticket Title: ${ticketTitle}
Description: ${ticketDescription}

Provide your analysis in the following JSON format:
{
  "summary": "Brief summary of what needs to be done",
  "complexity": "low|medium|high",
  "estimatedHours": number,
  "suggestedApproach": "Recommended approach to implement this",
  "requiredFiles": ["list", "of", "files"],
  "dependencies": ["list", "of", "dependencies"],
  "risks": ["potential", "risks"]
}`;

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const responseText =
        message.content[0].type === "text" ? message.content[0].text : "";

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not extract JSON from AI response");
      }

      const analysis: TicketAnalysis = JSON.parse(jsonMatch[0]);
      return analysis;
    } catch (error) {
      console.error("Error analyzing ticket:", error);
      throw error;
    }
  }

  async generateImplementationPlan(
    analysis: TicketAnalysis
  ): Promise<ImplementationPlan> {
    const prompt = `Based on this ticket analysis, create a detailed implementation plan.

Analysis:
${JSON.stringify(analysis, null, 2)}

Provide an implementation plan in the following JSON format:
{
  "steps": ["step 1", "step 2", "..."],
  "filesToCreate": ["file1.ts", "file2.ts"],
  "filesToModify": ["existing1.ts", "existing2.ts"],
  "testingStrategy": "Description of how to test this implementation"
}`;

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const responseText =
        message.content[0].type === "text" ? message.content[0].text : "";

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not extract JSON from AI response");
      }

      const plan: ImplementationPlan = JSON.parse(jsonMatch[0]);
      return plan;
    } catch (error) {
      console.error("Error generating implementation plan:", error);
      throw error;
    }
  }

  async processTicket(
    ticketTitle: string,
    ticketDescription: string
  ): Promise<{
    analysis: TicketAnalysis;
    plan: ImplementationPlan;
  }> {
    console.log(`Processing ticket: ${ticketTitle}`);

    const analysis = await this.analyzeTicket(ticketTitle, ticketDescription);
    console.log("Ticket analysis complete:", analysis);

    const plan = await this.generateImplementationPlan(analysis);
    console.log("Implementation plan generated:", plan);

    return {
      analysis,
      plan,
    };
  }
}

// Example usage
export async function runAgent() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const agent = new AIAgent(apiKey);

  const result = await agent.processTicket(
    "Add user authentication",
    "Implement JWT-based authentication system with login and registration endpoints"
  );

  console.log("\n=== Final Result ===");
  console.log(JSON.stringify(result, null, 2));

  return result;
}