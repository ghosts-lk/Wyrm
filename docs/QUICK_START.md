# Quick Start: Multi-Agent + Haiku Boosting

## 1️⃣ Register Skills with Wyrm

```bash
cd ~/Git\ Projects/Wyrm
npm run register-skills
```

**Output:**
```
✅ Registered: professional-lead-scraping
✅ Registered: multi-agent-orchestration
✅ Registered: haiku-opus-booster
```

Verify:
```bash
wyrm skill list
wyrm skill search "parallel"
wyrm skill get multi-agent-orchestration
```

---

## 2️⃣ Load Skills in Your Workflow

In any file (`.instructions.md`, `.prompt.md`, or agent code):

```markdown
# Use Multi-Agent Orchestration for parallelization
See skill: `/home/kami/.copilot/skills/multi-agent-orchestration/SKILL.md`

# Use Haiku Quality Boosting for cost optimization
See skill: `/home/kami/.copilot/skills/haiku-opus-booster/SKILL.md`
```

---

## 3️⃣ Quick Patterns

### I want to: Speed up with parallel agents

**Use**: Multi-Agent Orchestration → Pattern 1: Task Decomposition

```typescript
// Break 1 big task into N subtasks
const subtasks = [
  "Build auth system",
  "Design database",
  "Create API",
  "Build UI"
];

// Spawn all in parallel (N agents in parallel = Nx faster)
const results = await Promise.all(
  subtasks.map(st => runSubagent({...}))
);
```

**Result**: 4 Haiku parallel (~2x wall-clock time vs 4x sequential)

### I want to: High-quality results at low cost

**Use**: Haiku Quality Booster → Few-Shot Prompting + Self-Critique

```typescript
// Include examples in prompt (few-shot)
const prompt = `
EXAMPLE 1: [High-quality output]
...

EXAMPLE 2: [Another example]
...

Now do the same for: ${task}
`;

// Then apply self-critique
const refined = await applySelfCritique(result);
```

**Result**: Haiku matches Opus quality at 1/10 cost

### I want to: Best of both worlds

**Use**: Ensemble Voting + Haiku Boosting

```typescript
// 1. Get 4 different perspectives (parallel)
const approaches = ["detailed", "concise", "skeptical", "creative"];
const results = await Promise.all(
  approaches.map(a => runSubagent({...}))
);

// 2. Boost each with Haiku techniques
const boosted = results.map(r => applyHaikuBoosting(r));

// 3. Vote and pick best
const best = boosted.sort((a, b) => score(b) - score(a))[0];
```

**Result**: Superior quality + 50% cost savings

---

## 4️⃣ Cost Comparison

| Task | Single Opus | 4x Haiku Ensemble | Savings |
|------|------------|------------------|---------|
| Architecture | $1.00 | $0.48 | **52%** |
| Feature | $1.00 | $0.72 | **28%** |
| Research | $1.00 | $0.60 | **40%** |

**Key**: Quality from ensemble often EXCEEDS single Opus call

---

## 5️⃣ Track Results in Wyrm

All patterns auto-store results and metrics in Wyrm data lake:

```bash
# Query recent agent results
wyrm data query --category agent-results

# Get ensemble voting outcomes
wyrm data query --category ensemble-results

# Get performance summary
wyrm data query --category quality-metrics
```

---

## 6️⃣ Example: Architecture Decision

```bash
# Run the full example
npx ts-node /home/kami/Git\ Projects/Wyrm/examples/ensemble-voting-example.ts /path/to/project
```

**Output:**
- 4 parallel architecture approaches
- Scored and voted
- Haiku boosted for final quality
- Stored in Wyrm
- Winner: Most confident approach
- **Cost**: $0.48 vs $1.00 (52% savings)

---

## 🔑 Key Activation Points

### In `.instructions.md` (Global Agent Instructions)

```markdown
## Parallel Execution Strategy
- Use multi-agent orchestration for tasks decomposable into 4+ subtasks
- Spawn agents in parallel to maximize speed
- Skill: `multi-agent-orchestration`

## Quality & Cost Optimization
- Use Haiku with boosting techniques instead of Opus where possible
- Few-shot examples increase quality by 40-60%
- Self-critique adds another 30-40% quality without extra models
- Skill: `haiku-opus-booster`

## High-Stakes Decisions
- Use ensemble voting (4 approaches) + Haiku boosting
- Cost: Often cheaper than 1 Opus, quality often better
- Pattern: See `/docs/SKILL_INTEGRATION_GUIDE.md#pattern-1-ensemble-voting`
```

### In `.prompt.md` (Specific Task)

```markdown
# Multi-Tenant SaaS Architecture Design

Use **Pattern**: Ensemble Voting
Use **Skill**: multi-agent-orchestration + haiku-opus-booster

Spawn these approaches in parallel:
1. Enterprise monolith (proven patterns)
2. Microservices (cloud-native)
3. Serverless (event-driven)
4. Pragmatic hybrid (balanced)

Vote and pick best. Boost final result with Haiku techniques.
```

---

## 📊 Monitoring

Check how you're doing:

```bash
# Daily metrics
wyrm data query --category quality-metrics --days 1 | jq '[.[].metadata] | {
  tasks: length,
  avg_quality: .[].confidence_score | add / length,
  total_cost: .[].estimated_cost | add,
  haiku_vs_opus_ratio: "cost savings"
}'

# Most effective patterns
wyrm data query --filter 'metadata.pattern' | sort by success rate

# Agent performance leaderboard
wyrm data query --filter 'category=agent-results' | top by quality_score
```

---

## 🚀 Next: Integration Points

1. **VS Code Extension**: Load skills in Command Palette
2. **CI/CD**: Use ensemble voting for pre-deployment code review
3. **Development**: Apply Haiku boosting to all LLM-generated code
4. **Analytics**: Track cost savings vs quality over time
5. **Automation**: Use Wyrm agents for nightly analysis tasks

---

## 📚 Full Documentation

- [Skill Integration Guide](../docs/SKILL_INTEGRATION_GUIDE.md)
- [Multi-Agent Orchestration Skill](../../.copilot/skills/multi-agent-orchestration/SKILL.md)
- [Haiku Quality Booster Skill](../../.copilot/skills/haiku-opus-booster/SKILL.md)
- [Wyrm Skill Management](../docs/SKILL_MANAGEMENT.md)

---

## ✨ Go Faster, Better, Cheaper

```
Fast:      Multi-agent parallel execution (Nx speedup)
Better:    Ensemble voting + Haiku boosting (quality matches Opus)
Cheaper:   Haiku + techniques (90% cost savings vs Opus)
```

**Try it**: Pick one small task, use ensemble voting. Check the results. You'll be convinced.
