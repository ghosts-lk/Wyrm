#!/usr/bin/env ts-node
/**
 * Register Professional Skills with Wyrm
 * 
 * This script registers high-value skills in the Wyrm system for:
 * - Discovery and reuse across projects
 * - Tracking usage and effectiveness
 * - Caching metadata for fast lookup in agent selection
 */

import Database from 'better-sqlite3';
import path from 'path';

interface SkillRegistration {
  name: string;
  description: string;
  skillPath: string;
  category: string;
  author: string;
  version: string;
  tags: string[];
}

const skills: SkillRegistration[] = [
  {
    name: 'professional-lead-scraping',
    description: 'Extract professional leads (names, emails, phone numbers, company data) from multiple sources including LinkedIn, company websites, B2B databases with compliance safeguards.',
    skillPath: '/home/kami/.copilot/skills/professional-lead-scraping',
    category: 'data-extraction',
    author: 'Kami (Internal)',
    version: '1.0.0',
    tags: ['lead-generation', 'scraping', 'compliance', 'gdpr', 'ccpa', 'data-enrichment']
  },
  {
    name: 'multi-agent-orchestration',
    description: 'Spawn multiple agents in parallel to accelerate complex work. Supports task decomposition, ensemble methods, handoff pipelines, and distributed research.',
    skillPath: '/home/kami/.copilot/skills/multi-agent-orchestration',
    category: 'orchestration',
    author: 'Kami (Internal)',
    version: '1.0.0',
    tags: ['parallel', 'agents', 'ensemble', 'decomposition', 'workflow', 'performance']
  },
  {
    name: 'haiku-opus-booster',
    description: 'Elevate Claude Haiku to Opus-level quality using few-shot prompting, chain-of-thought reasoning, self-critique, and multi-pass verification. Cost-effective alternative to Opus.',
    skillPath: '/home/kami/.copilot/skills/haiku-opus-booster',
    category: 'ai-optimization',
    author: 'Kami (Internal)',
    version: '1.0.0',
    tags: ['haiku', 'quality', 'cost-optimization', 'few-shot', 'self-critique', 'prompt-engineering']
  }
];

function registerSkills(dbPath: string) {
  try {
    const db = new Database(dbPath);
    
    console.log('📚 Registering skills with Wyrm...\n');

    for (const skill of skills) {
      try {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO skills (
            name, description, skill_path, category, author, version, tags, is_active, usage_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          skill.name,
          skill.description,
          skill.skillPath,
          skill.category,
          skill.author,
          skill.version,
          JSON.stringify(skill.tags),
          1, // is_active
          0, // usage_count
          new Date().toISOString(),
          new Date().toISOString()
        );

        console.log(`✅ Registered: ${skill.name}`);
        console.log(`   Category: ${skill.category}`);
        console.log(`   Tags: ${skill.tags.join(', ')}`);
        console.log('');
      } catch (error) {
        console.error(`❌ Failed to register ${skill.name}:`, error);
      }
    }

    // Verify registration
    console.log('\n📊 Verification:\n');
    const allSkills = db.prepare(`
      SELECT name, category, version, usage_count, is_active FROM skills 
      WHERE name IN (?, ?, ?)
      ORDER BY category, name
    `).all(
      'professional-lead-scraping',
      'multi-agent-orchestration',
      'haiku-opus-booster'
    );

    console.log(`Total registered skills: ${allSkills.length}`);
    allSkills.forEach(skill => {
      console.log(`  - ${skill.name} (v${skill.version}) [${skill.category}] - ${skill.is_active ? '🟢 active' : '🔴 inactive'}`);
    });

    console.log('\n✨ Skill registration complete!');
    console.log('\nTo use these skills:');
    console.log('  1. Load in your agent workflow: wyrm_skill_get("multi-agent-orchestration")');
    console.log('  2. Invoke via skill path: loadSkillHandler(skill.skill_path)');
    console.log('  3. Track usage: Wyrm auto-increments usage_count on each use');
    console.log('\nQuery all skills:');
    console.log('  wyrm_skill_list()');
    console.log('  wyrm_skill_search("parallel") - Find by keyword');

    db.close();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Get database path from environment or use default
const dbPath = process.env.WYRM_DB || path.join(process.env.HOME || '', '.wyrm', 'wyrm.db');

// Ensure DB exists
try {
  registerSkills(dbPath);
} catch (error) {
  console.error('❌ Error:', error);
  console.log('\nMake sure Wyrm is initialized. Run:');
  console.log('  cd packages/mcp-server');
  console.log('  npm run build');
  process.exit(1);
}
