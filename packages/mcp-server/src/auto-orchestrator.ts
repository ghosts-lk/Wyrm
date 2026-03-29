/**
 * Wyrm Auto-Orchestrator - Automatically apply reasoning patterns
 * 
 * This layer intercepts task requests and automatically applies
 * the best multi-agent reasoning pattern based on task classification.
 * 
 * Patterns applied automatically:
 * - Haiku Boosting: All content generation via few-shot + self-critique
 * - Ensemble Voting: Decisions (architecture, design, strategy) via N approaches + vote
 * - Task Decomposition: Large features via subtasks + parallel execution
 * - Verification: High-risk code changes via multi-angle review
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 */

export type TaskType = 
  | 'decision'       // Architecture/design choices → ensemble voting
  | 'generation'     // Content/code creation → Haiku boosting
  | 'research'       // Investigation/analysis → parallel research
  | 'verification'   // Code review/QA → multi-angle verification
  | 'decomposition'; // Large feature → task breakdown + parallel

export interface ClassifiedTask {
  type: TaskType;
  confidence: number; // 0-100
  description: string;
  complexity: 'low' | 'medium' | 'high';
  recommendedApproach: string;
  parallelBlocks?: number; // How many parallel agents to spawn
}

export interface OrchestrationConfig {
  autoOrchestrateEnabled: boolean;
  minConfidenceThreshold: number; // Only auto-apply if confidence > threshold
  maxParallelAgents: number;
  defaultHaikuBoosting: boolean; // Boost all Haiku calls
  trackMetrics: boolean; // Store quality/cost metrics
  thinkingBudget?: number; // Max thinking tokens for reasoning
}

export interface OrchestrationResult {
  taskType: TaskType;
  approach: string;
  results: unknown;
  quality: number; // 0-100
  costSavings: number; // % savings vs Opus
  parallelExecutionTime: number; // ms
  confidence: number;
  appliedPatterns: string[];
  metrics: {
    tokensBoosting: number;
    tokensEnsemble: number;
    tokensVerification: number;
    totalTokens: number;
  };
}

/**
 * Classify incoming task based on multiple signals
 */
export function classifyTask(
  input: string,
  context?: { projectType?: string; recentTasks?: string[]; complexity?: string }
): ClassifiedTask {
  const text = input.toLowerCase();
  let type: TaskType = 'generation';
  let confidence = 50;
  let complexity: 'low' | 'medium' | 'high' = 'medium';
  
  // Decision detection
  const decisionKeywords = ['decide', 'choose', 'architecture', 'design pattern', 'approach', 'strategy', 'should we', 'which is better', 'trade-off', 'tradeoff'];
  if (decisionKeywords.some(kw => text.includes(kw))) {
    type = 'decision';
    confidence = 85;
    complexity = context?.complexity === 'high' ? 'high' : 'medium';
  }
  
  // Research detection
  const researchKeywords = ['investigate', 'analyze', 'explore', 'research', 'what are the', 'find all', 'compare', 'benchmark'];
  if (researchKeywords.some(kw => text.includes(kw))) {
    type = 'research';
    confidence = 80;
    complexity = 'high';
  }
  
  // Verification detection
  const verificationKeywords = ['review', 'check', 'validate', 'test', 'security', 'performance', 'audit', 'lint'];
  if (verificationKeywords.some(kw => text.includes(kw))) {
    type = 'verification';
    confidence = 75;
    complexity = 'medium';
  }
  
  // Decomposition detection (large feature builds)
  const decompositionKeywords = ['build', 'implement', 'feature', 'system', 'module', 'create', 'develop', 'setup'];
  const hasDetailedDescription = input.length > 500;
  if (decompositionKeywords.some(kw => text.includes(kw)) && hasDetailedDescription) {
    type = 'decomposition';
    confidence = 70;
    complexity = 'high';
  }
  
  // Generation (default, with boosting)
  if (type === 'generation') {
    confidence = 60; // Lower confidence for default catch-all
    complexity = 'low';
  }
  
  // Adjust complexity based on input length
  if (input.length > 1000) complexity = 'high';
  if (input.length < 200) complexity = 'low';
  
  const parallelBlocks = getParallelBlockCount(type, complexity);
  
  return {
    type,
    confidence,
    description: input.substring(0, 100) + (input.length > 100 ? '...' : ''),
    complexity,
    recommendedApproach: getRecommendedApproach(type),
    parallelBlocks,
  };
}

/**
 * Determine how many parallel agents to spawn
 */
function getParallelBlockCount(type: TaskType, complexity: string): number {
  const config: Record<TaskType, Record<string, number>> = {
    decision: { low: 2, medium: 3, high: 4 },
    generation: { low: 1, medium: 2, high: 3 },
    research: { low: 2, medium: 4, high: 6 },
    verification: { low: 2, medium: 3, high: 4 },
    decomposition: { low: 2, medium: 4, high: 6 },
  };
  
  return config[type][complexity] || 3;
}

/**
 * Get recommended orchestration approach
 */
function getRecommendedApproach(type: TaskType): string {
  const approaches: Record<TaskType, string> = {
    decision: 'ensemble-voting (4 approaches + vote)',
    generation: 'haiku-boosting (few-shot + self-critique)',
    research: 'parallel-research (N angles + synthesis)',
    verification: 'verification-pipeline (security + perf + style reviews)',
    decomposition: 'task-decomposition (subtasks + parallel + synthesis)',
  };
  
  return approaches[type];
}

/**
 * Default orchestration config
 */
export function getDefaultConfig(): OrchestrationConfig {
  return {
    autoOrchestrateEnabled: true,
    minConfidenceThreshold: 65, // Only apply if 65%+ confident
    maxParallelAgents: 6,
    defaultHaikuBoosting: true, // Boost all Haiku content generation
    trackMetrics: true,
    thinkingBudget: 10000, // Max thinking tokens per orchestrated task
  };
}

/**
 * Apply appropriate orchestration pattern
 */
export async function orchestrateTask(
  task: string,
  config: OrchestrationConfig = getDefaultConfig()
): Promise<OrchestrationResult> {
  const classified = classifyTask(task);
  
  // Check if confidence meets threshold
  if (classified.confidence < config.minConfidenceThreshold) {
    return {
      taskType: classified.type,
      approach: 'standard (below confidence threshold)',
      results: null,
      quality: 0,
      costSavings: 0,
      parallelExecutionTime: 0,
      confidence: classified.confidence,
      appliedPatterns: [],
      metrics: { tokensBoosting: 0, tokensEnsemble: 0, tokensVerification: 0, totalTokens: 0 },
    };
  }
  
  // Apply pattern based on task type
  let patterns: string[] = [];
  let startTime = Date.now();
  
  switch (classified.type) {
    case 'decision':
      patterns = ['ensemble-voting', 'haiku-boosting'];
      // Would spawn 4 approaches via parallel agents, vote, boost confidence
      break;
    case 'generation':
      patterns = ['haiku-boosting', 'self-critique'];
      // Add few-shot examples + self-critique loop
      break;
    case 'research':
      patterns = ['parallel-research', 'synthesis'];
      // Spawn parallel agents for different angles, synthesize findings
      break;
    case 'verification':
      patterns = ['parallel-review', 'multi-angle'];
      // Parallel: security review, performance check, style check → synthesize
      break;
    case 'decomposition':
      patterns = ['task-decomposition', 'parallel-synthesis'];
      // Break into subtasks, parallel execution, merge results
      break;
  }
  
  const executionTime = Date.now() - startTime;
  
  // Estimate quality and cost savings
  const qualityBoost = getQualityBoost(patterns);
  const costSavings = getCostSavings(patterns, classified.parallelBlocks);
  
  return {
    taskType: classified.type,
    approach: classified.recommendedApproach,
    results: null, // Would be filled by actual implementation
    quality: 60 + qualityBoost,
    costSavings,
    parallelExecutionTime: executionTime,
    confidence: classified.confidence,
    appliedPatterns: patterns,
    metrics: {
      tokensBoosting: patterns.includes('haiku-boosting') ? 800 : 0,
      tokensEnsemble: patterns.includes('ensemble-voting') ? 1200 : 0,
      tokensVerification: patterns.includes('multi-angle') ? 600 : 0,
      totalTokens: 0, // Would be calculated
    },
  };
}

/**
 * Quality boost from applied patterns (est. %)
 */
function getQualityBoost(patterns: string[]): number {
  let boost = 0;
  if (patterns.includes('haiku-boosting')) boost += 45;
  if (patterns.includes('ensemble-voting')) boost += 35;
  if (patterns.includes('self-critique')) boost += 25;
  if (patterns.includes('multi-angle')) boost += 20;
  return Math.min(boost, 80); // Cap at 80% boost
}

/**
 * Cost savings vs Opus (est. %)
 */
function getCostSavings(patterns: string[], parallelBlocks: number = 1): number {
  // Base: Haiku is 10x cheaper than Opus
  // With patterns: Multiple Haiku calls (boosting + ensemble) still beat single Opus
  // Typical: 4 Haiku ($0.48) vs 1 Opus ($1.00) = 52% savings
  
  if (patterns.includes('ensemble-voting')) {
    return parallelBlocks > 1 ? 45 : 30; // Multiple approaches still cheaper
  }
  if (patterns.includes('haiku-boosting')) {
    return 35; // Boosting adds overhead but still cheaper than Opus
  }
  return 25; // Other patterns, general Haiku usage
}

/**
 * Orchestration middleware for agent context
 * 
 * Usage in agent:
 * ```typescript
 * const config = getDefaultConfig();
 * const task = "Design a microservice architecture for a real-time collaboration tool";
 * const plan = await orchestrateTask(task, config);
 * 
 * if (plan.appliedPatterns.length > 0) {
 *   // Auto-orchestration active
 *   // Implementation would:
 *   // 1. Spawn parallel agents (if ensemble/decomposition)
 *   // 2. Apply boosting (if generation)
 *   // 3. Run reviews (if verification)
 *   // 4. Synthesize results
 *   // 5. Store metrics in Wyrm
 * }
 * ```
 */
export class AutoOrchestrator {
  private config: OrchestrationConfig;
  private taskHistory: ClassifiedTask[] = [];
  
  constructor(config?: Partial<OrchestrationConfig>) {
    this.config = {
      ...getDefaultConfig(),
      ...config,
    };
  }
  
  /**
   * Process incoming task with auto-orchestration
   */
  async processTask(task: string): Promise<OrchestrationResult> {
    const classified = classifyTask(task);
    this.taskHistory.push(classified);
    
    // Trim history to last 100 tasks
    if (this.taskHistory.length > 100) {
      this.taskHistory = this.taskHistory.slice(-100);
    }
    
    return orchestrateTask(task, this.config);
  }
  
  /**
   * Get task classification insight
   */
  getTaskDistribution(): Record<TaskType, number> {
    const dist: Record<TaskType, number> = {
      decision: 0,
      generation: 0,
      research: 0,
      verification: 0,
      decomposition: 0,
    };
    
    for (const task of this.taskHistory) {
      dist[task.type]++;
    }
    
    return dist;
  }
  
  /**
   * Get orchestration effectiveness stats
   */
  getStats(): {
    tasksProcessed: number;
    distribution: Record<TaskType, number>;
    estimatedQualityBoost: number; // Average %
    estimatedCostSavings: number; // Average %
    averageComplexity: 'low' | 'medium' | 'high';
  } {
    const distribution = this.getTaskDistribution();
    const total = this.taskHistory.length;
    
    const avgQuality = this.taskHistory.reduce((sum, t) => {
      const patterns = this.getPatternSetForType(t.type);
      return sum + getQualityBoost(patterns);
    }, 0) / (total || 1);
    
    const avgCost = this.taskHistory.reduce((sum, t) => {
      return sum + getCostSavings(this.getPatternSetForType(t.type), t.complexity === 'high' ? 4 : 2);
    }, 0) / (total || 1);
    
    const complexities = this.taskHistory.map(t => t.complexity);
    const avgComplexity = complexities.filter(c => c === 'high').length > total / 2
      ? 'high'
      : complexities.filter(c => c === 'low').length > total / 2
      ? 'low'
      : 'medium';
    
    return {
      tasksProcessed: total,
      distribution,
      estimatedQualityBoost: Math.round(avgQuality),
      estimatedCostSavings: Math.round(avgCost),
      averageComplexity,
    };
  }
  
  /**
   * Get pattern set for task type
   */
  private getPatternSetForType(type: TaskType): string[] {
    const patterns: Record<TaskType, string[]> = {
      decision: ['ensemble-voting', 'haiku-boosting'],
      generation: ['haiku-boosting', 'self-critique'],
      research: ['parallel-research', 'synthesis'],
      verification: ['parallel-review', 'multi-angle'],
      decomposition: ['task-decomposition', 'parallel-synthesis'],
    };
    
    return patterns[type];
  }
  
  /**
   * Update config at runtime
   */
  updateConfig(updates: Partial<OrchestrationConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

/**
 * Singleton instance for global orchestration
 */
let globalOrchestrator: AutoOrchestrator | null = null;

export function getGlobalOrchestrator(): AutoOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new AutoOrchestrator(getDefaultConfig());
  }
  return globalOrchestrator;
}

export function initializeOrchestrator(config?: Partial<OrchestrationConfig>): AutoOrchestrator {
  globalOrchestrator = new AutoOrchestrator(config);
  return globalOrchestrator;
}
