import express, { Request, Response } from 'express';
import { AIAgent } from './agent';

interface WebhookPayload {
  webhookEvent?: string;
  issue?: {
    key: string;
    fields: {
      summary: string;
      description: string;
      assignee?: {
        displayName: string;
      };
    };
  };
}

export class WebhookHandler {
  private app: express.Application;
  private agent: AIAgent;
  private port: number;

  constructor(agent: AIAgent, port: number = 3000) {
    this.app = express();
    this.agent = agent;
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    this.app.post('/webhook/jira', this.handleJiraWebhook.bind(this));
    
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    this.app.get('/', (req: Request, res: Response) => {
      res.json({ 
        message: 'AI Agent Webhook Server',
        endpoints: {
          jira: '/webhook/jira',
          health: '/health'
        }
      });
    });
  }

  private async handleJiraWebhook(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as WebhookPayload;
      
      console.log('Received webhook:', payload.webhookEvent);

      if (!payload.issue) {
        res.status(400).json({ error: 'No issue data in payload' });
        return;
      }

      const isAssignmentEvent = 
        payload.webhookEvent === 'jira:issue_updated' &&
        payload.issue.fields.assignee;

      if (!isAssignmentEvent) {
        res.status(200).json({ message: 'Event ignored (not an assignment)' });
        return;
      }

      const ticket = {
        id: payload.issue.key,
        title: payload.issue.fields.summary,
        description: payload.issue.fields.description || '',
        assignee: payload.issue.fields.assignee?.displayName
      };

      res.status(202).json({ 
        message: 'Ticket accepted for processing',
        ticketId: ticket.id 
      });

      this.processTicketAsync(ticket);

    } catch (error) {
      console.error('Error handling webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async processTicketAsync(ticket: any): Promise<void> {
    try {
      console.log(`Starting async processing for ticket ${ticket.id}`);
      
      const result = await this.agent.processTicket(ticket);
      
      console.log(`Ticket ${ticket.id} processed successfully`);
      console.log(`Analysis: ${result.analysis.summary}`);
      console.log(`Generated ${result.codeChanges.length} files`);
      
      for (const change of result.codeChanges) {
        console.log(`  - ${change.filePath}`);
      }

    } catch (error) {
      console.error(`Error processing ticket ${ticket.id}:`, error);
    }
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`Webhook server listening on port ${this.port}`);
      console.log(`Jira webhook endpoint: http://localhost:${this.port}/webhook/jira`);
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}