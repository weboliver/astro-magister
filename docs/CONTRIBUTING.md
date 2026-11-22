<!-- Dies ist die öffentliche Variante dieser Datei für den Spiegel (astro-magister).
     Die private Fassung liegt im Entwicklungs-Repository; Abweichungen betreffen
     ausschließlich Verweise auf private Arbeits-, Test- und Agentendokumente.
     Die Regeln zu Aufbau, Ton, Lizenz und PR-Weg sind inhaltlich identisch. -->
# Contributing

Thank you for considering contributing to Astronex! This project is dual-licensed under AGPL-3.0 (core) and MIT (integration), and we welcome contributions from the community.

## Getting Started

1. **Fork the repository** and create a new branch from `master`:
   ```bash
   git checkout -b feat/<feature-name>
   ```

2. **Set up your local development environment** following the [Getting Started](GETTING-STARTED.md) guide.

3. **Read the [Architecture](ARCHITECTURE.md) overview** for the system layout and data flow, and keep the [Configuration](CONFIGURATION.md) reference at hand when changing behavior.

## Development Workflow

### Branch per Feature

- Always work on a dedicated branch: `feat/<feature>` or `fix/<bug-description>`
- Never commit directly to `master` — the branch is protected
- Keep each change focused; the maintainer reviews every pull request

### Commit Message Guidelines

- Use present tense: "Add feature" not "Added feature"
- Reference issues: `Closes #123`
- Keep body wrapped at 72 characters
- See [Conventional Commits](https://conventionalcommits.org/) for more structure

### Code Review

- All changes require a pull request (PR)
- The project maintainer will review and merge
- Keep the change inside the product tree; the development and test tooling live in the private repository this tree is mirrored from

## Pull Request Process

1. **Verify your change** before opening a PR: run the affected endpoint or page by hand and note
   in the description what you checked. The automated test suite lives in the private repository
   this tree is mirrored from; this tree does not contain it.

2. **Update documentation** if your change adds or modifies features:
   - Update `README.md` if API endpoints or commands change
   - Add or update `docs/` files as needed

3. **Fill the PR template** with:
   - Clear description of the change
   - Motivation and context
   - Types of changes (feat, fix, docs, refactor, etc.)
   - Testing approach
   - Screenshots (if UI changes)

4. **Address feedback** from reviewers promptly

5. **Squash commits** if requested (keep single logical change per PR)

## Coding Standards

### Python

- Follow [PEP 8](https://pep8.org/) — use `black` and `isort` for formatting
- Add type hints to all public function signatures
- Docstrings in Google style for public APIs
- Maximum line length: 88 characters

### JavaScript/TypeScript (Frontend)

- Match the style of the existing components in `app/frontend/src/`
- Use Prettier conventions for formatting
- Add PropTypes or TypeScript types to components
- Accessibility: ensure alt text, focus management, keyboard navigation

### Shell/Bash

- Use `#!/usr/bin/env bash` shebang
- Quote variable expansions
- Use `set -euo pipefail` for non-interactive scripts

## License Contributions

Astronex is dual-licensed:

- **Core**: AGPL-3.0 (`LICENSE`)
- **Integration**: MIT (`LICENSE_ASTRONEX`)
- **Swiss Ephemeris**: AGPL-3.0 (`LICENSE_SWISS_EPHE`)

All contributions must be compatible with these licenses. By submitting a PR, you agree that your contributions are dual-licensed under the same terms.

### License compatibility

- New code you add is dual-licensed under AGPL-3.0 and MIT
- Do not add code with incompatible licenses (e.g., GPL-only, proprietary)
- Third-party libraries must be compatible with dual AGPL-3.0 / MIT

## Reporting Issues

1. Search existing issues before creating a new one
2. Use clear, descriptive titles
3. Include reproduction steps for bugs
4. Specify environment (OS, Python version, DEBUG mode)
5. Include relevant logs or error messages

## Communication

- **Issues**: GitHub Issues for bugs and feature requests
- **Discussions**: GitHub Discussions for questions and general chat

## Recognition

Contributors who make significant contributions will be acknowledged in the `LICENSE_ASTRONEX` file and release notes. Major contributors may be granted commit access.

## Good First Issues

Look for issues labeled `good first issue` or `good first contribution` in the GitHub repository. These are typically smaller bug fixes or documentation improvements suitable for new contributors.

## Questions?

- Check the [Architecture](ARCHITECTURE.md) overview and the [Configuration](CONFIGURATION.md) reference
- Ask in GitHub Discussions
- The development and test tooling are documented in the private repository this tree is mirrored from
