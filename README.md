# 🐉 Wyrm

```
██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗
██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║
██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║
██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║
╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║
 ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝
    Persistent AI Memory System
           ghosts-lk
```

> *"The ancient wyrm remembers all. What was spoken, what was built, what remains undone."*

## What is Wyrm?

**Wyrm** is a persistent memory system for AI-assisted development. It maintains context across chat sessions, so your AI assistant always knows:

- 📜 **What the project is** - Architecture, stack, key decisions
- 🔥 **What was done** - Session history with commits and changes  
- ⚔️ **What remains** - Prioritized mission queue
- 🐲 **How to operate** - Project-specific protocols

## Quick Start

### 1. Install Wyrm in Your Project

```bash
# Clone into your project
git clone https://github.com/ghosts-lk/Wyrm.git .wyrm

# Or add as submodule
git submodule add https://github.com/ghosts-lk/Wyrm.git .wyrm
```

### 2. Initialize Your Hoard

```bash
cd .wyrm
cp templates/hoard.template.md hoard.md
cp templates/chronicles.template.md chronicles.md
cp templates/quests.template.md quests.md
```

### 3. Summon the Wyrm

At the start of each AI session, say:

> "Read the .wyrm folder first"

Or include these files in your context:
- `.wyrm/hoard.md` - Project state
- `.wyrm/chronicles.md` - Session history
- `.wyrm/quests.md` - TODO list

## File Structure

```
.wyrm/
├── README.md           # This file
├── hoard.md            # 🐉 Project knowledge (the dragon's treasure)
├── chronicles.md       # 📜 Session history (tales of old)
├── quests.md           # ⚔️ Mission queue (battles to fight)
├── protocol.md         # 🔥 AI operating guidelines
└── templates/          # Empty templates for new projects
    ├── hoard.template.md
    ├── chronicles.template.md
    └── quests.template.md
```

## The Dragon's Hoard

Your `hoard.md` contains the knowledge the wyrm guards:

```markdown
# 🐉 Wyrm Hoard

## Project
- Name, stack, repo URLs

## Architecture  
- Key files, database, APIs

## Credentials
- Dev passwords, API keys (local only!)

## Decisions
- ADRs, why things are the way they are
```

## Chronicles

The `chronicles.md` records every session:

```markdown
## Session: 2026-02-04

### Quests Completed
- Fixed authentication bug
- Added rate limiting

### Commits
- `abc123` - Fix auth flow

### Files Changed
- src/auth.js
- config/security.js
```

## Why "Wyrm"?

In mythology, **wyrms** are ancient dragons - serpentine, wise, and immortal. They guard hoards of treasure accumulated over centuries.

Your AI's context is treasure. Without it, every session starts from zero. **Wyrm** ensures the dragon remembers.

## Example

See [examples/dragonscale/](examples/dragonscale/) for a real-world example from an active project.

## Part of Ghost Protocol

Wyrm is a [ghosts-lk](https://github.com/ghosts-lk) project.

```
👻 Ghost Protocol
├── DragonScale  - Restaurant ordering system
├── Wyrm         - AI memory system (you are here)
└── ...more to come
```

---

*The wyrm sleeps, but never forgets.* 🐉
