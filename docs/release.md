# Release und Auto-Update

## Ablauf

1. Du pushst auf `main` (Stable) oder `beta` (Pre-Release).
2. GitHub Actions (`.github/workflows/release.yml`) berechnet die Version aus den Commit-Messages:
   - `fix:`, `perf:`, `refactor:` = Patch (`1.4.2` → `1.4.3`)
   - `feat:` = Minor (`1.4.2` → `1.5.0`)
   - `feat!:` oder `BREAKING CHANGE` = Major (`1.4.2` → `2.0.0`)
   - nur `chore:`, `docs:`, `test:`, `ci:`, `style:`, `build:` = **kein Release**
   - Beta-Builds heißen `1.5.0-beta.1`, `1.5.0-beta.2`, ...
3. Typecheck, Tests und Build laufen. Schlägt etwas fehl, wird **nichts** veröffentlicht.
4. Der Windows-Installer wird gebaut und als GitHub-Release mit `latest.yml` (Stable) bzw. `beta.yml` veröffentlicht. Das Changelog entsteht aus den Commit-Messages.
5. Installierte Apps finden das Update beim Start und danach im eingestellten Intervall, laden es im Hintergrund (differenziell über die `.blockmap`) und installieren es beim nächsten Neustart.

## Secrets

Es sind **keine** eigenen Secrets nötig. Der Workflow nutzt den automatisch bereitgestellten `GITHUB_TOKEN`
(Berechtigung `contents: write` ist im Workflow gesetzt).

Voraussetzung: Das Repository muss **öffentlich** sein. Bei einem privaten Repo könnte die App
Updates nur mit einem Token abrufen, das dann im Installer läge. Das sollte man nicht tun.

## Integrität und Signatur

`electron-updater` prüft jede heruntergeladene Datei gegen den SHA-512-Hash aus `latest.yml`.
Ohne Code-Signing-Zertifikat zeigt Windows SmartScreen beim ersten Installieren eine Warnung
("Weitere Informationen" → "Trotzdem ausführen"). Mit einem Zertifikat trägst du
`CSC_LINK` und `CSC_KEY_PASSWORD` als Repository-Secrets ein und ergänzt `publisherName` in
`apps/desktop/electron-builder.yml`. Dann prüft der Updater zusätzlich die Signatur.

## Rollback

Startet eine neue Version dreimal hintereinander nicht stabil (20 Sekunden Laufzeit gelten als stabil),
lädt die App den Installer der letzten guten Version aus dem GitHub-Release, prüft den SHA-512,
installiert ihn still und zeigt eine Benachrichtigung. Die abgestürzte Version wird gemerkt und nicht
erneut installiert.

## Wo liegen die Daten?

Alles Nutzerseitige liegt in `%APPDATA%\TRM-Craft` und wird von Updates und der Deinstallation nicht gelöscht.

## Erster Test (Checkliste)

1. Repository öffentlich stellen, Branch `main` anlegen und pushen.
2. In GitHub unter *Actions* den Lauf "Release" abwarten. Es entsteht `v0.1.0`.
3. `TRM-Craft-Setup-0.1.0.exe` aus dem Release installieren.
4. Eine Änderung mit `feat: ...` pushen. Es entsteht `v0.2.0`.
5. In der installierten App: Einstellungen → "Nach Updates suchen". Das Update wird geladen, nach dem Neustart ist die Version 0.2.0.
