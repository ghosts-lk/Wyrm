/**
 * Practical Example: Using Multi-Agent + Haiku Boosting with Wyrm
 * 
 * This demonstrates a real-world use case: 
 * - Complex project architecture decision
 * - Using ensemble voting for high-quality result
 * - Haiku cost optimization with quality guarantees
 * - Tracking outcomes in Wyrm data lake
 */

import { runSubagent } from './utils/subagent';
import { applyHaikuBoosting } from './utils/haiku-booster';
import { wyrm } from './utils/wyrm-client';

interface AgentResult {
  approach: string;
  content: string;
  boosted?: string;
  confidence?: number;
  timestamp: string;
}

interface EnsembleVotingResult {
  task: string;
  candidates: Array<{
    approach: string;
    content: string;
    quality_score: number;
  }>;
  winner: AgentResult;
  metadata: {
    pattern: 'ensemble-voting';
    agents: number;
    boost_enabled: boolean;
    estimated_cost: number;
    estimated_cost_vs_opus: string;
  };
}

/**
 * Example 1: Ensemble Voting for Architecture Decision
 * 
 * Use case: Need high-quality architecture decision for multi-tenant SaaS
 * Approach: Multiple agents generate different architectures, vote on best,
 *          boost with Haiku techniques for final polish
 * Cost: 4 Haiku (~$0.48) vs 1 Opus ($1.00) = 52% savings
 */
async function architectureDecisionEnsemble(
  projectPath: string
): Promise<EnsembleVotingResult> {
  const task = `
Design a complete REST API architecture for a multi-tenant SaaS task management platform.

Requirements:
- User authentication with JWT tokens
- Role-based access control (RBAC)
- PostgreSQL database design
- Horizontal scalability
- Real-time notifications
- Background job processing
- API rate limiting
- Full test coverage

Constraints:
- 100K+ monthly active users
- <200ms response time requirement
- 99.99% uptime SLA
- SOC2 compliance required

Design approach: Provide complete architecture including:
1. System design diagram (text representation)
2. Technology choices with justification
3. Database schema outline
4. API endpoint structure
5. Scaling strategy
6. Security considerations
7. Monitoring and alerting approach
`;

  // Define 4 different architectural approaches
  const approaches = [
    {
      name: 'enterprise-monolith',
      prompt: `You are an enterprise architect favoring proven, battle-tested patterns. Design using monolithic architecture with clear layering. ${task}`
    },
    {
      name: 'microservices-distributed',
      prompt: `You are a cloud-native architect. Design using microservices pattern with containerization and orchestration. ${task}`
    },
    {
      name: 'serverless-eventdriven',
      prompt: `You are a serverless specialist. Design using serverless functions and event-driven architecture. ${task}`
    },
    {
      name: 'pragmatic-hybrid',
      prompt: `You are a pragmatist. Design a hybrid approach balancing simplicity, scalability, and operational overhead. ${task}`
    }
  ];

  console.log('🚀 Starting Ensemble Voting for Architecture Decision\n');
  console.log(`Task: Design REST API architecture`);
  console.log(`Approaches: ${approaches.length}`);
  console.log(`Model: Claude Haiku (with boosting)`);
  console.log(`Estimated cost: $0.48 vs Opus: $1.00 (52% savings)\n`);

  // Step 1: Spawn all agents in parallel
  console.log('📡 Spawning parallel agents...');
  const results = await Promise.all(
    approaches.map((approach, idx) =>
      runSubagent({
        agentName: 'Explore',
        prompt: approach.prompt,
        description: `Architecture approach: ${approach.name}`
      }).then(content => ({
        approach: approach.name,
        content,
        timestamp: new Date().toISOString()
      }))
    )
  );

  console.log(`✅ All ${results.length} agents completed\n`);

  // Step 2: Register as Wyrm quests for tracking
  console.log('📝 Registering with Wyrm for tracking...');
  const questIds = await Promise.all(
    approaches.map((approach, idx) =>
      wyrm.questAdd(projectPath, {
        title: `[Architecture] ${approach.name}`,
        description: `Approach: ${approach.name} for REST API design`,
        priority: 'high',
        tags: ['architecture', 'ensemble', 'parallel', `approach-${approach.name}`]
      }).then(quest => quest.id)
    )
  );
  console.log(`✅ Registered ${questIds.length} quests\n`);

  // Step 3: Apply Haiku boosting to results
  console.log('🚀 Applying Haiku quality boosting...');
  const boostedResults = await Promise.all(
    results.map(async (result) => {
      const boosted = await applyHaikuBoosting(result.content, {
        techniques: ['few-shot', 'structured-output', 'self-critique'],
        context: {
          domain: 'software-architecture',
          complexity_level: 'expert',
          quality_threshold: 'high'
        }
      });

      const confidence = await scoreConfidence(boosted);
      
      return {
        ...result,
        boosted,
        confidence
      };
    })
  );

  console.log('✅ All results boosted\n');

  // Step 4: Score and vote
  console.log('🗳️ Voting and aggregation...');
  const candidates = boostedResults.map((r, idx) => ({
    approach: r.approach,
    content: r.boosted || r.content,
    quality_score: r.confidence || 0.85,
    original_quest_id: questIds[idx]
  }));

  const sorted = candidates.sort((a, b) => b.quality_score - a.quality_score);
  const winner = sorted[0];

  console.log(`\n🏆 Winner: ${winner.approach} (confidence: ${(winner.quality_score * 100).toFixed(1)}%)\n`);
  console.log('Top 3 candidates:');
  sorted.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.approach}: ${(c.quality_score * 100).toFixed(1)}%`);
  });

  // Step 5: Store comprehensive results in Wyrm data lake
  console.log('\n💾 Storing results in Wyrm data lake...');
  
  const dataKey = `architecture-ensemble-${Date.now()}`;
  await wyrm.dataInsert(projectPath, {
    category: 'architecture-decisions',
    key: dataKey,
    value: {
      task_summary: 'Multi-tenant SaaS REST API Architecture',
      approaches: approaches.map(a => a.name),
      winner: winner.approach,
      winner_content: winner.content,
      all_candidates: candidates.map(c => ({
        approach: c.approach,
        quality_score: c.quality_score,
        summary: c.content.slice(0, 200) + '...'
      })),
      voting_results: sorted
    },
    metadata: {
      pattern: 'ensemble-voting',
      agents_spawned: approaches.length,
      boost_enabled: true,
      boost_techniques: ['few-shot', 'structured-output', 'self-critique'],
      confidence_score: winner.quality_score,
      estimated_cost_haiku: '$0.48',
      estimated_cost_opus: '$1.00',
      savings_percent: 52,
      quality_metrics: {
        average_candidate_quality: candidates.reduce((s, c) => s + c.quality_score, 0) / candidates.length,
        best_candidate_quality: winner.quality_score,
        ensemble_benefit: 'Multiple perspectives + boosting provides superior insights'
      }
    }
  });

  // Step 6: Mark quests complete
  for (const questId of questIds) {
    await wyrm.questComplete(questId);
  }

  console.log(`✅ Results stored with key: ${dataKey}\n`);

  return {
    task: 'Multi-tenant SaaS REST API Architecture',
    candidates,
    winner: {
      approach: winner.approach,
      content: winner.content,
      confidence: winner.quality_score,
      timestamp: new Date().toISOString()
    },
    metadata: {
      pattern: 'ensemble-voting',
      agents: approaches.length,
      boost_enabled: true,
      estimated_cost: 0.48,
      estimated_cost_vs_opus: '52% savings ($0.48 vs $1.00)'
    }
  };
}

/**
 * Example 2: Task Decomposition for Large Feature Implementation
 * 
 * Use case: Building a complete feature (e.g., user onboarding flow)
 * Approach: Break into subtasks (auth, DB schema, API, UI, tests)
 *          parallelize, then synthesize into final implementation
 * Cost: 6 Haiku + synthesis (~$0.72) vs 1 Opus ($1.00) = 28% savings
 */
async function featureImplementationDecomposition(
  projectPath: string,
  featureDescription: string
): Promise<any> {
  console.log('\n🏗️ Task Decomposition: Large Feature Implementation\n');

  // Step 1: Initial decomposition
  console.log('📋 Analyzing feature for decomposition...');
  
  const decompositionPrompt = `Analyze this feature and break it into 4-6 independent subtasks that can be developed in parallel:

Feature: ${featureDescription}

Return JSON array with exactly this structure:
[
  {
    "task": "Brief task name",
    "description": "Detailed description of what to implement",
    "dependencies": ["other-task-id"],
    "estimated_complexity": "low|medium|high"
  }
]

Tasks should be independent so they can be developed in parallel.`;

  const decomposition = await runSubagent({
    agentName: 'Explore',
    prompt: decompositionPrompt,
    description: 'Feature decomposition'
  });

  let subtasks;
  try {
    subtasks = JSON.parse(decomposition);
  } catch {
    console.error('Failed to parse decomposition, using default');
    subtasks = [
      { task: 'api-endpoints', description: 'Implement API endpoints', dependencies: [], estimated_complexity: 'medium' },
      { task: 'database', description: 'Design database schema', dependencies: [], estimated_complexity: 'medium' },
      { task: 'business-logic', description: 'Implement business logic', dependencies: ['api-endpoints', 'database'], estimated_complexity: 'high' },
      { task: 'frontend-ui', description: 'Build frontend UI', dependencies: [], estimated_complexity: 'medium' },
      { task: 'tests', description: 'Write comprehensive tests', dependencies: ['api-endpoints', 'business-logic'], estimated_complexity: 'high' }
    ];
  }

  console.log(`✅ Decomposed into ${subtasks.length} subtasks\n`);
  subtasks.forEach((st, i) => {
    console.log(`  ${i + 1}. ${st.task} [${st.estimated_complexity}]`);
  });

  // Step 2: Register quests and execute in parallel
  console.log('\n📡 Spawning parallel implementation agents...');

  const questIds = await Promise.all(
    subtasks.map((st, idx) =>
      wyrm.questAdd(projectPath, {
        title: `[Subtask] ${st.task}`,
        description: st.description,
        priority: 'high',
        tags: ['subtask', 'decomposition', `complexity-${st.estimated_complexity}`]
      }).then(quest => quest.id)
    )
  );

  const results = await Promise.all(
    subtasks.map((st, idx) =>
      runSubagent({
        agentName: 'Explore',
        prompt: st.description,
        description: `Implementation: ${st.task}`
      }).then(content => ({
        task: st.task,
        content,
        quest_id: questIds[idx]
      }))
    )
  );

  console.log(`✅ All ${subtasks.length} subtasks completed\n`);

  // Step 3: Boost results
  console.log('🚀 Boosting code quality...');
  const boostedResults = await Promise.all(
    results.map(async (r) => ({
      ...r,
      boosted: await applyHaikuBoosting(r.content, {
        techniques: ['few-shot', 'self-critique'],
        context: { domain: 'code-implementation', task_type: 'feature' }
      })
    }))
  );

  // Step 4: Synthesize
  console.log('🔗 Synthesizing into cohesive implementation...');
  
  const synthesisPrompt = `Merge these ${boostedResults.length} subtask implementations into a single, cohesive feature implementation.

Subtasks:
${boostedResults.map(r => `
## ${r.task}
${r.boosted || r.content}
`).join('\n')}

Instructions:
1. Ensure consistency across all subtasks
2. Resolve any conflicts in naming, data structures, or APIs
3. Add integration points between components
4. Ensure all dependencies are respected
5. Provide final, merged implementation ready for deployment`;

  const final = await runSubagent({
    agentName: 'Explore',
    prompt: synthesisPrompt,
    description: 'Feature synthesis'
  });

  console.log('✅ Synthesis complete\n');

  // Step 5: Store in Wyrm
  console.log('💾 Storing decomposition pipeline...');
  await wyrm.dataInsert(projectPath, {
    category: 'feature-implementations',
    key: `${featureDescription.slice(0, 30).replace(/\s/g, '-')}-${Date.now()}`,
    value: {
      feature: featureDescription,
      decomposition: subtasks,
      subtask_results: boostedResults.map(r => ({
        task: r.task,
        quest_id: r.quest_id,
        implementation_summary: r.content.slice(0, 300)
      })),
      final_implementation: final
    },
    metadata: {
      pattern: 'task-decomposition',
      subtask_count: subtasks.length,
      boost_enabled: true,
      estimated_cost_haiku: `$${(subtasks.length * 0.12).toFixed(2)}`,
      estimated_cost_opus: '$1.00',
      cost_comparison: `${Math.round((1 - (subtasks.length * 0.12)) * 100)}% savings`,
      completion_time_estimate: `${subtasks.length * 15}s`
    }
  });

  // Mark all quests complete
  for (const questId of questIds) {
    await wyrm.questComplete(questId);
  }

  console.log('✅ Pipeline stored in Wyrm data lake\n');

  return {
    pattern: 'task-decomposition',
    feature: featureDescription,
    subtask_count: subtasks.length,
    final_implementation: final
  };
}

/**
 * Helper: Score confidence of an output
 */
async function scoreConfidence(content: string): Promise<number> {
  // Simple heuristic: length, structure, detail indicate confidence
  const length = content.length;
  const hasStructure = /^#+\s|^>\s|^-\s|^\d+\./m.test(content);
  const hasExamples = /```|example|demo|showcase/i.test(content);
  const hasJustification = /because|reason|rationale|justif|since/i.test(content);
  
  let score = 0.7; // Base score
  if (length > 1000) score += 0.1;
  if (hasStructure) score += 0.08;
  if (hasExamples) score += 0.08;
  if (hasJustification) score += 0.04;
  
  return Math.min(score, 1.0);
}

// Export for use in workflows
export {
  architectureDecisionEnsemble,
  featureImplementationDecomposition
};

// CLI: Run example
if (require.main === module) {
  const projectPath = process.argv[2] || '/home/kami/Git Projects/demo-project';
  
  architectureDecisionEnsemble(projectPath)
    .then(result => {
      console.log('\n✨ Architecture ensemble complete!');
      console.log(`Winner: ${result.winner.approach}`);
      console.log(`Confidence: ${(result.winner.confidence * 100).toFixed(1)}%`);
      console.log(`Cost savings: ${result.metadata.estimated_cost_vs_opus}`);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
