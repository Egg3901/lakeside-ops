# Lakeside Code for Windows: prototype

Includes the actual coding CLI, blue/steel-grey terminal, OpenCode 1.19.0 engine,
Keir's six coding skills plus five Lakeside design skills (Ponytail full by default), and optional peer coordination.
The installer downloads the correct engine and dependencies through npm. A model
provider login is needed for coding; `/connect` handles that inside the terminal.

Extract this entire ZIP before running an installer. You need Node.js 22.12 or
later in the environment you choose. No repository checkout or Keir server is needed.

## Native Windows: fastest way to try

Open PowerShell in the extracted directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-LakesideCode.ps1 -Preview
```

Use Windows Terminal for the UI. The preview uses sample data and no model calls.
After installation, open a fresh terminal and run:

```powershell
lakeside code C:\path\to\your\project
```

Native Windows is experimental. This build has not been run on a physical Windows
PC. The installed terminal, skills, tools and coding loop were verified on Linux.

## WSL2 Ubuntu: recommended coding environment

Keep projects in Ubuntu's filesystem (`~/projects`), rather than `/mnt/c`, for
filesystem performance. Complete Ubuntu's first-run setup and install Node.js
22.12 or later inside Ubuntu, then from the extracted Windows directory run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-LakesideCodeWSL.ps1 -Preview
```

Pass `-Distro NAME` if Ubuntu has a different registered name. This installs under
`~/.local/share/lakeside-code` without sudo. In Ubuntu, start with:

```sh
~/.local/bin/lakeside code ~/projects/your-project
```

If `~/.local/bin` is already on your PATH, `lakeside code` works directly.
Use `lakeside code skills` to inspect built-in workflows, and `/ponytail lite`,
`/ponytail full`, `/ponytail ultra` or `/ponytail stop` to set the coding style.

This is a prerelease prototype from PR 22. The stable release still requires the
repository's full checks and merge. Keir desktop/iOS remain separate applications.
