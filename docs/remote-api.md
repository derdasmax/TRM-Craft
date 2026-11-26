# Remote-API (App ↔ TRM-Webseite)

Diese Datei beschreibt alles, was die Webseite implementieren muss, um TRM-Craft fernzusteuern.
Die App-Seite ist fertig und getestet (`packages/remote`). Die Webseite muss nur noch angeschlossen werden.

**Protokollversion:** `1`

## Überblick

```
TRM-Craft (Laptop)  ──── ausgehende wss-Verbindung ───▶  TRM-Webseite (Agent-Endpunkt)
                    ◀─── Befehle, Uploads ──────────────
                    ──── Ereignisse, Antworten ────────▶
```

- Die App baut die Verbindung **selbst und ausgehend** auf. Auf dem Laptop ist dafür keine Portfreigabe nötig.
- Alle Funktionen der App laufen intern über dieselbe **Command-API** (`packages/core/src/commands.ts`).
  Was die lokale Oberfläche kann, kann die Webseite auch, mit Ausnahme der gesperrten Befehle (siehe unten).
- Jede Nachricht ist ein JSON-Objekt mit dem Feld `type`.

## 1. Kopplung

1. Der Nutzer öffnet auf der Webseite die Seite "Gerät koppeln". Die Webseite erzeugt einen **Code**
   (4 bis 24 Zeichen: Buchstaben, Zahlen, Bindestrich), z. B. `K7QM-29XD`, mit kurzer Gültigkeit (z. B. 10 Minuten, einmalig).
2. Der Nutzer trägt in der App unter *Einstellungen → Fernzugriff* die Adresse der Webseite und den Code ein.
3. Die App sendet:

```http
POST https://<host>/api/devices/pair
Content-Type: application/json

{ "code": "K7QM-29XD", "deviceName": "Max Laptop", "appVersion": "1.4.2", "protocol": 1 }
```

4. Antwort bei Erfolg (`200`):

```json
{
  "deviceToken": "<zufälliges Token, mindestens 16 Zeichen>",
  "deviceId": "dev_123",
  "siteName": "TRM",
  "perms": { "upload": true }
}
```

   Fehler: `400`, `404` oder `410` bedeuten "Code falsch oder abgelaufen".

5. Die App speichert das Token **verschlüsselt** (Windows-DPAPI über Electron `safeStorage`). Ohne verfügbare Verschlüsselung wird nichts gespeichert.
6. Die Webseite sollte das Token nur gehasht speichern und widerrufen können.

Die HTTP-Adresse leitet die App aus der WebSocket-Adresse ab (`wss://host/...` → `https://host`).

## 2. Verbindung

```
wss://<host>/<agent-pfad>
Authorization: Bearer <deviceToken>
```

- Nur `wss://` ist erlaubt (`ws://` nur für `localhost` zur Entwicklung).
- Ist das Token ungültig, schließt die Webseite die Verbindung mit dem **Close-Code `4401`** (oder `4403`).
  Die App versucht dann nicht erneut zu verbinden und zeigt "Koppel das Gerät neu".
- Bei jedem anderen Verbindungsende verbindet die App neu: Wartezeit 1 s, 2 s, 4 s ... bis maximal 60 s (mit Zufallsanteil).
- Heartbeat: Die App sendet alle 25 s ein WebSocket-Ping. Kommt 70 s lang nichts an, baut sie die Verbindung neu auf.
  Die Webseite kann zusätzlich `{ "type": "ping" }` senden und bekommt `{ "type": "pong" }`.
- Maximale Nachrichtengröße: 8 MB.

### App → Webseite: `hello`

Wird direkt nach dem Verbinden gesendet:

```json
{
  "type": "hello",
  "protocol": 1,
  "deviceId": "dev_123",
  "deviceName": "Max Laptop",
  "appVersion": "1.4.2",
  "platform": "win32",
  "canUpload": true,
  "servers": [
    { "id": "survival-3f2a", "name": "Survival", "loader": "paper", "mcVersion": "1.21.4", "edition": "java", "status": "running", "players": 3 }
  ]
}
```

Nach `hello` sollte die Webseite wartende Uploads für dieses Gerät senden (siehe 5).

## 3. Befehle

### Webseite → App

```json
{ "type": "cmd", "id": "req-1", "command": "servers.start", "args": "survival-3f2a", "role": "moderator", "user": "Maxi" }
```

| Feld | Bedeutung |
|---|---|
| `id` | Anfrage-ID (4 bis 64 Zeichen `A-Za-z0-9_-`), kommt in der Antwort zurück |
| `command` | Name des Befehls (siehe Tabelle unten) |
| `args` | Argumente, Form je Befehl (siehe `CommandMap` in `packages/core/src/commands.ts`) |
| `role` | Rolle des Nutzers auf der Webseite: `owner`, `admin`, `moderator`, `viewer` |
| `user` | optional, Anzeigename für Protokolle |

### App → Webseite

```json
{ "type": "res", "id": "req-1", "ok": true, "result": null }
{ "type": "res", "id": "req-1", "ok": false, "error": "Dafür fehlt die Berechtigung." }
```

Fehlermeldungen sind deutsch und für Nutzer lesbar.

### Rechte-System

Jeder Befehl hat eine **Mindestrolle** (`commandRoles` in `packages/core/src/commands.ts`):

| Rolle | Darf unter anderem |
|---|---|
| `viewer` | ansehen: Server, Logs, Spieler, Backups, Statistiken, Mods |
| `moderator` | Server starten/stoppen/neu starten, Konsolenbefehle, Spieleraktionen (kicken, bannen, OP), Backups erstellen |
| `admin` | Einstellungen, Dateien, Mods und Plugins, Welten, Backups wiederherstellen, Zeitpläne, Netzwerk, Server erstellen |
| `owner` | Server löschen, Firewall, Domain, Welt zurücksetzen |

Zusätzlich gilt eine **lokale Obergrenze** (`maxRole`, Standard `admin`), die der Nutzer in der App einstellt.
Eine höhere Rolle von der Webseite wird auf diese Obergrenze gekappt. Die Obergrenze kann höchstens `admin` sein: **`owner`-Befehle (Server löschen, Firewall, Domain, Welt zurücksetzen) sind aus der Ferne nie möglich** und bleiben bewusst lokal.

### Aus der Ferne gesperrte Befehle

Diese Befehle werden **immer** abgelehnt, egal welche Rolle gesendet wird:

- `window.*`, `shell.*`, `dialog.*`, `secrets.*`, `remote.*`
- `updater.installNow`, `updater.skipCountdown`
- `mods.addFiles`, `files.upload`, `worlds.import`, `worlds.export` (nehmen lokale Dateipfade entgegen, nutze stattdessen den Upload)
- `net.firewall.add`, `net.firewall.remove` (Windows-Administratorabfrage)

Außerdem abgelehnt: `servers.create` mit `worldZip`, `modpacks.install` mit Quelle `file`, `servers.update` mit `patch.backup.dir`.

### Wichtige Befehle (Auswahl)

| Befehl | Argumente | Ergebnis |
|---|---|---|
| `servers.list` | – | `ServerView[]` |
| `servers.create` | `{ token, input: CreateServerInput }` | `ServerRecord` (Fortschritt über Ereignis `servers.progress`) |
| `servers.start` / `stop` / `restart` / `kill` | Server-ID | – |
| `servers.command` | `{ id, command }` | – |
| `servers.logs` | Server-ID | `string[]` |
| `servers.update` | `{ id, patch }` | `ServerRecord` |
| `servers.properties.get` / `set` | `id` / `{ id, values }` | Eigenschaften |
| `players.list`, `players.action` | `id` / `{ id, action, name, arg? }` | – |
| `files.list` / `read` / `write` / `mkdir` / `delete` / `rename` / `unzip` | `{ id, path, ... }` | Dateien (immer innerhalb des Server-Ordners) |
| `mods.search` / `install` / `installed` / `toggle` / `remove` / `checkUpdates` / `update` | siehe `commands.ts` | – |
| `modpacks.install` | `{ token, source: { type: 'modrinth', projectId }, name, ramMb, acceptEula: true }` | `{ record, warnings }` |
| `backups.list` / `create` / `restore` / `delete` | `id` / `{ id, ... }` | – |
| `worlds.list` / `setActive` / `reset` | `id` / `{ id, name }` | – |
| `schedules.list` / `save` / `delete` | – / `ScheduleTask` / id | – |
| `stats.history` | Server-ID | `StatsSample[]` |
| `net.info`, `net.join`, `net.reach`, `net.upnp.*`, `net.domain.*` | siehe `commands.ts` | – |

Die vollständige, typisierte Liste mit allen Argument- und Ergebnistypen steht in `packages/core/src/commands.ts` (`CommandMap`).

## 4. Ereignisse

Standardmäßig sendet die App **keine** Ereignisse. Die Webseite abonniert sie:

```json
{ "type": "subscribe", "events": ["servers.status", "servers.log", "servers.stats", "servers.progress", "remote.upload"], "serverIds": ["survival-3f2a"] }
```

- `serverIds` ist optional. Ohne Angabe gelten alle Server. Ein erneutes `subscribe` ersetzt das vorherige.
- Das Abo gilt nur für die aktuelle Verbindung. Nach einem Neuverbinden muss es erneut gesendet werden.

App → Webseite:

```json
{ "type": "event", "event": "servers.status", "payload": { "...": "ServerView" } }
```

| Ereignis | Nutzlast |
|---|---|
| `servers.status` | `ServerView` (Status, Spieler, Absturzbericht) |
| `servers.removed` | Server-ID |
| `servers.log` | **gebündelt:** `{ "id": "...", "lines": ["...", "..."] }` (alle 250 ms, höchstens 500 Zeilen) |
| `servers.stats` | `{ id, sample: { t, cpu, ramMb, players, tps? } }` (alle 5 s je laufendem Server) |
| `servers.progress` | `{ token, label, percent }` (Erstellen, Downloads) |
| `remote.upload` | `UploadRecord` (Fortschritt und Ergebnis von Uploads) |

### Sitzungen anzeigen

Die Webseite kann der App melden, wer gerade verbunden ist. Die App zeigt die Liste unter *Fernzugriff*:

```json
{ "type": "sessions", "list": [ { "id": "sess_1", "name": "Maxi (Chrome)", "role": "admin", "since": 1767225600000 } ] }
```

## 5. Datei-Upload (Mods, Plugins, Modpacks, Welten, Packs)

Du lädst auf der TRM-Seite eine Datei hoch, sie landet im richtigen Ordner des richtigen Servers auf dem Laptop.

Voraussetzung: Das Gerät hat beim Koppeln das **Upload-Recht** (`perms.upload`) bekommen.

### Variante A: Übertragung in Stücken über die bestehende Verbindung

```
Web → App   upload.begin   { uploadId, serverId, fileName, size, sha256, restartAfter?, uploader? }
App → Web   upload.ready   { uploadId, received }            // received > 0 = Fortsetzen
Web → App   upload.chunk   { uploadId, offset, data }         // data = Base64, empfohlen 512 KB bis 1 MB roh
App → Web   upload.ack     { uploadId, received }             // nach jedem Stück
...
Web → App   upload.end     { uploadId }
App → Web   upload.done    { uploadId, kind, warnings[] }
        oder upload.failed { uploadId, error }
```

Regeln:

- `uploadId`: 4 bis 64 Zeichen `A-Za-z0-9_-`, vom Server der Webseite vergeben.
- `sha256`: Prüfsumme der **ganzen** Datei (hex, 64 Zeichen). Pflicht. Wird nach dem Empfang geprüft.
  Stimmt sie nicht, wird **nichts installiert** (`upload.failed`).
- **Fortsetzen:** Bricht die Verbindung ab, sendet die Webseite nach dem Neuverbinden dasselbe `upload.begin` erneut
  (gleiche `uploadId`, `size` und `sha256`). Die App antwortet mit `received = bereits vorhandene Bytes` und der Upload geht ab dort weiter.
  Das funktioniert auch nach einem Neustart der App.
- **Reihenfolge:** Ein Stück wird nur angenommen, wenn `offset == received`. Sonst antwortet die App mit
  `upload.ack { received }`, und die Webseite sendet ab diesem Wert erneut. So lassen sich verlorene Stücke ausgleichen.
- `upload.end` bei unvollständiger Datei: Die App antwortet mit `upload.ack` (aktueller Stand) statt zu beenden.
- Abbrechen: `{ "type": "upload.cancel", "uploadId": "..." }`.
- Fortschritt: Die Webseite kennt ihn aus den `upload.ack`. In der App erscheint er live im Upload-Verlauf (`remote.upload`).

### Variante B: App lädt selbst herunter (große Dateien)

Die Webseite legt die Datei kurz zwischen und sendet:

```json
{ "type": "upload.fetch", "uploadId": "...", "serverId": "...", "fileName": "pack.mrpack", "size": 123456, "sha256": "...", "url": "https://<host>/files/abc?sig=...", "restartAfter": false, "uploader": "Maxi" }
```

- Die App lädt **nur** von `https://` und **nur vom Host der verbundenen Webseite**. Andere Adressen werden abgelehnt.
- Nach der Prüfung (Größe und SHA-256) antwortet die App mit `upload.done` bzw. `upload.failed`.
  Erst danach darf die Webseite die Zwischendatei löschen.
- Die Adresse sollte kurzlebig signiert sein.

### Warteschlange (Laptop aus oder offline)

Die Webseite hält Uploads für ein Gerät in einer Warteschlange und startet sie, sobald das Gerät `hello` sendet.
Die App selbst führt keine Warteschlange für die Webseite.

### Wohin landet die Datei?

| Datei | Ziel | Prüfung |
|---|---|---|
| `.jar` | `mods/` (Fabric, Quilt, Forge, NeoForge) oder `plugins/` (Paper, Purpur, Folia, Spigot, Proxys) | Loader wird aus der JAR erkannt (z. B. `fabric.mod.json`, `plugin.yml`). **Passt er nicht, wird nicht installiert** und `upload.failed` gesendet. Nicht erkennbar: Installation mit Warnung. |
| `.mrpack` | wird in den Server entpackt (Mods, Overrides) | Loader und Minecraft-Version müssen zum Server passen. Vorher entsteht automatisch ein Backup (für "Rückgängig"). |
| `.zip` mit `level.dat` | neuer Welt-Ordner | Server muss gestoppt sein. |
| `.zip` mit `pack.mcmeta` | `<Welt>/datapacks/` | – |
| `.mcpack`, `.mcaddon` | `behavior_packs/` bzw. `resource_packs/` | nur Bedrock-Server |

Weitere Endungen werden abgelehnt (`upload.failed`).

### Sicherheit

- Erlaubte Dateitypen: `.jar`, `.zip`, `.mrpack`, `.mcpack`, `.mcaddon`.
- Größenlimit: in der App einstellbar (Standard 1024 MB). Größere Dateien werden bei `upload.begin` abgelehnt.
- Dateinamen werden bereinigt (nur der Dateiname, keine Pfade, keine Sonderzeichen). Nichts wird außerhalb des Server-Ordners gespeichert.
- Vorhandene Dateien werden nie überschrieben.
- Nur Geräte mit Upload-Recht. Ohne dieses Recht antwortet die App mit `upload.failed`.

### Verlauf und Rückgängig

Jeder Upload erscheint in der App unter *Einstellungen → Fernzugriff → Upload-Verlauf* mit Name, Server, Uhrzeit,
Absender (`uploader`) und Ergebnis, mit einem **Rückgängig**-Knopf:

- Mods, Plugins, Welten, Datapacks, Packs: Die platzierten Dateien werden gelöscht.
- Modpacks: Das Backup von vor dem Upload wird wiederhergestellt (Server muss gestoppt sein).

Ein Neustart des Servers (`restartAfter: true`, mit Chat-Ankündigung 30 Sekunden vorher) wird nicht zurückgenommen.

## 6. Beispiel: Minimaler Test-Ablauf

1. Webseite erzeugt Code, App koppelt (`POST /api/devices/pair`).
2. App verbindet, sendet `hello`.
3. Webseite sendet `{ "type": "subscribe", "events": ["servers.status"] }`.
4. Webseite sendet `{ "type": "cmd", "id": "req-1", "command": "servers.list", "role": "viewer" }` und erhält die Serverliste.
5. Webseite sendet einen Upload (Variante A) und erhält `upload.done`.

Als Referenz liegt `scripts/mock-site.cjs` im Repository: eine kleine Mock-Webseite (HTTP-Kopplung plus WebSocket), die genau diesen Ablauf
durchspielt, inklusive gesperrter Befehle und einem Upload in zwei Stücken. Die Tests dazu stehen in
`packages/remote/src/remote.test.ts` und `packages/remote/src/uploads.test.ts`.

```bash
node scripts/mock-site.cjs   # lauscht auf 127.0.0.1:8799, Ergebnis in mock-result.json
```

In der App als Adresse `ws://localhost:8799/agent` eintragen und einen beliebigen Code (z. B. `ABCD-1234`) koppeln.
Der Mock erwartet einen Server mit der ID `mod-0001` (Fabric). Passe die ID im Skript an.
