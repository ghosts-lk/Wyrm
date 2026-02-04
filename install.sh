#!/bin/bash

# 🐉 Wyrm Installation Script
# Adds Wyrm to your project

set -e

echo ""
echo "██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗"
echo "██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║"
echo "██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║"
echo "██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║"
echo "╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║"
echo " ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝"
echo "    Persistent AI Memory System"
echo ""

# Check if in a git repo
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    echo "   Run this from your project's root directory"
    exit 1
fi

# Create .wyrm directory
echo "🐉 Creating .wyrm directory..."
mkdir -p .wyrm

# Download templates
WYRM_REPO="https://raw.githubusercontent.com/ghosts-lk/Wyrm/main"

echo "📜 Downloading templates..."
curl -sL "$WYRM_REPO/templates/hoard.template.md" -o .wyrm/hoard.md
curl -sL "$WYRM_REPO/templates/chronicles.template.md" -o .wyrm/chronicles.md
curl -sL "$WYRM_REPO/templates/quests.template.md" -o .wyrm/quests.md
curl -sL "$WYRM_REPO/templates/protocol.template.md" -o .wyrm/protocol.md

# Get project name
PROJECT_NAME=$(basename $(pwd))
TODAY=$(date +%Y-%m-%d)

# Update hoard.md with project info
echo "🔥 Configuring hoard..."
sed -i "s/\[project-name\]/$PROJECT_NAME/g" .wyrm/hoard.md
sed -i "s/YYYY-MM-DD/$TODAY/g" .wyrm/hoard.md
sed -i "s/\[Project Name\]/$PROJECT_NAME/g" .wyrm/hoard.md
sed -i "s/\[repo-name\]/$PROJECT_NAME/g" .wyrm/hoard.md

echo ""
echo "✅ Wyrm installed successfully!"
echo ""
echo "📁 Created files:"
echo "   .wyrm/hoard.md      - Project knowledge"
echo "   .wyrm/chronicles.md - Session history"
echo "   .wyrm/quests.md     - Mission queue"
echo "   .wyrm/protocol.md   - AI guidelines"
echo ""
echo "🐲 Next steps:"
echo "   1. Edit .wyrm/hoard.md with your project details"
echo "   2. Add quests to .wyrm/quests.md"
echo ""
echo "🔄 For multi-project workspaces, use:"
echo "   wyrm-deploy /path/to/projects"
echo "   3. Tell your AI: 'Read the .wyrm folder first'"
echo ""
echo "The wyrm awakens. 🐉"
