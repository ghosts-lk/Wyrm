# 🐉 Wyrm Protocol // AI Operating Guidelines

```
╔═╗╦═╗╔═╗╔╦╗╔═╗╔═╗╔═╗╦  
╠═╝╠╦╝║ ║ ║ ║ ║║  ║ ║║  
╩  ╩╚═╚═╝ ╩ ╚═╝╚═╝╚═╝╩═╝
The Dragon's Code
```

> Operational guidelines for AI handlers working on this project.

---

## 🔥 Awakening the Wyrm

At the start of each session, read these files:

```
.wyrm/hoard.md       - Project knowledge
.wyrm/chronicles.md  - What was done before
.wyrm/quests.md      - What needs doing
.wyrm/protocol.md    - This file
```

Then check current status:
```bash
git log --oneline -5   # Recent commits
git status             # Uncommitted changes
```

---

## ⚔️ During Battle

### Code Standards
- [Add your project's coding standards here]
- [Language-specific conventions]
- [Testing requirements]

### Common Commands
```bash
# Add frequently used commands here
```

### Gotchas & Pitfalls
- [Known issues to watch for]
- [Things that commonly break]

---

## 🐲 Closing the Session

Before ending, always:

1. **Update the Chronicles**
   ```markdown
   ## Session: [today's date]
   ### Quests Completed
   - What was done
   ### Commits  
   - `hash` - message
   ```

2. **Update the Quests**
   - Mark completed items with `[x]`
   - Add new quests discovered
   - Move items between priority levels

3. **Update the Hoard** (if architecture changed)
   - New files or APIs
   - Changed credentials
   - New decisions (ADRs)

4. **Commit and Push**
   ```bash
   git add -A
   git commit -m "Description"
   git push origin main
   ```

---

## 🔐 Security Protocols

- Never commit production credentials
- Use environment variables for secrets
- Keep `.wyrm/hoard.md` credentials for LOCAL DEV ONLY
- Add sensitive files to `.gitignore`

---

*The protocol guides the dragon.* 🐉
