# Remote-API (App ↔ TRM-Relay)

Dies ist der **Vertrag zwischen der TRM-Craft-App und dem TRM-Relay** (dem Dienst, der zur TRM-Webseite gehört).
Die Webseite wird allein anhand dieser Datei und `docs/remote-api.schema.json` gebaut. Die App-Seite ist fertig und getestet
(`packages/remote`).

- **Protokollversion:** `protocolVersion: 1` (kleinste von der App verstandene: `minProtocolVersion: 1`)
- **Maschinenlesbar:** [`remote-api.schema.json`](remote-api.schema.json) (JSON-Schema aller Nachrichten, erzeugt aus `packages/remote/src/protocol.ts`; ein Test schlägt an, wenn die Datei veraltet ist)
- **Referenz zum Ausprobieren:** `scripts/mock-site.cjs` (Mock-Relay, `MODE=ws` oder `MODE=poll`)

## Überblick

```
TRM-Craft (Laptop)  ──── ausgehende, verschlüsselte Verbindung ───▶  TRM-Relay
                     ◀─── Befehle, Uploads ─────────────────────────
                     ──── Antworten, Schnappschüsse, Ereignisse ───▶
```

- Die App verbindet sich **selbst und ausgehend**. Auf dem Laptop ist keine Portfreigabe nötig.
- Standard ist **WebSocket (wss)**. Sind WebSockets blockiert, schaltet die App automatisch auf **HTTPS-Long-Polling** um (Abschnitt 3).
  Beide Wege tragen exakt dieselben JSON-Nachrichten.
- Alle Funktionen laufen intern über die **Command-API** (`packages/core/src/commands.ts`). Was die lokale Oberfläche kann, kann
  die Webseite auch, mit den unten genannten Ausnahmen.
- Jede Nachricht ist ein JSON-Objekt mit dem Feld `type`.
- Die Relay-URL ist in der App unter *Einstellungen → Fernzugriff* eintragbar, z. B. `wss://relay.<deine-trm-domain>`.
  Es gibt keinen fest eingebauten Standard, weil die Domain nicht im Code stehen soll.
- In der Titelleiste der App steht **"Mit TRM-Seite verbunden"** (bzw. "Verbunden (Polling)" / "TRM-Seite getrennt").

## 1. Kopplung

Es gibt zwei Wege. Beide enden mit einem **Geräte-Token**, das die App verschlüsselt speichert (Windows-DPAPI über Electron `safeStorage`;
ohne verfügbare Verschlüsselung wird nichts gespeichert). Die Webseite sollte das Token nur gehasht speichern und widerrufen können.

### Weg A: Die Webseite zeigt einen Code, der in der App eingegeben wird

1. Der Nutzer öffnet auf der Webseite "Gerät koppeln". Die Webseite erzeugt einen **Code** (4 bis 24 Zeichen `A-Za-z0-9-`,
   z. B. `K7QM-29XD`), kurz gültig (z. B. 10 Minuten) und einmalig verwendbar.
2. Der Nutzer trägt Relay-Adresse und Code in der App ein. Die App sendet:

```http
POST https://<host>/api/devices/pair
Content-Type: application/json

{ "code": "K7QM-29XD", "deviceName": "Max Laptop", "appVersion": "1.4.2", "protocolVersion": 1 }
```

3. Antwort bei Erfolg (`200`):

```json
{ "deviceToken": "<mind. 16 Zeichen, zufällig>", "deviceId": "dev_123", "siteName": "TRM", "perms": { "upload": true } }
```

   Fehler `400`, `404` oder `410` bedeuten "Code falsch oder abgelaufen".

### Weg B: Die App zeigt einen Code, der auf der Webseite eingegeben wird

```http
POST https://<host>/api/devices/pair/start
{ "deviceName": "Max Laptop", "appVersion": "1.4.2", "protocolVersion": 1 }
```

```json
{ "code": "WXYZ-9876", "pollId": "poll-abcdef12", "expiresInSec": 600 }
```

Die App zeigt den Code an und fragt alle 2 Sekunden:

```http
GET https://<host>/api/devices/pair/status?pollId=poll-abcdef12
```

```json
{ "status": "pending" }
```

Hat der Nutzer den Code auf der Webseite bestätigt, antwortet die Webseite mit `{ "status": "paired", "deviceToken": "...", "deviceId": "...", "siteName": "TRM", "perms": { "upload": true } }`.
`410` oder `404` bedeutet "abgelaufen".

Die HTTP-Adresse leitet die App aus der Relay-Adresse ab (`wss://host/...` → `https://host`).

## 2. Verbindung per WebSocket

```
wss://<host>/<agent-pfad>
Authorization: Bearer <deviceToken>
```

- Nur `wss://` (`ws://` nur für `localhost`).
- Ist das Token ungültig, schließt das Relay mit dem **Close-Code `4401`** (oder `4403`). Die App verbindet dann nicht erneut
  und zeigt "Koppel das Gerät neu".
- **Neuverbinden:** bei jedem anderen Ende nach 1 s, 2 s, 4 s ... bis maximal 60 s (mit Zufallsanteil). Nach erfolgreichem Aufbau beginnt die Zählung neu.
- **Heartbeat:** Die App sendet alle **30 Sekunden** ein WebSocket-Ping. Kommt 90 s lang nichts an, baut sie neu auf.
  Das Relay kann zusätzlich `{ "type": "ping" }` senden und erhält `{ "type": "pong" }`.
- Maximale Nachrichtengröße 8 MB.

### Webseite → App: `welcome` (empfohlen, direkt nach `hello`)

```json
{ "type": "welcome", "protocolVersion": 1, "minProtocolVersion": 1, "siteName": "TRM" }
```

Verlangt das Relay eine neuere Protokollversion, als die App kennt (`minProtocolVersion > ` App-Version), oder ist es zu alt,
beendet die App die Verbindung und meldet "App und Webseite sprechen unterschiedliche Protokollversionen. Bitte TRM-Craft aktualisieren."

### App → Webseite: `hello`

Direkt nach dem Verbinden:

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "minProtocolVersion": 1,
  "deviceId": "dev_123",
  "deviceName": "Max Laptop",
  "appVersion": "1.4.2",
  "platform": "win32",
  "canUpload": true,
  "transport": "websocket",
  "servers": [ { "id": "survival-3f2a", "name": "Survival", "edition": "java", "loader": "paper", "mcVersion": "1.21.4", "status": "running", "players": ["Alex"], "port": 25565, "uptimeMs": 120000, "cpu": 38.5, "ramMb": 2210, "tps": 19.9 } ]
}
```

Nach `hello` sollte das Relay wartende Uploads für dieses Gerät senden (Abschnitt 6).

## 3. Fallback: HTTPS-Long-Polling

Kommt über WebSocket dreimal hintereinander keine Verbindung zustande (z. B. Firmen-Proxy), nutzt die App **HTTPS-Long-Polling**.
Nach 5 Minuten versucht sie wieder einen WebSocket. In der Titelleiste steht dann "Verbunden (Polling)", `hello.transport` ist `"polling"`.

Alle Anfragen tragen `Authorization: Bearer <deviceToken>`. `401`/`403` bedeuten "Gerät abgelehnt" (wie Close-Code 4401).

```http
POST https://<host>/api/agent/session            {}                       -> { "sessionId": "sess-1234abcd" }
GET  https://<host>/api/agent/poll?session=ID&wait=25                     -> { "messages": [ <Webseite→App-Nachrichten> ] }
POST https://<host>/api/agent/send?session=ID    { "messages": [ ... ] }  -> 204   (App→Webseite-Nachrichten, gebündelt)
```

- `poll` wartet bis zu `wait` Sekunden (die App sendet 25). Kommen keine Nachrichten, antwortet das Relay mit `{ "messages": [] }`.
  Jede erfolgreiche Antwort gilt als Lebenszeichen.
- Die Nachrichten sind exakt dieselben wie über WebSocket. `messages` enthält JSON-Objekte (Webseite → App) bzw. die App sendet sie als JSON-Objekte.
- Ein neuer `poll` startet sofort nach jeder Antwort. Das Relay sollte pro Sitzung höchstens eine offene `poll`-Anfrage zulassen.

## 4. Befehle

### Webseite → App

```json
{ "type": "cmd", "id": "req-1", "command": "servers.start", "args": "survival-3f2a", "role": "moderator", "user": "Maxi" }
```

| Feld | Bedeutung |
|---|---|
| `id` | Anfrage-ID (4 bis 64 Zeichen `A-Za-z0-9_-`), kommt in der Antwort zurück |
| `command` | Befehlsname (siehe `CommandMap` in `packages/core/src/commands.ts`) |
| `args` | Argumente, Form je Befehl |
| `role` | Rolle des Nutzers auf der Webseite: `owner`, `admin`, `moderator`, `viewer` |
| `user` | optional, Anzeigename |

### App → Webseite

```json
{ "type": "res", "id": "req-1", "ok": true, "result": null }
{ "type": "res", "id": "req-1", "ok": false, "error": "Dafür fehlt die Berechtigung.", "code": "forbidden" }
```

`error` ist ein deutscher Text für Menschen. **Für Programmlogik gilt `code`:**

| `code` | Bedeutung |
|---|---|
| `disabled` | Fernzugriff ist in der App ausgeschaltet |
| `unknown_command` | Befehl existiert nicht |
| `local_only` | Befehl ist aus der Ferne grundsätzlich gesperrt |
| `forbidden` | Rolle reicht nicht (auch nach der lokalen Obergrenze) |
| `invalid_args` | Argumente oder Pfade ungültig |
| `not_found` | Server, Datei oder Backup nicht gefunden |
| `conflict` | existiert bereits |
| `server_running` | Aktion braucht einen gestoppten Server |
| `no_permission` | Gerät hat kein Upload-Recht |
| `too_large` | über dem Größenlimit |
| `unsupported_type` | Dateityp oder Server-Typ passt nicht |
| `wrong_loader` | Mod/Modpack passt nicht zu Loader oder Version |
| `checksum_mismatch` | SHA-256 stimmt nicht |
| `network` | Verbindungsproblem beim Abruf (z. B. Anbieter nicht erreichbar) |
| `incompatible` | Protokollversionen passen nicht |
| `internal` | alles andere |

### Rechte-System

Jeder Befehl hat eine **Mindestrolle** (`commandRoles` in `packages/core/src/commands.ts`):

| Rolle | Darf unter anderem |
|---|---|
| `viewer` | ansehen: Server, Logs, Spieler, Backups, Statistiken, Mods |
| `moderator` | Server starten/stoppen/neu starten, Konsolenbefehle, Spieleraktionen, Backups erstellen |
| `admin` | Einstellungen, Dateien, Mods/Plugins, Welten, Backups wiederherstellen, Zeitpläne, Netzwerk, Server erstellen |
| `owner` | Server löschen, Firewall, Domain, Welt zurücksetzen |

Zusätzlich gilt eine **lokale Obergrenze** (`maxRole`, Standard `admin`, einstellbar bis höchstens `admin`). Höhere Rollen des Relays werden auf sie gekappt.
**`owner`-Befehle sind aus der Ferne daher nie möglich.**

### Aus der Ferne gesperrte Befehle (`code: local_only`)

- `window.*`, `shell.*`, `dialog.*`, `secrets.*`, `remote.*`
- `updater.installNow`, `updater.skipCountdown`
- `mods.addFiles`, `files.upload`, `worlds.import`, `worlds.export`, `servers.import` (nehmen lokale Dateipfade entgegen, nutze den Upload)
- `net.firewall.add`, `net.firewall.remove` (Windows-Administratorabfrage)

Zusätzlich mit `invalid_args` abgelehnt: `servers.create` mit `worldZip`, `modpacks.install` mit Quelle `file`, `servers.update` mit `patch.backup.dir`.

Die vollständige Liste mit allen Argument- und Ergebnistypen steht in `packages/core/src/commands.ts` (`CommandMap`).

## 5. Status und Ereignisse (App → Webseite)

### Schnappschuss (automatisch)

Beim Verbinden und danach **alle 15 Sekunden** sendet die App den Zustand aller Server, ohne dass die Webseite etwas abonnieren muss:

```json
{
  "type": "snapshot",
  "at": 1767225600000,
  "servers": [
    { "id": "survival-3f2a", "name": "Survival", "edition": "java", "loader": "paper", "mcVersion": "1.21.4", "status": "running",
      "players": ["Alex", "Sam"], "port": 25565, "uptimeMs": 3600000, "cpu": 38.5, "ramMb": 2210, "tps": 19.9 },
    { "id": "creative-9c1d", "name": "Creative", "edition": "java", "loader": "fabric", "mcVersion": "1.21.4", "status": "crashed",
      "players": [], "port": 25566, "uptimeMs": null, "crash": { "kind": "port-in-use", "message": "Der Port ist bereits belegt." } }
  ]
}
```

`cpu` ist in Prozent (100 = ein voller Kern), `tps` gibt es bei Paper und Purpur.

### Live-Ereignisse zu Spielern und Server (automatisch)

Joins, Verlassen, Start, Stopp und Abstürze kommen **immer**, ohne Abo:

```json
{ "type": "event", "event": "servers.event", "payload": { "id": "survival-3f2a", "name": "Survival", "kind": "join", "player": "Alex" } }
{ "type": "event", "event": "servers.event", "payload": { "id": "creative-9c1d", "name": "Creative", "kind": "crashed", "detail": "Der Port ist bereits belegt." } }
```

`kind`: `started`, `stopped`, `crashed`, `join`, `leave`.

### Weitere Ereignisse (per Abo)

```json
{ "type": "subscribe", "events": ["servers.status", "servers.log", "servers.stats", "servers.progress", "remote.upload"], "serverIds": ["survival-3f2a"] }
```

`serverIds` ist optional (ohne Angabe: alle). Ein neues `subscribe` ersetzt das vorherige. Das Abo gilt nur für die aktuelle Verbindung.

| Ereignis | Nutzlast |
|---|---|
| `servers.status` | `ServerView` (vollständiger Server-Zustand) |
| `servers.removed` | Server-ID |
| `servers.log` | **gebündelt** (alle 250 ms, höchstens 500 Zeilen): `{ "id": "...", "lines": ["...", "..."] }` |
| `servers.stats` | `{ id, sample: { t, cpu, ramMb, players, tps? } }` (alle 5 s je laufendem Server) |
| `servers.progress` | `{ token, label, percent }` (Erstellen, Downloads) |
| `remote.upload` | `UploadRecord` (Fortschritt und Ergebnis von Uploads) |

### Sitzungen anzeigen

Das Relay kann der App melden, wer verbunden ist. Die App zeigt die Liste unter *Fernzugriff*:

```json
{ "type": "sessions", "list": [ { "id": "sess_1", "name": "Maxi (Chrome)", "role": "admin", "since": 1767225600000 } ] }
```

## 6. Datei-Upload (Mods, Plugins, Modpacks, Welten, Packs)

Du lädst auf der TRM-Seite eine Datei hoch, sie landet im richtigen Ordner des richtigen Servers auf dem Laptop.
Voraussetzung: Das Gerät hat beim Koppeln das **Upload-Recht** (`perms.upload`).

### Variante A: Übertragung in Stücken über die bestehende Verbindung

```json
{ "type": "upload.begin", "uploadId": "upl-0001", "serverId": "survival-3f2a", "fileName": "sodium.jar", "size": 1048576, "sha256": "<64 hex>", "restartAfter": true, "uploader": "Maxi" }
{ "type": "upload.ready", "uploadId": "upl-0001", "received": 0 }
{ "type": "upload.chunk", "uploadId": "upl-0001", "offset": 0, "data": "<Base64, empfohlen 512 KB bis 1 MB roh>" }
{ "type": "upload.ack", "uploadId": "upl-0001", "received": 524288 }
{ "type": "upload.end", "uploadId": "upl-0001" }
{ "type": "upload.done", "uploadId": "upl-0001", "kind": "mod", "warnings": [] }
{ "type": "upload.failed", "uploadId": "upl-0001", "error": "Die Prüfsumme stimmt nicht überein. Die Datei wurde nicht installiert.", "code": "checksum_mismatch" }
```

Regeln:

- `uploadId`: 4 bis 64 Zeichen `A-Za-z0-9_-`, vom Relay vergeben.
- `sha256`: Prüfsumme der **ganzen** Datei (hex). Pflicht. Stimmt sie nicht, wird **nichts installiert**.
- **Fortsetzen:** Bricht die Verbindung ab, sendet das Relay nach dem Neuverbinden dasselbe `upload.begin` erneut (gleiche `uploadId`, `size`, `sha256`).
  Die App antwortet mit `received` = bereits vorhandene Bytes. Das gilt auch nach einem Neustart der App.
- **Reihenfolge:** Ein Stück wird nur angenommen, wenn `offset == received`. Sonst antwortet die App mit `upload.ack { received }`, und das Relay sendet ab dort erneut.
- `upload.end` bei unvollständiger Datei: Die App antwortet mit `upload.ack` statt zu beenden.
- Abbrechen: `{ "type": "upload.cancel", "uploadId": "..." }`.
- Fortschritt: aus den `upload.ack`. In der App erscheint er live im Upload-Verlauf (Ereignis `remote.upload`).

### Variante B: App lädt selbst herunter (große Dateien)

```json
{ "type": "upload.fetch", "uploadId": "upl-0002", "serverId": "survival-3f2a", "fileName": "pack.mrpack", "size": 123456789, "sha256": "<64 hex>", "url": "https://<host>/files/abc?sig=...", "restartAfter": false, "uploader": "Maxi" }
```

- Die App lädt **nur** von `https://` und **nur vom Host der verbundenen Webseite**.
- Nach Prüfung von Größe und SHA-256 antwortet sie mit `upload.done` bzw. `upload.failed`. **Erst danach** darf das Relay die Zwischendatei löschen.
- Die Adresse sollte kurzlebig signiert sein.

### Warteschlange (Laptop aus oder offline)

Das Relay hält Uploads in einer Warteschlange und startet sie, sobald das Gerät `hello` sendet.
Die App führt selbst keine Warteschlange für das Relay.

### Wohin landet die Datei?

| Datei | Ziel | Prüfung |
|---|---|---|
| `.jar` | `mods/` (Fabric, Quilt, Forge, NeoForge) oder `plugins/` (Paper, Purpur, Folia, Spigot, Proxys) | Loader wird aus der JAR erkannt. **Passt er nicht, wird nicht installiert** (`wrong_loader`). Nicht erkennbar: Installation mit Warnung. |
| `.mrpack` | wird in den Server entpackt | Loader und Minecraft-Version müssen passen (`wrong_loader`). Vorher automatisches Backup (für "Rückgängig"). |
| `.zip` mit `level.dat` | neuer Welt-Ordner | Server muss gestoppt sein (`server_running`). |
| `.zip` mit `pack.mcmeta` | `<Welt>/datapacks/` | – |
| `.mcpack`, `.mcaddon` | `behavior_packs/` bzw. `resource_packs/` | nur Bedrock-Server |

Andere Endungen: `unsupported_type`.

### Sicherheit

- Erlaubte Typen: `.jar`, `.zip`, `.mrpack`, `.mcpack`, `.mcaddon`. Größenlimit in der App einstellbar (Standard 1024 MB, `too_large`).
- Dateinamen werden bereinigt, nichts wird außerhalb des Server-Ordners gespeichert, vorhandene Dateien werden nie überschrieben (`conflict`).
- Nur Geräte mit Upload-Recht (`no_permission`).

### Verlauf und Rückgängig

Jeder Upload erscheint in der App unter *Einstellungen → Fernzugriff → Upload-Verlauf* (Name, Server, Zeit, Absender `uploader`, Ergebnis) mit **Rückgängig**:
Dateien werden gelöscht, Modpacks per Backup wiederhergestellt (Server gestoppt). Ein Neustart (`restartAfter`, mit 30 s Chat-Ankündigung) wird nicht zurückgenommen.

## 7. Versionierung

- `protocolVersion` steht in `hello` (App) und `welcome` (Relay). Sie erhöht sich nur bei **inkompatiblen** Änderungen.
- Neue optionale Felder und neue Nachrichtentypen sind keine inkompatiblen Änderungen. **Unbekannte Nachrichten und Felder werden ignoriert.**
- `minProtocolVersion` nennt die älteste Version, die die jeweilige Seite noch versteht.

## 8. Minimaler Test-Ablauf

1. Relay erzeugt Code, App koppelt (Weg A) oder zeigt Code (Weg B).
2. App verbindet (WebSocket, sonst Polling) und sendet `hello` und `snapshot`.
3. Relay sendet `welcome` und `{ "type": "subscribe", "events": ["servers.status"] }`.
4. Relay sendet `{ "type": "cmd", "id": "req-1", "command": "servers.list", "role": "viewer" }` und erhält die Serverliste.
5. Relay sendet einen Upload (Variante A) und erhält `upload.done`.

`scripts/mock-site.cjs` spielt genau das durch (`MODE=ws` und `MODE=poll`). Die Tests stehen in `packages/remote/src/`.
