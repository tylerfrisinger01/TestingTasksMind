import express, { Request, Response, NextFunction } from 'express';
import { AIAgent } from './agent';

interface JiraWebhookPayload {
  webhookEvent: string;
  issue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: string;
      assignee?: {
        displayName: string;
        emailAddress: string;
      };
      priority?: {
        name: string;
      };
      labels?: string[];
    };
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string | null;
      toString: string | null;
    }>;
  };
}

export class WebhookHandler {
  private app: express.Application;
  private agent: AIAgent;
  private port: number;

  constructor(openaiApiKey: string, port = 3000) {
    this.app = express();
    this.agent = new AIAgent(openaiApiKey);
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Logging middleware
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Jira webhook endpoint
    this.app.post('/webhook/jira', async (req: Request, res: Response) => {
      try {
        await this.handleJiraWebhook(req, res);
      } catch (error) {
        console.error('Error handling Jira webhook:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Generic webhook endpoint
    this.app.post('/webhook', async (req: Request, res: Response) => {
      try {
        console.log('Received webhook:', JSON.stringify(req.body, null, 2));
        res.json({ 
          received: true, 
          timestamp: new Date().toISOString() 
        });
      } catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  private async handleJiraWebhook(req: Request, res: Response): Promise<void> {
    const payload = req.body as JiraWebhookPayload;
    
    console.log(`Received Jira webhook: ${payload.webhookEvent}`);

    // Check if this is an issue assignment event
    if (payload.webhookEvent === 'jira:issue_updated' && payload.changelog) {
      const assigneeChange = payload.changelog.items.find(
        item => item.field === 'assignee'
      );

      if (assigneeChange && assigneeChange.toString && payload.issue) {
        console.log(`Issue ${payload.issue.key} was assigned to ${assigneeChange.toString}`);
        
        // Process the ticket with AI
        await this.processAssignedTicket(payload.issue);
      }
    }

    // Acknowledge receipt
    res.json({ 
      received: true, 
      event: payload.webhookEvent,
      timestamp: new Date().toISOString() 
    });
  }

  private async processAssignedTicket(issue: JiraWebhookPayload['issue']): Promise<void> {
    if (!issue) {
      console.error('No issue data provided');
      return;
    }

    try {
      console.log(`Processing assigned ticket: ${issue.key}`);

      const ticketData = {
        id: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description || 'No description provided',
        assignee: issue.fields.assignee?.displayName,
        priority: issue.fields.priority?.name,
        labels: issue.fields.labels
      };

      // Process the ticket with AI agent
      const result = await this.agent.processTicket(ticketData);

      console.log('Ticket processing complete:');
      console.log('Analysis:', JSON.stringify(result.analysis, null, 2));
      console.log(`Generated ${result.code.files.length} files`);

      // Here you would typically:
      // 1. Create a branch
      // 2. Commit the generated files
      // 3. Run tests
      // 4. Create a pull request
      // For now, we just log the results

      console.log('Files to be created:');
      result.code.files.forEach(file => {
        console.log(`  - ${file.path} (${file.language})`);
      });

    } catch (error) {
      console.error(`Error processing ticket ${issue.key}:`, error);
      throw error;
    }
  }

  public start(): void {
    this.app.listen(this.port, () => {
      console.log(`Webhook server listening on port ${this.port}`);
      console.log(`Health check: http://localhost:${this.port}/health`);
      console.log(`Jira webhook: http://localhost:${this.port}/webhook/jira`);
    });
  }

  public getApp(): express.Application {
    return this.app;
  }
}

// Export a function to create and start the webhook handler
export function startWebhookServer(openaiApiKey: string, port?: number): WebhookHandler {
  const handler = new WebhookHandler(openaiApiKey, port);
  handler.start();
  return handler;
}