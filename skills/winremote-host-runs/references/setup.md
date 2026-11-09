# Setup and upgrades

## The build this skill needs

The run queue, owned jobs, verified transfers and `winremote-client` come from
the host-runs fork of winremote-mcp, <https://github.com/RafaelVidaurre/winremote-mcp>.
Upstream releases lack them. Install the same release on the Windows host and on
every agent machine. The current release is `v0.4.23-hostruns.4`:

```sh
uv tool install "git+https://github.com/RafaelVidaurre/winremote-mcp@v0.4.23-hostruns.4"
```

This needs `uv` and Git, and installs `winremote-mcp` (the server) and
`winremote-client`. A plain upstream install or upgrade replaces the fork and
removes these capabilities.

## Check an installation

On the agent machine, `winremote-client list` must print the host's `machine`
and its `runs`. Read failures as follows:

| Result | Meaning |
|---|---|
| `No HTTP winremote configuration found` | The agent machine has no `winremote` MCP entry; see [Connect an agent machine](#connect-an-agent-machine) |
| Connection refused or timeout | The server is down, bound to another address, or blocked by the firewall |
| HTTP 401 | The key in the agent's configuration differs from the host's `auth_key` |
| `Unknown tool: 'RunList'` | The server is an upstream build, or `enable_tier3` is off |

The installation is complete when `list` succeeds, a short owned run finishes
with `cleanup: complete`, and an upload and download of a small binary file
return matching hashes.

## Set up a Windows host

Run these steps in PowerShell as the Windows user who stays signed in, because
desktop tools act in that user's session. None of them needs administrator
rights except a firewall rule.

1. Install `uv` and Git (`winget install astral-sh.uv`, then `winget install Git.Git`), open a new
   PowerShell, then install the release with the command above.
2. Write the configuration with a new random key. Windows PowerShell 5 writes
   UTF-8 files with a byte-order mark, which the server cannot read, so write it
   through .NET. Set `$address` to the address agent machines use to reach this
   host: its Tailscale address, a LAN address, or `0.0.0.0` for every interface.

   ```powershell
   $address = '<address>'
   $key = -join ((1..2) | ForEach-Object { [guid]::NewGuid().ToString('N') })
   $dir = "$env:USERPROFILE\.config\winremote"
   New-Item -ItemType Directory -Force $dir | Out-Null
   $toml = "[server]`nhost = `"$address`"`nport = 8090`nauth_key = `"$key`"`n`n[security]`nenable_tier3 = true`n"
   [IO.File]::WriteAllText("$dir\winremote.toml", $toml, (New-Object Text.UTF8Encoding $false))
   $key
   ```

   `enable_tier3` turns on the run queue and transfers. They run commands, so
   they share a tier with `Shell`. The key is the only authentication: keep it in
   the agent machines' MCP configuration and nowhere else.
3. Let agent machines reach the port. Tailscale on Windows normally admits all
   tailnet traffic already, through its `Tailscale-In` firewall rule on the
   Private profile. On a LAN, add a rule in an elevated PowerShell:

   ```powershell
   New-NetFirewallRule -DisplayName 'winremote' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090 -RemoteAddress <agent addresses>
   ```
4. Start the server at sign-in, hidden, through a launcher script:

   ```powershell
   $exe = (Get-Command winremote-mcp).Source
   $launcher = "$env:USERPROFILE\.config\winremote\start-server.ps1"
   Set-Content -LiteralPath $launcher -Value "& '$exe' --config '$env:USERPROFILE\.config\winremote\winremote.toml'"
   $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName 'WinRemoteMCP' -Action $action -Trigger $trigger -Settings $settings
   Start-ScheduledTask -TaskName 'WinRemoteMCP'
   ```

The host is ready when `netstat -ano -p tcp | Select-String ':8090'` shows a
`LISTENING` line on the configured address.

## Connect an agent machine

1. Install the release with the command above.
2. Register the server as an MCP server named `winremote`. `winremote-client`
   reads that entry from `~/.claude.json` or `$CODEX_HOME/config.toml`
   (default `~/.codex/config.toml`).
   - Claude Code, at user scope so the entry lands where the client reads it:

     ```sh
     claude mcp add --scope user --transport http winremote http://<host>:8090/mcp --header "Authorization: Bearer <key>"
     ```
   - Codex, with the key in the environment variable `WINREMOTE_AUTH_KEY`:

     ```toml
     [mcp_servers.winremote]
     url = "http://<host>:8090/mcp"
     bearer_token_env_var = "WINREMOTE_AUTH_KEY"
     ```

   For any other client, pass `--config <file>` with `{"url": ..., "headers": {...}}`.
3. Run the checks in [Check an installation](#check-an-installation).

## Upgrade

1. Let running work finish: `winremote-client list` shows none of it active.
2. On each agent machine, run the install command with the new tag and `--force`.
3. On the host, at the machine: `Stop-ScheduledTask -TaskName WinRemoteMCP`, run
   the install command with the new tag and `--force`, then
   `Start-ScheduledTask -TaskName WinRemoteMCP`. The server's Python files are
   in use while it runs, so the install needs it stopped.
4. Run the checks in [Check an installation](#check-an-installation).

Keep `%USERPROFILE%\.local\share\winremote\runs` through upgrades. It holds the
queue, run evidence and the machine identity that measurements are labeled with.
