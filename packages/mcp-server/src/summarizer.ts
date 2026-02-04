/**
 * Wyrm Summarizer - Compresses old sessions to save tokens
 * 
 * Uses a simple extractive summarization:
 * - Keeps key information (commits, files, major issues)
 * - Drops verbose descriptions
 * - Creates a condensed summary for archived sessions
 */

import { Session } from './database.js';

export interface SummaryResult {
  summary: string;
  tokenEstimate: number;
}

export function summarizeSession(session: Session): SummaryResult {
  const parts: string[] = [];
  
  // Date
  parts.push(`[${session.date}]`);
  
  // Objectives - just first line
  if (session.objectives) {
    const firstLine = session.objectives.split('\n')[0].trim();
    if (firstLine) parts.push(`Goal: ${firstLine}`);
  }
  
  // Completed - extract bullet points
  if (session.completed) {
    const items = extractBulletPoints(session.completed);
    if (items.length > 0) {
      parts.push(`Done: ${items.slice(0, 3).join(', ')}`);
    }
  }
  
  // Issues - keep key problems
  if (session.issues) {
    const issues = extractKeyIssues(session.issues);
    if (issues.length > 0) {
      parts.push(`Fixed: ${issues.slice(0, 2).join('; ')}`);
    }
  }
  
  // Commits - always keep
  if (session.commits) {
    const commits = session.commits.match(/[a-f0-9]{7,}/gi);
    if (commits && commits.length > 0) {
      parts.push(`Commits: ${commits.slice(0, 3).join(', ')}`);
    }
  }
  
  // Files - just count
  if (session.files_changed) {
    const files = session.files_changed.split('\n').filter(f => f.trim());
    if (files.length > 0) {
      parts.push(`Files: ${files.length} changed`);
    }
  }
  
  const summary = parts.join(' | ');
  const tokenEstimate = Math.ceil(summary.length / 4);
  
  return { summary, tokenEstimate };
}

export function summarizeMultipleSessions(sessions: Session[]): SummaryResult {
  const summaries = sessions.map(s => summarizeSession(s).summary);
  const combined = summaries.join('\n');
  return {
    summary: combined,
    tokenEstimate: Math.ceil(combined.length / 4)
  };
}

function extractBulletPoints(text: string): string[] {
  const lines = text.split('\n');
  const bullets: string[] = [];
  
  for (const line of lines) {
    const match = line.match(/^[\s]*[-*•\d.]+[\s]+(.+)/);
    if (match) {
      bullets.push(match[1].trim().slice(0, 50));
    }
  }
  
  return bullets;
}

function extractKeyIssues(text: string): string[] {
  const issues: string[] = [];
  
  // Look for "Problem:" or "Issue:" patterns
  const problemMatch = text.match(/(?:problem|issue|bug|fix(?:ed)?)[:\s]+([^.\n]+)/gi);
  if (problemMatch) {
    for (const match of problemMatch.slice(0, 3)) {
      const clean = match.replace(/^(?:problem|issue|bug|fix(?:ed)?)[:\s]+/i, '').trim();
      if (clean.length > 5) issues.push(clean.slice(0, 40));
    }
  }
  
  return issues;
}

/**
 * Estimate tokens in a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a compressed context bundle under a token limit
 */
export function createContextBundle(
  project: { name: string; stack?: string },
  currentContext: Record<string, string>,
  recentSessions: Session[],
  pendingQuests: { title: string; priority: string }[],
  maxTokens = 4000
): string {
  const parts: string[] = [];
  let currentTokens = 0;
  
  // Project header (always include)
  const header = `# ${project.name}\nStack: ${project.stack || 'Unknown'}`;
  parts.push(header);
  currentTokens += estimateTokens(header);
  
  // Architecture/key info from context
  const arch = currentContext['architecture'];
  if (arch && currentTokens + estimateTokens(arch) < maxTokens * 0.4) {
    parts.push(`\n## Architecture\n${arch}`);
    currentTokens += estimateTokens(arch);
  }
  
  // Credentials (if any)
  const creds = currentContext['credentials'];
  if (creds && currentTokens + estimateTokens(creds) < maxTokens * 0.5) {
    parts.push(`\n## Credentials\n${creds}`);
    currentTokens += estimateTokens(creds);
  }
  
  // Recent sessions (summarized if needed)
  if (recentSessions.length > 0) {
    parts.push('\n## Recent Sessions');
    
    for (const session of recentSessions) {
      const sessionText = session.summary || summarizeSession(session).summary;
      const tokens = estimateTokens(sessionText);
      
      if (currentTokens + tokens < maxTokens * 0.8) {
        parts.push(sessionText);
        currentTokens += tokens;
      } else {
        break;
      }
    }
  }
  
  // Pending quests
  if (pendingQuests.length > 0 && currentTokens < maxTokens * 0.9) {
    parts.push('\n## Pending Tasks');
    for (const quest of pendingQuests.slice(0, 10)) {
      const questText = `- [${quest.priority}] ${quest.title}`;
      if (currentTokens + estimateTokens(questText) < maxTokens) {
        parts.push(questText);
        currentTokens += estimateTokens(questText);
      }
    }
  }
  
  return parts.join('\n');
}
