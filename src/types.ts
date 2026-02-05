export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  assignee?: string;
  status: string;
  priority: string;
}

export interface Subtask {
  title: string;
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface CodeChange {
  filePath: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

export interface AnalysisResult {
  understanding: string;
  subtasks: Subtask[];
  technicalApproach: string;
  estimatedEffort: string;
}

export interface AgentConfig {
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  openaiApiKey: string;
}