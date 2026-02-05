import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { CodeChange } from '../types';

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    this.octokit = new Octokit({ auth: config.githubToken });
    this.owner = config.githubOwner;
    this.repo = config.githubRepo;
  }

  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<void> {
    try {
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${baseBranch}`,
      });

      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });
    } catch (error) {
      console.error('Error creating branch:', error);
      throw error;
    }
  }

  async commitChanges(
    branchName: string,
    changes: CodeChange[],
    commitMessage: string
  ): Promise<void> {
    try {
      const { data: ref } = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branchName}`,
      });

      const { data: commit } = await this.octokit.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: ref.object.sha,
      });

      const tree = await Promise.all(
        changes.map(async (change) => {
          if (change.action === 'delete') {
            return {
              path: change.filePath,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: null,
            };
          }

          const { data: blob } = await this.octokit.git.createBlob({
            owner: this.owner,
            repo: this.repo,
            content: Buffer.from(change.content).toString('base64'),
            encoding: 'base64',
          });

          return {
            path: change.filePath,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          };
        })
      );

      const { data: newTree } = await this.octokit.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: commit.tree.sha,
        tree,
      });

      const { data: newCommit } = await this.octokit.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message: commitMessage,
        tree: newTree.sha,
        parents: [ref.object.sha],
      });

      await this.octokit.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branchName}`,
        sha: newCommit.sha,
      });
    } catch (error) {
      console.error('Error committing changes:', error);
      throw error;
    }
  }

  async createPullRequest(
    branchName: string,
    title: string,
    body: string,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      const { data: pr } = await this.octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        head: branchName,
        base: baseBranch,
        body,
      });

      return pr.html_url;
    } catch (error) {
      console.error('Error creating pull request:', error);
      throw error;
    }
  }

  async getFileContent(filePath: string, branch: string = 'main'): Promise<string> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref: branch,
      });

      if ('content' in data) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      throw new Error('File content not found');
    } catch (error) {
      if ((error as any).status === 404) {
        return '';
      }
      throw error;
    }
  }
}