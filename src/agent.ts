import OpenAI from 'openai';

interface Ticket {
  id: string;
  title: string;
  description: string;
  assignee?: string;
}

interface CodeChange {
  filePath: string;
  content: string;
}

interface AnalysisResult {
  summary: string;
  subtasks: string[];
  estimatedComplexity: string;
  suggestedApproach: string;
}

export class AIAgent {
  private openai: OpenAI;
  private systemPrompt: string;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.systemPrompt = `You are a helpful AI assistant.

You are an expert software engineer. Generate code changes to implement the ticket and fix the bugs if there are any, do not include any emojis.

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
  }

  async analyzeTicket(ticket: Ticket): Promise<AnalysisResult> {
    try {
      const prompt = `Analyze this ticket and provide a structured breakdown:

Title: ${ticket.title}
Description: ${ticket.description}

Please provide:
1. A brief summary
2. List of subtasks needed
3. Estimated complexity (Low/Medium/High)
4. Suggested technical approach`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an expert software architect analyzing development tickets.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });

      const content = response.choices[0]?.message?.content || '';
      
      return this.parseAnalysis(content);
    } catch (error) {
      console.error('Error analyzing ticket:', error);
      throw new Error('Failed to analyze ticket');
    }
  }

  private parseAnalysis(content: string): AnalysisResult {
    const lines = content.split('\n');
    let summary = '';
    const subtasks: string[] = [];
    let estimatedComplexity = 'Medium';
    let suggestedApproach = '';

    let currentSection = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.toLowerCase().includes('summary')) {
        currentSection = 'summary';
      } else if (trimmed.toLowerCase().includes('subtask')) {
        currentSection = 'subtasks';
      } else if (trimmed.toLowerCase().includes('complexity')) {
        currentSection = 'complexity';
      } else if (trimmed.toLowerCase().includes('approach')) {
        currentSection = 'approach';
      } else if (trimmed) {
        if (currentSection === 'summary' && !summary) {
          summary = trimmed;
        } else if (currentSection === 'subtasks' && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed))) {
          subtasks.push(trimmed.replace(/^[-*\d.]\s*/, ''));
        } else if (currentSection === 'complexity') {
          if (trimmed.toLowerCase().includes('low')) estimatedComplexity = 'Low';
          else if (trimmed.toLowerCase().includes('high')) estimatedComplexity = 'High';
          else estimatedComplexity = 'Medium';
        } else if (currentSection === 'approach') {
          suggestedApproach += trimmed + ' ';
        }
      }
    }

    return {
      summary: summary || 'Analysis completed',
      subtasks: subtasks.length > 0 ? subtasks : ['Implement solution'],
      estimatedComplexity,
      suggestedApproach: suggestedApproach.trim() || 'Standard implementation approach'
    };
  }

  async generateCode(ticket: Ticket, analysis: AnalysisResult): Promise<CodeChange[]> {
    try {
      const prompt = `Generate code to implement this ticket:

Title: ${ticket.title}
Description: ${ticket.description}

Analysis:
${analysis.summary}

Subtasks:
${analysis.subtasks.map((task, i) => `${i + 1}. ${task}`).join('\n')}

Generate complete, working code files needed to implement this feature.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });

      const content = response.choices[0]?.message?.content || '';
      
      return this.parseCodeChanges(content);
    } catch (error) {
      console.error('Error generating code:', error);
      throw new Error('Failed to generate code');
    }
  }

  private parseCodeChanges(response: string): CodeChange[] {
    const changes: CodeChange[] = [];
    const fileRegex = /### FILE:\s*(.+?)\n