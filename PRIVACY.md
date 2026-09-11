# zenwit Privacy And Data Use

[中文](PRIVACY.zh.md)

Updated: 2026-09-11. This document describes the current local zenwit build. It does not claim an online service operator or cover independently installed plugins.

## Local Data

zenwit stores settings, conversations, workspace references, credentials, logs and recovery data on your computer. Stable and Beta use separate application data directories. The default kernel directory is the application's `kernel/` subdirectory; `ZENWIT_HOME` selects an explicit alternative. Existing DSH data is not imported automatically.

Credentials handled by the desktop credential bridge use Electron's operating-system encryption facilities when available. This does not mean that every configuration file, plugin or exported diagnostic archive is encrypted. Workspace files remain in their selected locations.

## Network Requests

- Model requests go to the provider you configure. They can include messages, tool results and file content selected during a task. Provider policies, pricing and retention apply.
- The original Desktop update service is disconnected. This build does not send update checks or download installers automatically.
- The built-in upstream session telemetry exporter and feedback UI/command are disabled in Desktop profiles.
- The plugin market uses `plugins.zenwit.cn`. Browsing, media loading and installation may contact catalog hosts, GitHub and npm. These services receive ordinary request information such as your IP address. Third-party plugins run their own code and may contact additional services.
- Browser/LAN access and Agents-Anywhere remote access are optional. Review their connection settings and provider terms before enabling them; remote access can expose the ability to operate your computer to authorized clients.

No claim is made that zenwit is entirely offline or that third-party services are operated by the zenwit maintainer.

## Diagnostics And Control

Diagnostics are exported as a local archive only when requested. Logs can include paths, session identifiers and error details; crash dumps can include memory content. Review the archive before sharing it. No zenwit support-upload service is configured in this build.

You can change model providers, revoke credentials, disable remote access and remove plugins. To remove local application data, quit zenwit and remove its application data directory and any separately selected kernel Home after backing up files you need. Uninstalling the application may leave this data intact. Deleting local data does not delete data already sent to providers.

## Distribution

A public distributor must supply its actual operator identity, privacy contact and policies for any services it deploys. Upstream maintainer email addresses and privacy promises do not apply to this fork. The original licenses and copyright notices remain applicable to the code.
