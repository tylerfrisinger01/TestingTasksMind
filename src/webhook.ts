import { Request, Response } from 'express';
import { AIAgent } from './agent';

interface JiraWebhookPayload {
  webhookEvent: string;
  issue?: {
    key: string;
    fields: {
      summary: string;
      description: string;
      assignee?: {
        displayName: string;
        emailAddress: string;
      };
      status: {
        name: string;
      };
      issuetype: {
        name: string;
      };
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

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  try {
    const payload: JiraWebhookPayload = req.body;
    
    console.log(`📨 Received webhook event: ${payload.webhookEvent}`);

    // Check if this is an issue assignment event
    if (payload.webhookEvent === 'jira:issue_updated' && payload.changelog) {
      const assigneeChange = payload.changelog.items.find(
        item => item.field === 'assignee'
      );

      if (assigneeChange && assigneeChange.toString && payload.issue) {
        console.log(`🎯 Ticket ${payload.issue.key} assigned to ${assigneeChange.toString}`);
        
        // Initialize AI agent and process the ticket
        const agent = new AIAgent();
        await agent.processTicket(payload.issue);
        
        res.status(200).json({ 
          success: true, 
          message: 'Ticket processing initiated',
          ticketKey: payload.issue.key
        });
        return;
      }
    }

    // Acknowledge other webhook events
    res.status(200).json({ 
      success: true, 
      message: 'Webhook received but no action taken' 
    });
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}