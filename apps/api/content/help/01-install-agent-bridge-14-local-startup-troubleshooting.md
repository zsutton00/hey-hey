---
id: 10000000-0000-4000-8000-000000000019
slug: local-startup-troubleshooting
title: Local startup troubleshooting
parentId: 10000000-0000-4000-8000-000000000001
ordering: 14
demos: []
---

When `heyhey local` cannot finish starting and cannot repair the problem itself, it keeps a diagnostic journal of the attempt and offers a troubleshooting prompt you can give to your own coding agent. Nothing is sent anywhere automatically. Your installation data and existing Docker shares are preserved.

## Read what happened

Each run of `heyhey local` writes a journal to `~/.heyhey/local-application/diagnostics/`, named `startup-<time>-<session>.jsonl`. It holds one JSON object per line: the event name, the attempt and session identifiers, and a safe error code. Error messages, stack traces, and secrets are deliberately not saved, so an error saved as `UNCLASSIFIED_FAILURE` means the original cause is unknown and only the failing stage was kept. The newest ten journals are kept, each up to 1 MiB; failed attempts are kept longest. If a journal says it was truncated, later events were not saved.

Run `heyhey local troubleshoot` at any time, even after the terminal closed and with the application stopped, to print the prompt for the newest failed attempt. The prompt is also saved as `troubleshooting-prompt.md` in the same folder.

## Docker cannot see the managed model folder

`heyhey local` downloads the search model itself into a folder it owns under `~/.heyhey/local-application` and shares that folder with Docker. The location is fixed: do not move it or point Hey Hey at another model location. If Docker reports that the bind source or mount for that folder is denied or invalid, the Docker daemon is not seeing the folder at the same path as your computer.

With Docker Desktop, confirm file sharing includes your home folder (Settings > Resources > File sharing), then run `heyhey local` again. With a remote Docker engine, the folder must exist at the same path on that engine's host; select a local engine instead.

### Colima

Colima runs Docker inside a VM that only sees folders listed under `mounts` in its profile configuration, `~/.colima/<profile>/colima.yaml`. When the active Docker socket belongs to a Colima profile and its VM does not see the model folder, Hey Hey offers a repair:

1. It saves a backup of `colima.yaml` beside it (`colima.yaml.heyhey-backup-*`).
2. It keeps every existing mount and its options, and adds the model folder as a read-only mount (`writable: false`).
3. After you confirm, it restarts only that profile with `colima --profile <profile> restart`. This stops the other containers running in that VM; installation data and volumes are kept.

If you decline or the repair cannot be applied, make the same change by hand: add the entry to `mounts`, restart the profile after you accept that its other containers stop, and run `heyhey local` again. Do not remove existing mounts, and do not edit Compose files; Hey Hey manages them.

## Give the prompt to your agent

Paste the prompt into a coding agent that runs on this computer so it can read the journal and these articles. A remote chat cannot read your files: the prompt carries the key facts inline, and the agent should ask you for excerpts. The prompt contains local paths, which include your account name.
