# Security

Report vulnerabilities privately through this repository's Security tab. Do not
include credentials or private conversations in public issues.

Never commit environment files, provider logins, runtime ledgers, SQLite state,
Apple signing keys or operational snapshots. The consolidated source imports no
private website history. CI scans source and history with Gitleaks.

A narrowly scoped Gitleaks exception covers a public minified vis-network JS
property that resembles an API key. It does not exempt other files or rules.

Independent installs should run under their own unprivileged Unix account.
Sessions and provider credentials stay on that installation. The coding harness
runs commands with its account's authority; command filters are not a substitute
for OS isolation. Keep public traffic behind HTTPS and use an exact portal URL.

Repository protections require PRs and checks, block force pushes/deletions,
and require resolved conversations. Secrets in old private source history must
be revoked separately; keeping that history private does not prove revocation.
