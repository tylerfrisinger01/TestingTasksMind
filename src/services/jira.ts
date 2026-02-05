import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { JiraTicket } from '../types';

export class JiraService {
  private client: AxiosInstance;

  constructor() {
    const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64');
    
    this.client = axios.create({
      baseURL: `https://${config.jiraHost}/rest/api/3`,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getTicket(ticketKey: string): Promise<JiraTicket> {
    try {
      const response = await this.client.get(`/issue/${ticketKey}`);
      const issue = response.data;

      return {
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || '',
        assignee: issue.fields.assignee?.displayName,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'Medium',
      };
    } catch (error) {
      console.error('Error fetching Jira ticket:', error);
      throw new Error(`Failed to fetch ticket ${ticketKey}`);
    }
  }

  async updateTicketStatus(ticketKey: string, status: string): Promise<void> {
    try {
      await this.client.post(`/issue/${ticketKey}/transitions`, {
        transition: { name: status },
      });
    } catch (error) {
      console.error('Error updating ticket status:', error);
    }
  }

  async addComment(ticketKey: string, comment: string): Promise<void> {
    try {
      await this.client.post(`/issue/${ticketKey}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: comment,
                },
              ],
            },
          ],
        },
      });
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  }
}