import { AIAgent, TicketWebhook, handleTicketWebhook } from './agent';

describe('AIAgent', () => {
  let agent: AIAgent;

  beforeEach(() => {
    // Use a test API key or mock
    agent = new AIAgent(process.env.ANTHROPIC_API_KEY || 'test-key');
  });

  describe('processTicketWebhook', () => {
    it('should process a simple ticket', async () => {
      const ticket: TicketWebhook = {
        ticketId: 'TEST-123',
        title: 'Add user authentication',
        description: 'Implement JWT-based authentication for the API',
        assignee: 'john.doe',
        priority: 'high',
        labels: ['backend', 'security'],
      };

      // This will make a real API call if ANTHROPIC_API_KEY is set
      if (process.env.ANTHROPIC_API_KEY) {
        const result = await agent.processTicketWebhook(ticket);

        expect(result).toBeDefined();
        expect(result.ticketId).toBe('TEST-123');
        expect(result.complexity).toMatch(/low|medium|high/);
        expect(result.estimatedHours).toBeGreaterThan(0);
        expect(result.implementationPlan).toBeDefined();
        expect(result.implementationPlan.subtasks.length).toBeGreaterThan(0);
      } else {
        console.log('Skipping API test - no ANTHROPIC_API_KEY set');
      }
    }, 30000); // 30 second timeout for API calls
  });

  describe('handleTicketWebhook', () => {
    it('should handle Jira webhook format', async () => {
      const jiraWebhook = {
        issue: {
          key: 'PROJ-456',
          fields: {
            summary: 'Fix login bug',
            description: 'Users cannot login with special characters in password',
            assignee: {
              displayName: 'Jane Smith',
            },
            priority: {
              name: 'critical',
            },
            labels: ['bug', 'frontend'],
          },
        },
      };

      if (process.env.ANTHROPIC_API_KEY) {
        const result = await handleTicketWebhook(jiraWebhook);

        expect(result).toBeDefined();
        expect(result.ticketId).toBe('PROJ-456');
      } else {
        console.log('Skipping API test - no ANTHROPIC_API_KEY set');
      }
    }, 30000);

    it('should handle generic webhook format', async () => {
      const genericWebhook = {
        id: 'TICKET-789',
        title: 'Optimize database queries',
        description: 'Improve performance of user search',
        assignee: 'bob.wilson',
        priority: 'medium',
        labels: ['performance', 'database'],
      };

      if (process.env.ANTHROPIC_API_KEY) {
        const result = await handleTicketWebhook(genericWebhook);

        expect(result).toBeDefined();
        expect(result.ticketId).toBe('TICKET-789');
      } else {
        console.log('Skipping API test - no ANTHROPIC_API_KEY set');
      }
    }, 30000);
  });

  describe('generateCode', () => {
    it('should generate code for a subtask', async () => {
      const subtask = {
        id: 'subtask-1',
        title: 'Create authentication middleware',
        description: 'Implement Express middleware to verify JWT tokens',
        estimatedEffort: '2 hours',
        dependencies: [],
      };

      const context = 'Using Express.js and jsonwebtoken library';

      if (process.env.ANTHROPIC_API_KEY) {
        const code = await agent.generateCode(subtask, context);

        expect(code).toBeDefined();
        expect(code.length).toBeGreaterThan(0);
        expect(code).toContain('function'); // Should contain code
      } else {
        console.log('Skipping API test - no ANTHROPIC_API_KEY set');
      }
    }, 30000);
  });

  describe('validateCode', () => {
    it('should validate code against requirements', async () => {
      const code = `
function authenticate(req, res, next) {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
      `;

      const requirements = 'Middleware should verify JWT tokens and handle errors';

      if (process.env.ANTHROPIC_API_KEY) {
        const validation = await agent.validateCode(code, requirements);

        expect(validation).toBeDefined();
        expect(typeof validation.valid).toBe('boolean');
        expect(Array.isArray(validation.issues)).toBe(true);
      } else {
        console.log('Skipping API test - no ANTHROPIC_API_KEY set');
      }
    }, 30000);
  });
});