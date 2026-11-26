# TRM-Craft

Minecraft-Server hosten auf dem eigenen Windows-PC: Java Edition und Bedrock Edition, mit den gängigen Loadern, Mods, Backups,
Domain-Anbindung und einer Schnittstelle, über die später die TRM-Webseite die App fernsteuern kann.

> **Stand:** Alle zehn Meilensteine sind umgesetzt und getestet. Entwickelt und automatisch getestet wurde in einer Linux-Umgebung.
> Was dort **nicht** geprüft werden konnte (Windows-Installer, echte Mojang/PaperMC/Modrinth-Antworten, Router, Firewall), steht
> ehrlich im Abschnitt [Was noch zu prüfen ist](#was-noch-zu-prüfen-ist).

## Funktionen

| Bereich | Umfang |
|---|---|
| **Server** | Java: Vanilla, Paper, Purpur, Folia, Spigot (per BuildTools), Fabric, Quilt, Forge, NeoForge. Proxys: Velocity, Waterfall, BungeeCord. Bedrock Dedicated Server. Crossplay (Geyser + Floodgate) |
| **Assistent** | Software, Version, Name, RAM, Welt (neu, Seed, ZIP-Import), EULA nur per aktiver Zustimmung, Vorlagen |
| **Java** | Passende Java-Version (8, 17, 21 ...) wird automatisch erkannt und geladen (Temurin) |
| **Betrieb** | Start, Stopp, Neustart, Kill, Auto-Neustart bei Absturz mit Backoff, Crash-Erklärung auf Deutsch, Live-Konsole mit Farben, Verlauf und Autovervollständigung |
| **Mods** | Modrinth, CurseForge (eigener API-Key), Hangar. Abhängigkeiten, Inkompatibilitäts-Warnungen, Drag & Drop mit Loader-Prüfung, Aktivieren/Deaktivieren, Updates. Modpacks (`.mrpack`, CurseForge-ZIP) |
| **Spieler** | Verlauf, Spielzeit, Skin-Köpfe, Kick, Ban, OP, Whitelist, Gamemode, Teleport, Nachrichten |
| **Dateien** | Dateimanager mit Code-Editor (Syntax-Hervorhebung), Upload, Entpacken, bleibt im Server-Ordner |
| **Welten** | Mehrere Welten, wechseln, Export/Import (ZIP), zurücksetzen (mit Backup), Seed, Live-Karte per Dynmap |
| **Backups** | Manuell und per Zeitplan, laufender Server wird sauber pausiert, Aufbewahrungsregel, anderes Laufwerk, Wiederherstellen mit Sicherheits-Backup |
| **Zeitpläne** | Neustart (mit Chat-Vorwarnung), Backup, Befehl, Ankündigung |
| **Leistung** | CPU, RAM, TPS, Spielerzahl als Verlauf, Warnung bei niedrigen TPS, Spark-Profiler, RAM-Empfehlung |
| **Benachrichtigungen** | Windows-Benachrichtigungen und Discord-Webhook je Server |
| **Netzwerk** | Öffentliche/lokale IP, Erreichbarkeits-Check, UPnP, Anleitung zur Portweiterleitung, Windows-Firewall-Regeln, Cloudflare-Domain mit SRV-Eintrag, Dynamisches DNS, Tunnel (playit.gg), Join-Karte mit QR-Code |
| **Fernzugriff** | Ausgehende wss-Verbindung, Kopplung per Code, Rechte (Owner/Admin/Moderator/Ansehen), Upload von Mods/Modpacks/Welten mit Fortsetzen, Prüfsumme, Verlauf und Rückgängig |
| **Updates** | Automatische Updates der App aus GitHub-Releases, Rollback bei Absturz, Beta-Kanal. Server-Software-Updates (Paper, Purpur, Folia, Fabric ...) per Klick |
| **Sonstiges** | Server klonen, bestehende Ordner importieren, Ressourcenlimits (CPU-Kerne, Priorität), Deutsch/Englisch, Hell/Dunkel, Akzentfarbe, Befehlspalette |

### Tastenkürzel

| Kürzel | Aktion |
|---|---|
| `Strg+K` | Befehlspalette (Server und Aktionen suchen) |
| `Strg+N` | Neuen Server erstellen |
| `Strg+,` | Einstellungen |

## Installation (für Nutzer)

1. Den neuesten `TRM-Craft-Setup-<Version>.exe` unter [Releases](../../releases) herunterladen und ausführen.
2. Windows SmartScreen zeigt ohne Code-Signing-Zertifikat eine Warnung: **"Weitere Informationen" → "Trotzdem ausführen"**.
3. Danach aktualisiert sich die App selbst. Neuinstallieren ist nie nötig.

Alle Daten (Server, Welten, Mods, Backups, Einstellungen) liegen in `%APPDATA%\TRM-Craft`, **nicht** im Installationsordner.
Updates und die Deinstallation löschen sie nicht.

## Entwicklung

Voraussetzungen: Node.js 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm test          # alle Tests (Kern, Server, Remote, UI, Desktop, Release-Skripte)
pnpm typecheck
pnpm build         # baut UI und Electron-Hauptprozess
```

App im Entwicklungsmodus starten (zwei Terminals):

```bash
pnpm --filter @trm/ui dev
```

```bash
pnpm --filter @trm/desktop dev
```

Die Oberfläche läuft auch im Browser (`pnpm --filter @trm/ui dev`), dann mit eingeschränkten Demo-Daten.

Den Windows-Installer baut der Workflow (siehe unten). Lokal auf Windows: `pnpm build` und danach
`pnpm --filter @trm/desktop exec electron-builder --win`.

### Projektstruktur

```
apps/
  desktop/      Electron: Hauptprozess, Preload-Bridge, Updater, Tray, Benachrichtigungen, Geheimnis-Speicher
  ui/           React + Vite + Tailwind + Framer Motion
packages/
  core/         Gemeinsame Typen und die Command-API (Befehle, Rollen, Ereignisse)
  servers/      Server-Verwaltung: Anbieter-APIs, Loader, Prozesse, Mods, Backups, Welten, Netzwerk, Zeitpläne
  remote/       Fernzugriff: Protokoll, Kopplung, WebSocket-Client, Upload mit Fortsetzen
docs/           release.md, remote-api.md
scripts/        Versionierung, Changelog, Mock-Webseite
.github/        CI, Release-Pipeline, wöchentlicher API-Vertragstest
```

**Grundidee:** Die Oberfläche und die Webseite rufen exakt dieselbe Command-API auf (`packages/core/src/commands.ts`).
Jeder Befehl hat eine Mindestrolle. Neue Funktion = ein Eintrag dort plus ein Handler im Hauptprozess.

## Updates und Release

Kurz: **Einfach auf `main` pushen.** Der Rest passiert automatisch. Details in [docs/release.md](docs/release.md).

- Push auf `main` → Stable-Release, Push auf `beta` → Pre-Release (Beta-Kanal).
- Version aus den Commit-Messages: `fix:` = Patch, `feat:` = Minor, `feat!:`/`BREAKING CHANGE` = Major.
  Nur `chore:`, `docs:`, `test:`, `ci:` löst **keinen** Release aus.
- Schlägt Typprüfung, Test oder Build fehl, wird nichts veröffentlicht.
- **Secrets:** Es werden keine eigenen benötigt. Der Workflow nutzt den automatischen `GITHUB_TOKEN`.
- **Wichtig:** Das Repository muss **öffentlich** sein, sonst können installierte Apps keine Updates laden.
- Installierte Apps laden Updates im Hintergrund (differenziell) und installieren beim nächsten Neustart.
  Vorher werden laufende Server mit Chat-Warnung gestoppt und danach wieder gestartet.
- Stürzt eine neue Version dreimal hintereinander ab, geht die App automatisch auf die letzte gute Version zurück.

### Erster Test der Update-Kette

1. Branch `main` erzeugen/mergen, Repository öffentlich stellen, Workflow "Release" abwarten (es entsteht `v0.1.0`).
2. `TRM-Craft-Setup-0.1.0.exe` installieren.
3. Eine Änderung mit `feat: ...` nach `main` pushen (es entsteht `v0.2.0`).
4. In der App: Einstellungen → "Nach Updates suchen". Nach dem Neustart läuft `0.2.0`.

## Mit eigener Domain joinen (z. B. `play.meinname.net`)

Im Server-Tab **Netzwerk**:

1. **Erreichbarkeit:** Server starten, "Von außen prüfen". (Dabei werden IP und Port an mcsrvstat.us gesendet.)
2. **Portfreigabe:** "Ports freigeben" (UPnP). Klappt das nicht, "Manuelle Anleitung" öffnen und die Regel im Router anlegen.
   Java nutzt **TCP 25565**, Bedrock **UDP 19132**.
3. **Firewall:** "Regeln anlegen". Windows fragt nach Administratorrechten.
4. **Domain (Cloudflare):**
   1. Domain bei Cloudflare verwalten lassen.
   2. In Cloudflare ein API-Token erstellen mit Berechtigung **Zone → DNS → Bearbeiten** für diese Domain.
   3. Token in TRM-Craft einfügen (wird verschlüsselt gespeichert), Domain und Subdomain eintragen, "Einrichten".
   4. TRM-Craft legt `A play.meinname.net` an (ohne Cloudflare-Proxy) und für Java `_minecraft._tcp.play` (SRV), damit man **ohne Port** joinen kann.
   5. Ändert sich deine öffentliche IP, wird der Eintrag automatisch aktualisiert.
5. **Bedrock:** unterstützt keine SRV-Einträge. Bedrock-Spieler brauchen Adresse **und** Port 19132.
6. **Geht keine Portfreigabe (CGNAT)?** Tunnel (playit.gg) starten, Link zum Verbinden öffnen und im playit.gg-Konto einen Tunnel auf den Server-Port anlegen.
7. Die **Join-Karte** oben zeigt die Adressen zum Kopieren und als QR-Code.

## Fernzugriff und Webseite

Die App kann sich per ausgehender, verschlüsselter WebSocket-Verbindung mit der TRM-Webseite verbinden. Dafür ist keine Portfreigabe nötig.
Die komplette Schnittstelle (Kopplung, Befehle, Ereignisse, Datei-Upload mit Fortsetzen, Rechte) ist in
[docs/remote-api.md](docs/remote-api.md) beschrieben. Die Webseite muss nur noch angeschlossen werden.
`scripts/mock-site.cjs` ist eine Mock-Webseite zum Ausprobieren.

Der Fernzugriff ist **standardmäßig aus** und lässt sich jederzeit abschalten oder die Kopplung lösen.

## Sicherheit

- API-Keys, Tokens und Webhooks werden nie im Klartext gespeichert: Windows-DPAPI über Electron `safeStorage`.
  Ist die Verschlüsselung nicht verfügbar, wird **nichts** gespeichert (kein Klartext-Fallback).
- Electron: `contextIsolation`, kein `nodeIntegration`, Sandbox, Content-Security-Policy, nur `https`-Links nach außen.
- Dateimanager, Mods, Uploads und Modpacks sind auf den Server-Ordner begrenzt (Schutz vor Path-Traversal und Zip-Slip).
- Downloads nur von festgelegten offiziellen Hosts, Prüfsummen werden geprüft, wo die Quelle sie liefert.
- Konsolen- und Spielerbefehle können keine weiteren Befehle einschleusen (Zeilenumbrüche und Sonderzeichen werden abgelehnt).
- Fernzugriff: nur `wss://`, lokale Befehle (Fenster, Dialoge, Geheimnisse, lokale Dateipfade) sind aus der Ferne gesperrt,
  Rollen mit lokaler Obergrenze, `owner`-Befehle nie remote. Uploads brauchen Upload-Recht, Prüfsumme und Typ-/Größenprüfung.
- UPnP und Router-Antworten werden nur aus dem Heimnetz akzeptiert.
- Die Minecraft-EULA wird **nie** automatisch akzeptiert.

### Welche Dienste kontaktiert die App?

Mojang (Versionen), PaperMC (Paper, Folia, Velocity, Waterfall), Purpur, Fabric, Quilt, Forge, NeoForge (Maven), Adoptium (Java),
Modrinth, CurseForge (nur mit deinem Key), Hangar, GeyserMC, GitHub (Updates, playit.gg-Agent), ipify.org (öffentliche IP),
mcsrvstat.us (Erreichbarkeits-Check, nur auf Knopfdruck), Cloudflare (nur wenn du eine Domain einrichtest),
Discord (nur mit eingetragenem Webhook) und die TRM-Webseite (nur bei aktivem Fernzugriff).

## Was noch zu prüfen ist

Ehrlich getrennt nach "automatisch getestet" und "braucht deinen Windows-PC":

**Automatisch getestet** (239 Tests, dazu 10 Live-Vertragstests gegen die echten APIs): Server-Lebenszyklus mit simuliertem Minecraft-Prozess, Downloads und Prüfsummen,
Properties-Parser, Backups und Wiederherstellung, Welten, Zeitpläne, Mods und Modpacks, Pfad-Sicherheit, Rollen und Remote-Sperrliste,
Upload mit Fortsetzen, UPnP/SOAP gegen Fake-Router, Cloudflare/DDNS gegen Fake-API, Versionierung und Changelog, Rollback-Logik,
Updater-Countdown. Die echte Electron-App wurde zusätzlich headless gestartet und per IPC, gegen eine Mock-Webseite (Kopplung, Befehle,
Upload) und visuell (Screenshots) geprüft.

**Braucht dich:**

1. **Installer und Auto-Update.** Der Windows-Build läuft erst in GitHub Actions. Erster Test siehe oben.
   Die Tests laufen dort auch unter Windows. Schlägt dort eines fehl, wird bewusst **kein** Release veröffentlicht. Dann bitte das Log ansehen.
2. **Anbieter-APIs: geprüft.** Der Workflow "API-Vertragstest" hat die Anbieter-Module gegen die echten APIs laufen lassen (Mojang, PaperMC, Adoptium,
   Fabric, Quilt, Forge, NeoForge, Purpur, Bedrock-Download, Geyser, Modrinth, Hangar). Dabei fiel ein Fehler auf (Quilt ohne `stable`-Feld), der behoben wurde.
   Der Test läuft wöchentlich weiter und meldet, falls sich ein Format ändert. **Nicht** geprüft sind die Downloads selbst, Cloudflare und CurseForge (brauchen deine Keys).
3. **Echtes Spiel.** Server erstellen und starten, Spieler joinen lassen (Java, Bedrock, Crossplay).
4. **Router/Firewall.** UPnP, Windows-Firewall-Regeln (UAC-Abfrage), Cloudflare-Einrichtung, playit.gg-Agent.
5. **Windows-Details.** Die CPU/RAM-Messung nutzt PowerShell (`Get-Process`), das Erkennen von Prozessen und das Beenden unter Windows.

## Bewusst nicht enthalten

- **PocketMine-MP** (Bedrock-Alternative): braucht eine eigene PHP-Laufzeit. Bedrock läuft über den offiziellen Server.
- **SpigotMC als Mod-Quelle:** Downloads dort sind technisch nicht zuverlässig automatisierbar. Modrinth, Hangar und CurseForge sind enthalten.
- **Cloud-Backups:** Ziele sind lokal und andere Laufwerke. Cloud war als "später" vorgesehen.
- **Spieler-Ping** in der Liste: Minecraft liefert ihn nicht über die Konsole.
- **Weltverwaltung für Bedrock** (Seed, Export): nur für Java umgesetzt.
- **Code-Signing:** Ohne Zertifikat zeigt Windows SmartScreen eine Warnung (siehe [docs/release.md](docs/release.md)).
- **Eigener Hintergrunddienst:** Server laufen im Hauptprozess der App und im Tray weiter, auch wenn das Fenster geschlossen ist.
  Beenden der App stoppt sie sauber. Nach einem Update starten sie automatisch wieder.
- **Server-Daten in SQLite:** Konfiguration und Verläufe liegen als JSON-Dateien (atomar geschrieben). Das vermeidet native Module,
  die für Electron neu gebaut werden müssten.
