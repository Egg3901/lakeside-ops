# Lakeside Ops repository rules

The product includes apps/agent, apps/web, apps/ios and apps/desktop. The root
lakeside CLI owns setup. Standalone is the default for independent installs;
Lakeside mode is an optional studio deployment. Preserve that boundary.

Use a registered worktree for changes. Run the smallest relevant checks, then
required CI gates. Commit explicit files. Do not deploy, move runtime state,
change live units or restart production as part of a source refactor.

Secrets and runtime data never belong in Git. Component instructions apply
within their directory; machine paths and studio runbooks in legacy notes are
historical context, not prerequisites for another user's installation.

Finish work committed with a PR or a concrete handoff. Never delete another
session's worktree. Do not turn a queue receipt into a completion claim.
