# 🐉 Wyrm GitHub Actions Status

This document tracks the GitHub Actions workflows and CI/CD pipeline for Wyrm.

## Workflow Overview

| Workflow | Status | Trigger | Purpose |
|----------|--------|---------|---------|
| CI | ![CI](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/CI/badge.svg) | Push, PR | Build, test, lint |
| Release | ![Release](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/Release/badge.svg) | Tags (v*.*.*) | Create releases, Docker |
| Security | ![Security](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/Security/badge.svg) | Weekly, Push | Security scans |
| Documentation | ![Docs](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/Documentation/badge.svg) | Push (docs) | Build docs site |
| Performance | ![Performance](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/Performance/badge.svg) | Weekly | Benchmarks |
| Integration | ![Integration](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/workflows/Integration/badge.svg) | Daily, Push | End-to-end tests |

## Workflow Details

### 1. CI Workflow (ci.yml)

**Triggers:**
- Push to `main` or `dev` branches
- Pull requests to `main` or `dev`

**Jobs:**
- **build-and-test**: Builds on Node.js 18.x, 20.x, 22.x
- **vscode-extension**: Builds VS Code extension
- **security**: Runs npm audit on all packages
- **install-script**: Tests install.sh script
- **build-status**: Summary of all build results

**Artifacts:**
- Build output (`wyrm-dist`) - 7 day retention

---

### 2. Release Workflow (release.yml)

**Triggers:**
- Git tags matching `v*.*.*` pattern

**Jobs:**
- **build**: Creates release packages (tar.gz, zip)
- **create-release**: Publishes GitHub release with:
  - Auto-generated changelog
  - Installation instructions
  - Release notes
- **docker**: Builds and pushes Docker image to `ghcr.io`
- **notify**: Sends release notification

**Outputs:**
- GitHub Release with archives
- Docker image: `ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest`
- Docker image: `ghcr.io/ghosts-protocol-pvt-ltd/wyrm:VERSION`

---

### 3. Security Workflow (security.yml)

**Triggers:**
- Weekly schedule (Mondays at 9:00 UTC)
- Push to `main`
- Pull requests to `main`

**Jobs:**
- **dependency-review**: Reviews dependency changes in PRs
- **codeql**: GitHub CodeQL security analysis
- **audit**: npm security audit for all packages
- **license-compliance**: Checks open source licenses

**Artifacts:**
- Security audit reports (30 day retention)
- License compliance reports (30 day retention)

---

### 4. Documentation Workflow (docs.yml)

**Triggers:**
- Push to `main` (docs changes)
- Manual dispatch

**Jobs:**
- **build-docs**: Generates TypeDoc API documentation
- **validate-readme**: Validates README links and code examples

**Outputs:**
- Deploys to GitHub Pages: `wyrm.ghosts.lk`

---

### 5. Performance Workflow (performance.yml)

**Triggers:**
- Push to `main` or `dev`
- Pull requests to `main`
- Weekly schedule (Sundays at 3:00 UTC)

**Jobs:**
- **benchmark**: Runs performance benchmarks
  - 1,000 SQLite inserts
  - 100 queries
  - FTS5 operations
- **load-test**: Tests with 10,000 records
  - Bulk insert performance
  - Query performance on large dataset
  - Full-text search on large dataset

**Metrics Tracked:**
- Insert speed (ms per operation)
- Query latency
- FTS search performance
- Memory usage

---

### 6. Integration Tests Workflow (integration.yml)

**Triggers:**
- Push to `main` or `dev`
- Pull requests to `main`
- Daily schedule (6:00 UTC)

**Jobs:**
- **mcp-integration**: Tests MCP protocol
  - Server startup
  - HTTP endpoints
  - Health checks
- **sqlite-integration**: Tests database operations
  - Table creation
  - CRUD operations
  - Full-text search
- **cross-platform**: Tests on Ubuntu, macOS, Windows
  - Multiple Node.js versions
  - CLI binary functionality
- **install-deployment**: Tests installation
  - Individual project install
  - Workspace scanning
  - Template deployment

---

## Docker Integration

### Build
```bash
docker build -t wyrm:latest .
```

### Run
```bash
docker run -p 3333:3333 -v wyrm-data:/data ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest
```

### Image Details
- **Base**: node:20-alpine
- **Size**: ~50MB (optimized multi-stage build)
- **Health Check**: Automatic HTTP endpoint monitoring
- **User**: Non-root (node)
- **Data**: Persistent volume at `/data`

---

## Status Tracking

### Build Health
Monitor build status at:
- [CI Dashboard](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/actions/workflows/ci.yml)
- [Security Dashboard](https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm/actions/workflows/security.yml)

### Performance Trends
Track performance over time:
- Weekly benchmark results
- Load test metrics
- Memory usage patterns

### Security Status
- **CodeQL**: Automated code scanning
- **Dependency Review**: PR-based dependency checks
- **License Compliance**: Weekly license audits

---

## Release Process

### Automated Release Steps

1. **Create Tag**:
   ```bash
   git tag -a v3.0.1 -m "Release v3.0.1"
   git push origin v3.0.1
   ```

2. **GitHub Actions Automatically**:
   - Builds all packages
   - Runs full test suite
   - Creates release archives
   - Publishes GitHub release
   - Builds Docker image
   - Pushes to container registry

3. **Manual Steps**:
   - Verify release on GitHub
   - Update documentation if needed
   - Announce release

### Release Checklist

- [ ] All CI tests passing
- [ ] Security audit clean
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Tag created and pushed
- [ ] Release verified on GitHub
- [ ] Docker image tested
- [ ] NPM package published (if applicable)

---

## Monitoring

### Workflow Run Times
Typical execution times:
- CI: ~3-5 minutes
- Release: ~5-10 minutes
- Security: ~10-15 minutes
- Integration: ~8-12 minutes
- Performance: ~2-3 minutes

### Resource Usage
- Storage: ~500MB artifacts (7-30 day retention)
- Compute: ~20-30 minutes/week baseline
- Network: Minimal (cached dependencies)

---

## Troubleshooting

### Common Issues

**Build Failures**
- Check Node.js version compatibility
- Clear npm cache: `npm cache clean --force`
- Verify dependencies: `npm ci`

**Docker Build Issues**
- Check Dockerfile syntax
- Verify multi-stage build
- Test locally before pushing

**Security Alerts**
- Review npm audit report
- Update dependencies: `npm update`
- Check CodeQL findings

**Test Failures**
- Review test logs in Actions
- Run tests locally: `npm test`
- Check environment variables

---

## Future Enhancements

### Planned Workflows
- [ ] Nightly builds
- [ ] Canary releases
- [ ] A/B testing automation
- [ ] Automated changelog generation
- [ ] Slack/Discord notifications
- [ ] Performance regression detection

### Metrics to Add
- [ ] Code coverage tracking
- [ ] Bundle size monitoring
- [ ] API response time tracking
- [ ] User adoption metrics

---

## Contributing

When adding new workflows:
1. Create workflow file in `.github/workflows/`
2. Test locally with [act](https://github.com/nektos/act)
3. Document in this file
4. Add status badge to README.md
5. Update monitoring dashboard

---

**Last Updated**: 2026-02-05  
**Maintained By**: Ghost Protocol DevOps Team  
**Contact**: legal@ghosts.lk
