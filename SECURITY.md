# Security

## Report a vulnerability

Please do not open a public issue. Report it privately through GitHub: [Security → Report a vulnerability](https://github.com/trebeljahr/tidepost/security/advisories/new).

Include the steps to reproduce it and what an attacker could do with it.

## What counts

Each tidepost deploy serves one person, so the main risks are:

- signing in or reopening setup without a passkey or the setup code
- an API token that approves or publishes, or reads more than its scope allows
- reading photos or posts without a session, a token or a valid signed `/media` link
- the Worker sending data to a host other than Instagram's API and image servers

## Supported versions

Only the latest commit on `main` gets fixes. To update your deploy, pull the new commits into your copy of the repository. Workers Builds redeploys on every push to its main branch.
