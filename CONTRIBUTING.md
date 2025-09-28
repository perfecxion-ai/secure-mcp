# Contributing to Secure MCP Server

Thank you for your interest in contributing! The **perfecXion.ai** team welcomes contributions from the community to help improve this enterprise-grade MCP implementation.

## Code of Conduct

Please be respectful and professional in all interactions.

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists
2. Use the bug report template
3. Include all relevant information
4. Be specific about reproduction steps

### Suggesting Features

1. Check existing feature requests
2. Use the feature request template
3. Explain the use case clearly
4. Consider implementation implications

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow existing code style
   - Add tests for new functionality
   - Update documentation as needed

4. **Test your changes**
   ```bash
   npm run test
   npm run lint
   npm run typecheck
   ```

5. **Commit with clear messages**
   ```bash
   git commit -m "feat: add new authentication method"
   ```

   Use conventional commits:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `test:` Tests
   - `chore:` Maintenance
   - `perf:` Performance
   - `refactor:` Refactoring

6. **Push and create PR**
   - Fill out the PR template
   - Link related issues
   - Ensure CI passes

## Development Setup

1. **Prerequisites**
   - Node.js 20+
   - Docker & Docker Compose
   - Git

2. **Local Setup**
   ```bash
   git clone https://github.com/perfecxion-ai/secure-mcp.git
   cd secure-mcp
   npm install
   npm run dev
   ```

3. **Testing**
   ```bash
   # Unit tests
   npm run test:unit

   # Integration tests
   npm run test:integration

   # All tests with coverage
   npm run test:coverage
   ```

## Code Standards

### TypeScript
- Use strict mode
- Provide type definitions
- Avoid `any` types
- Document complex types

### Security
- No hardcoded secrets
- Input validation on all endpoints
- Use parameterized queries
- Follow OWASP guidelines

### Testing
- Maintain >80% coverage
- Test edge cases
- Include security tests
- Performance testing for critical paths

### Documentation
- JSDoc for public APIs
- README updates for features
- Architecture decisions in docs/
- Keep CHANGELOG updated

## Review Process

1. Automated CI checks must pass
2. Code review by maintainer
3. Security review for sensitive changes
4. Performance review for critical paths

## Release Process

We follow semantic versioning (semver):
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

## Questions?

- Open a discussion on GitHub
- Check existing issues
- Review documentation

## License

By contributing, you agree that your contributions will be licensed under Apache 2.0.