# Wyrm + Copilot Skills Integration Guide

This guide shows how to leverage multi-agent orchestration and Haiku quality boosting with Wyrm's persistent memory and tracking systems.

## Quick Start: Register Skills

```bash
# Register multi-agent orchestration
wyrm skill register \
  --name "multi-agent-orchestration" \
  --description "Spawn multiple agents in parallel to accelerate complex work" \
  --path "/home/kami/.copilot/skills/multi-agent-orchestration" \
  --category "orchestration" \
  --tags "parallel,agents,ensemble,decomposition"

# Register Haiku quality booster
wyrm skill register \
  --name "haiku-opus-booster" \
  --description "Elevate Claude Haiku to Opus-level quality using few-shot prompting and multi-pass verification" \
  --path "/home/kami/.copilot/skills/haiku-opus-booster" \
  --category "ai-optimization" \
  --tags "haiku,quality,cost-optimization,few-shot,self-critique"
```

Verify registration:

```bash
wyrm skill list
wyrm skill get multi-agent-orchestration
wyrm skill get haiku-opus-booster
```

---

## Architecture: How They Work Together

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Wyrm Memory Platform                      │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐│
│  │   Skill Registry     │  │   Data Lake (Metrics)        ││
│  │                      │  │                              ││
│  │ • multi-agent        │  │ • Agent performance          ││
│  │ • haiku-opus-booster │  │ • Task distribution          ││
│  │ • professional-leads │  │ • Quality scores             ││
│  │ • [other skills]     │  │ • Cost tracking              ││
│  └──────────────────────┘  └──────────────────────────────┘│
│         ↑                           ↑                        │
│         │ discover skills           │ store metrics          │
│         │ check version             │ query results          │
│         │ track usage               │ aggregate data         │
└─────────────────────────────────────────────────────────────┘
         ↑                                          ↑
         │ invoke                                   │ track
         │ parallel                                 │ quality
         │ agents                                   │ monitor
         │                                          │
    ┌────┴──────────────────────────────────────────┴────┐
    │          Multi-Agent Orchestration (Skill)        │
    │                                                    │
    │  ┌────────┐  ┌────────┐  ┌────────┐  ┌─────────┐ │
    │  │ Agent A│  │ Agent B│  │ Agent C│  │ Agent D │ │
    │  │        │  │        │  │        │  │         │ │
    │  └────────┘  └────────┘  └────────┘  └─────────┘ │
    │     ↓          ↓          ↓          ↓            │
    │  [Ensemble/Vote or Task Decomposition Pattern]     │
    │     ↓          ↓          ↓          ↓            │
    │  ┌──────────────────────────────────────────┐     │
    │  │   Synthesis/Aggregation Agent            │     │
    │  │   (Merges results, resolves conflicts)   │     │
    │  └──────────────────────────────────────────┘     │
    │                    ↓
    └────────────────────┬─────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
    ┌─────┴────────┐          ┌────────┴─────┐
    │ Haiku Quality│          │  Output to   │
    │ Booster      │          │  Wyrm Data   │
    │ (Refine)     │          │  Lake        │
    └──────────────┘          └──────────────┘
```

### Integration Points

#### 1. **Capability Discovery** (Wyrm → Agents)
- Agent selection based on available skills
- Route complex tasks to specialized agents
- Cache skill metadata for fast lookup

```typescript
// In agent pool initialization
const availableSkills = wyrm_skill_list({ active: true });
const agentPool = availableSkills.map(skill => ({
  skill: skill.name,
  handler: loadSkillHandler(skill.skill_path),
  version: skill.version,
  tags: skill.tags
}));
```

#### 2. **Parallel Task Distribution** (Orchestration Skill → Wyrm)
- Each agent registered as a quest in Wyrm
- Track progress in real-time
- Store intermediate results in data lake

```typescript
// Register parallel agents as quests
const questIds = agents.map((agent, idx) =>
  wyrm_quest_add({
    projectPath: "/path/to/project",
    title: `[Agent ${idx}] ${agent.task}`,
    tags: "multi-agent,parallel",
    priority: "high"
  }).id
);

// Execute in parallel
const results = await Promise.all(agents.map(spawn));

// Mark complete
questIds.forEach(id => wyrm_quest_complete({ questId: id }));

// Store outcomes
wyrm_data_batch_insert({
  projectPath: "/path/to/project",
  data: results.map((r, i) => ({
    category: "agent-results",
    key: `agent-${i}`,
    value: r,
    metadata: { questId: questIds[i], quality_score: scoreResult(r) }
  }))
});
```

#### 3. **Quality Enhancement** (Haiku Booster → Pipeline)
- Apply boosting techniques before final output
- Self-critique and multi-pass refinement
- Store quality metrics for continuous improvement

```typescript
// After agent generates output
let output = agentResult;

// Apply Haiku boosting techniques
if (model === 'haiku') {
  // Few-shot examples
  output = await applyFewShotPrompting(output, examplesFromWyrm);
  
  // Self-critique refinement
  output = await applySelfCritique(output);
  
  // Verification
  const confidence = await scoreConfidence(output);
  
  // Store quality metrics
  wyrm_data_insert({
    projectPath: "/path/to/project",
    category: "quality-metrics",
    key: `${taskId}-haiku-final`,
    value: output,
    metadata: {
      boosting_techniques: ['few-shot', 'self-critique', 'verification'],
      confidence_score: confidence,
      cost_vs_opus: `Haiku: $0.10 vs Opus: $1.00`
    }
  });
}
```

#### 4. **Performance Monitoring** (Wyrm Data Lake)
- Track task completion time, quality scores, cost
- Compare Haiku vs Opus outcomes
- Optimize agent pool size and skill assignment

```typescript
// Query performance metrics
const metrics = wyrm_data_query({
  projectPath: "/path/to/project",
  category: "quality-metrics",
  filter: { created: { $gte: "7 days ago" } }
});

// Summarize
const summary = {
  tasks_completed: metrics.length,
  avg_completion_time: metrics.reduce((s,m) => s + m.time, 0) / metrics.length,
  avg_quality_score: metrics.reduce((s,m) => s + m.score, 0) / metrics.length,
  total_cost: metrics.reduce((s,m) => s + m.cost, 0),
  haiku_improvement: metrics
    .filter(m => m.model === 'haiku')
    .map(m => m.haiku_boost_impact)
    .reduce((s,i) => s + i, 0) / count
};
```

---

## Pattern 1: Ensemble Voting for Quality

Combines multi-agent orchestration with Haiku boosting for best-of-breed results.

### Procedure

```typescript
async function ensembleVoting(task: string, boost: boolean = true) {
  // 1. Define approaches
  const approaches = [
    { name: "detailed", prompt: "Provide comprehensive analysis covering..." },
    { name: "concise", prompt: "Summarize in 3-5 key points..." },
    { name: "skeptical", prompt: "Play devil's advocate. Find weaknesses..." },
    { name: "creative", prompt: "Think creatively. Suggest novel approaches..." }
  ];

  // 2. Spawn agents in parallel
  const results = await Promise.all(
    approaches.map(ap =>
      runSubagent({
        agentName: "Explore",
        prompt: ap.prompt + task,
        description: `Approach: ${ap.name}`
      })
    )
  );

  // 3. Boost Haiku results if enabled
  if (boost) {
    results.forEach((r, i) => {
      r.boosted = applyHaikuBoosting(r);
      r.confidence = scoreConfidence(r.boosted);
    });
  }

  // 4. Vote and aggregate
  const scores = results.map((r, i) => ({
    approach: approaches[i].name,
    result: r.boosted || r,
    quality_score: r.confidence || scoreQuality(r),
    voter_count: 0
  }));

  // 5. Store in Wyrm
  wyrm_data_insert({
    projectPath: "/path/to/project",
    category: "ensemble-results",
    key: `task-${taskId}`,
    value: {
      task,
      candidates: scores,
      winner: scores.sort((a, b) => b.quality_score - a.quality_score)[0],
      voting_summary: scores.slice(0, 2)
    },
    metadata: {
      pattern: "ensemble-voting",
      agents: 4,
      boost_enabled: boost,
      timestamp: new Date().toISOString()
    }
  });

  // 6. Return top result
  return scores[0].result;
}
```

### Example Use Case

```typescript
// Complex architectural decision
const decision = await ensembleVoting(
  "Design the authentication system architecture for a multi-tenant SaaS platform. " +
  "Consider security, scalability, compliance (OAuth2, SAML, OIDC), and integration " +
  "with existing systems.",
  boost: true
);

// Result: 4 different architecture approaches, voted on, best one boosted for quality
// Cost: ~4 Haiku calls (~$0.40) vs 1 Opus call ($1.00)
// Quality: Often exceeds single Opus call due to ensemble + boosting
```

---

## Pattern 2: Task Decomposition Pipeline

Break large tasks into parallel subtasks, each handled by specialized agents.

### Procedure

```typescript
async function taskDecomposition(bigTask: string) {
  // 1. Decompose
  const decomposition = await runSubagent({
    agentName: "Explore",
    prompt: `Break this into 4-6 independent subtasks that can be parallelized:
${bigTask}

Provide JSON array: [{task: "...", description: "..."}, ...]`,
    description: "Task decomposition"
  });

  const subtasks = JSON.parse(decomposition);

  // 2. Spawn agents in parallel
  const questIds = subtasks.map((st, i) =>
    wyrm_quest_add({
      projectPath: "/path/to/project",
      title: `[Subtask ${i}] ${st.task}`,
      description: st.description,
      tags: "decomposition,parallel"
    }).id
  );

  const results = await Promise.all(
    subtasks.map(st =>
      runSubagent({
        agentName: "Explore",
        prompt: st.task,
        description: st.description
      })
    )
  );

  // 3. Boost results (optional)
  const boostedResults = results.map(r => 
    applyHaikuBoosting(r, { technique: "few-shot", context: subtasks })
  );

  // 4. Synthesize (merge with conflict resolution)
  const final = await runSubagent({
    agentName: "Explore",
    prompt: `Merge these ${subtasks.length} parallel results into a cohesive final solution:
${JSON.stringify(boostedResults, null, 2)}

Handle any conflicts by prioritizing consistency and integration.`,
    description: "Synthesis"
  });

  // 5. Store pipeline
  wyrm_data_insert({
    projectPath: "/path/to/project",
    category: "decomposition-pipelines",
    key: `${bigTask.slice(0, 30)}-${Date.now()}`,
    value: {
      original_task: bigTask,
      subtasks: subtasks.map((st, i) => ({
        ...st,
        result: boostedResults[i],
        quest_id: questIds[i]
      })),
      final_result: final
    },
    metadata: {
      pattern: "task-decomposition",
      parallelization_factor: subtasks.length,
      total_cost: subtasks.length * 0.12 // estimate
    }
  });

  return final;
}
```

### Example Use Case

```typescript
// Build complete web app
const app = await taskDecomposition(`
  Build a complete REST API for a task management system with:
  - User authentication (JWT)
  - Database schema (PostgreSQL)
  - CRUD endpoints
  - Pagination and filtering
  - Error handling
  - Automated tests
  - Deployment documentation
`);

// Decomposed into: Auth system, DB schema, API endpoints, Tests, Docs
// All in parallel → Synthesized → Haiku boosted → Final app
// Cost: 7 Haiku calls (~$0.84) vs 1 Opus call ($1.00) - but better quality
```

---

## Pattern 3: Verification Pipeline

Generate → Review in parallel → Refine → Final verification

### Procedure

```typescript
async function verificationPipeline(task: string) {
  // 1. Initial generation
  const generated = await runSubagent({
    agentName: "Explore",
    prompt: task,
    description: "Generation"
  });

  // 2. Parallel reviews (different angles)
  const [securityReview, perfReview, readabilityReview] = await Promise.all([
    runSubagent({
      agentName: "Explore",
      prompt: `Security review of this code:\n${generated}`,
      description: "Security"
    }),
    runSubagent({
      agentName: "Explore",
      prompt: `Performance review of this code:\n${generated}`,
      description: "Performance"
    }),
    runSubagent({
      agentName: "Explore",
      prompt: `Readability review of this code:\n${generated}`,
      description: "Readability"
    })
  ]);

  // 3. Synthesis with refinement
  const refined = await runSubagent({
    agentName: "Explore",
    prompt: `Address these reviews:\n
Security: ${securityReview}
Performance: ${perfReview}
Readability: ${readabilityReview}

Refine the original code:\n${generated}`,
    description: "Refinement"
  });

  // 4. Final verification (self-critique)
  const final = await applyHaikuBoosting(refined, {
    technique: "self-critique",
    verificationSteps: [
      "Check for security vulnerabilities",
      "Verify performance optimizations applied",
      "Confirm code readability improved"
    ]
  });

  // 5. Store verification trail
  wyrm_data_insert({
    projectPath: "/path/to/project",
    category: "verification-pipelines",
    key: `${task.slice(0,30)}-${Date.now()}`,
    value: {
      original: generated,
      reviews: { securityReview, perfReview, readabilityReview },
      refined,
      final
    },
    metadata: {
      pattern: "verification-pipeline",
      review_count: 3,
      boost_applied: true,
      confidence_score: scoreConfidence(final)
    }
  });

  return final;
}
```

---

## Cost Analysis: Haiku vs Opus with Boosting

### Example: Architecture Design Task

| Approach | Cost | Quality | Time | Notes |
|----------|------|---------|------|-------|
| Single Opus | $1.00 | High | 30s | Baseline |
| Haiku (no boost) | $0.12 | Medium | 10s | Fast but lower quality |
| **Ensemble (4x Haiku + Boost)** | **$0.48** | **Very High** | **15s** | 80% cost savings, often better |
| **Decomposition (6x Haiku + Boost)** | **$0.72** | **Very High** | **20s** | 28% cost savings, superior results |

**Key Insight**: Multiple Haiku calls with boosting often surpass single Opus calls at a fraction of the cost.

---

## Monitoring & Optimization

### Track Agent Performance

```typescript
// Daily summary
const dailyMetrics = wyrm_data_query({
  projectPath: "/path/to/project",
  category: "agent-results",
  filter: { created: { $gte: "24h ago" } }
});

console.log({
  tasks: dailyMetrics.length,
  avg_quality: dailyMetrics.reduce((s,m) => s + m.quality_score, 0) / dailyMetrics.length,
  total_cost: dailyMetrics.reduce((s,m) => s + m.estimated_cost, 0),
  haiku_boost_impact: dailyMetrics
    .filter(m => m.boost_applied)
    .reduce((s,m) => s + m.quality_improvement, 0) / haiku_count
});
```

### Optimize Agent Pool

```typescript
// If ensemble voting consistently outperforms single Opus:
// → Use ensembles by default for high-stakes decisions

// If task decomposition shows <70% synthesis quality:
// → Add a synthesis specialist agent or increase review steps

// If Haiku boosting adds >20% quality without >50% time cost:
// → Make boosting mandatory for critical paths
```

---

## Next Steps

1. **Register Skills**: Run the registration commands above
2. **Test Patterns**: Try one pattern (e.g., ensemble voting) on a real task
3. **Monitor**: Check Wyrm data lake for quality and cost metrics
4. **Optimize**: Adjust agent count, boosting techniques, and pool size based on metrics
5. **Scale**: Integrate with your development workflow for all complex tasks

---

## Reference Links

- [Multi-Agent Orchestration Skill](../../.copilot/skills/multi-agent-orchestration/SKILL.md)
- [Haiku Quality Booster Skill](../../.copilot/skills/haiku-opus-booster/SKILL.md)
- [Wyrm Skill Management](./SKILL_MANAGEMENT.md)
- [Wyrm Data Lake Query Reference](./DATA_LAKE_REFERENCE.md)
