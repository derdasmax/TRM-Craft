# Remote-API (Webseite ↔ TRM-Craft-App)

Die App bringt ihren **eigenen API-Server** mit (HTTPS-REST + WebSocket, gebaut mit Fastify). Er läuft, solange die App läuft, und
braucht **keinen externen Server**. Die TRM-Webseite (oder jeder andere Client) spricht direkt mit der App auf deinem Laptop.
Diese Datei ist der vollständige Vertrag. Die Webseite lässt sich allein danach bauen.

- **Protokollversion:** `protocolVersion: 2` (`GET /api/v1/info` nennt `protocolVersion` und `minProtocolVersion`)
- **Maschinenlesbar:** [`remote-api.schema.json`](remote-api.schema.json), erzeugt aus `packages/remote/src/protocol.ts`
  (ein Test schlägt an, wenn die Datei veraltet ist: `UPDATE_SCHEMA=1 pnpm test` erzeugt sie neu)
- **Beispiel-Client zum Ausprobieren:** `node scripts/demo-site.mjs --api http://127.0.0.1:47821 --origin https://trm.beispiel.de --code ABCD-2345`
- Basis-Pfad aller Endpunkte: `/api/v1`

## 1. Überblick und Erreichbarkeit

```
Browser ──▶ TRM-Webseite ──(Gerät-Token, nur Backend)──▶ https://craft.<deine-domain>/api/v1 ──Cloudflare Tunnel──▶ 127.0.0.1:47821 (App)
Browser ───────────────(Sitzungs-Token, kurzlebig)────▶ https://craft.<deine-domain>/api/v1/ws  (WebSocket)
```

| Modus | Erreichbar über | Lauscht auf | TLS |
|---|---|---|---|
| `tunnel` (Standard) | **Cloudflare Tunnel** (`cloudflared`, kostenlos). Der Assistent in der App richtet ihn ein. | nur `127.0.0.1` | durch Cloudflare |
| `direct` | Portfreigabe im Router | `0.0.0.0` | **eigenes Zertifikat** (PEM-Dateien, z. B. von Let's Encrypt). Die App stellt keines aus. |

Ist der Fernzugriff ausgeschaltet, antwortet die API mit `503 disabled`. In der Titelleiste der App steht **„Fernzugriff aktiv“**,
solange der Server läuft. In den Einstellungen siehst du Tunnelstatus, Adresse, gekoppelte Geräte und verbundene Sitzungen.

### Einrichtung des Tunnels (Assistent in der App)

*Einstellungen → Netzwerk:* Cloudflare-API-Token speichern (Rechte: **Konto → Cloudflare Tunnel: Bearbeiten**, **Zone → DNS: Bearbeiten**, **Konto: Lesen**).
*Einstellungen → Fernzugriff → Cloudflare-Tunnel:* Domain und Namen (z. B. `craft` + `meinedomain.de`) eingeben und **Tunnel einrichten**. Die App

1. prüft den Token und findet die Zone der Domain,
2. legt (oder findet) den Tunnel `TRM-Craft`, setzt die Weiterleitung `craft.meinedomain.de → http://127.0.0.1:<Port>` (alles andere liefert 404),
3. legt den DNS-Eintrag `craft.meinedomain.de` als **CNAME auf `<tunnel-id>.cfargotunnel.com`** an,
4. lädt `cloudflared` (von GitHub, mit Prüfsumme) und startet es mit dem Tunnel-Token **über die Umgebung** (nicht über die Kommandozeile).

Optional **„Als Windows-Dienst einrichten“** (UAC-Abfrage): Der Tunnel läuft dann auch ohne die App. Die API antwortet erst, wenn die App läuft.
Der Tunnel-Token liegt verschlüsselt im Windows-Anmeldeinformations-Speicher der App (DPAPI über Electron `safeStorage`).

## 2. Sicherheitsregeln der API

- **Origin/CORS:** Nur Origins aus *Einstellungen → Fernzugriff → Erlaubte Webseiten* (exakt, `https://…`; `*` ist nicht möglich). Fremde Origins erhalten `403 origin_not_allowed`
  ohne CORS-Header. Anfragen ohne `Origin` (Server-zu-Server) sind erlaubt, brauchen aber trotzdem ein Token.
  Preflight (`OPTIONS`) wird für erlaubte Origins mit `204` beantwortet (`authorization`, `content-type`).
- **Host-Header:** Nur `127.0.0.1`/`localhost` und der konfigurierte Hostname (Tunnel-Adresse). Sonst `421 host_not_allowed`.
- **Tokens:** Gerät-Token `trd_…` (lang lebend, nur für das Backend der Webseite) und Sitzungs-Token `trs_…` (kurz lebend, für Browser).
  Die App speichert nur **SHA-256-Hashes** der Geräte-Token. Header: `Authorization: Bearer <token>`.
- **Rollen:** `viewer` < `moderator` < `admin`. `owner`-Befehle und lokale Befehle (Fenster, Dialoge, Geheimnisse, lokale Dateipfade,
  Firewall, Installation von Updates, lokaler Datei-Upload) sind **nie** aus der Ferne möglich (`403 local_only`). Die Rolle einer Sitzung ist
  `min(angefragte Rolle, Rolle des Geräts, Obergrenze in der App)`.
- **Drosselung:** Falsche Kopplungscodes: 8 Fehlversuche je IP in 10 Minuten, danach `429`; nach 10 Fehlversuchen wird der Code ungültig.
  Dazu Limits je Gerät und Sitzung. Hinter dem Tunnel gilt die echte IP aus `CF-Connecting-IP` (nur wenn die Verbindung von `127.0.0.1` kommt).
- **Widerruf:** In der App lässt sich jedes Gerät widerrufen. Dabei enden seine Sitzungen sofort und WebSocket-Verbindungen werden geschlossen (`4401`).
  Ein Neustart der App beendet alle Sitzungen.

## 3. Fehlerformat und Codes

Jeder Fehler ist JSON mit passendem HTTP-Status:

```json
{ "ok": false, "error": "Dafür fehlt die Berechtigung.", "code": "forbidden" }
```

| `code` | HTTP | Bedeutung |
|---|---|---|
| `unauthorized` | 401 | Token fehlt, ungültig oder abgelaufen; falscher/abgelaufener Kopplungscode |
| `disabled` | 503 | Fernzugriff ist in der App ausgeschaltet |
| `origin_not_allowed` | 403 | Origin ist nicht freigegeben |
| `host_not_allowed` | 421 | unerwarteter Host-Header |
| `rate_limited` | 429 | zu viele Anfragen oder Fehlversuche |
| `unknown_command` | 404 | Befehl existiert nicht |
| `local_only` | 403 | Befehl ist aus der Ferne gesperrt |
| `forbidden` | 403 | Rolle reicht nicht |
| `invalid_args` | 400 | Argumente ungültig |
| `not_found` | 404 | Server/Upload/Pfad nicht gefunden |
| `conflict` | 409 | existiert bereits, oder Upload-Offset passt nicht (`received` in der Antwort) |
| `server_running` | 409 | Server muss dafür gestoppt sein |
| `no_permission` | 403 | Gerät hat kein Upload-Recht |
| `too_large` | 413 | Datei/Anfrage zu groß |
| `unsupported_type` | 415 | Dateityp nicht erlaubt |
| `wrong_loader` | 422 | Mod/Modpack passt nicht zum Loader/zur Version |
| `checksum_mismatch` | 422 | SHA-256 stimmt nicht |
| `network` | 502 | Die App konnte einen Dienst nicht erreichen |
| `incompatible` | 426 | Protokollversionen passen nicht |
| `internal` | 500 | unerwarteter Fehler |

## 4. Kopplung (zwei Wege)

Beide Wege enden mit einem **Gerät-Token**. Die Webseite speichert es **nur im Backend** (verschlüsselt; sie muss es ja senden können, ein Hash genügt dafür nicht).
In der App lässt sich jedes Gerät jederzeit widerrufen.

### Weg A: Die App zeigt einen Code, die Webseite sendet ihn

*Einstellungen → Fernzugriff → „Code in der App anzeigen“* (Upload-Recht wählbar). Format `XXXX-XXXX` (Alphabet ohne `0 O 1 I`), **10 Minuten gültig, einmalig**.

```http
POST /api/v1/pair
Content-Type: application/json

{ "code": "K7QM-29XD", "siteName": "TRM" }
```

```json
{ "deviceToken": "trd_Qm9r…", "deviceId": "dev_3f2a9c1b7e44", "deviceName": "Max Laptop", "perms": { "upload": true }, "maxRole": "admin" }
```

Fehler: `401 unauthorized` (falsch/abgelaufen), `429 rate_limited`.

### Weg B: Die Webseite zeigt einen Code, der in der App eingegeben wird

Der Nutzer gibt in der App Adresse der Webseite und Code ein (*Einstellungen → Fernzugriff → Code der Webseite*). Die Adresse muss unter
**Erlaubte Webseiten** stehen. Die App legt ein Gerät an und sendet das Token **nur an diese Origin**:

```http
POST https://<webseite>/api/trm/claim
Content-Type: application/json

{ "code": "K7QM-29XD", "apiUrl": "https://craft.meinedomain.de", "deviceToken": "trd_Qm9r…", "deviceId": "dev_3f2a9c1b7e44",
  "deviceName": "Max Laptop", "perms": { "upload": true }, "maxRole": "admin", "protocolVersion": 2 }
```

Die Webseite antwortet `200` (beliebiger JSON-Body), bei falschem/abgelaufenem Code `404`. Bei jedem Nicht-`2xx` verwirft die App das Gerät wieder.
Die App folgt keinen Weiterleitungen.

## 5. Sitzungen (für Browser)

Browser bekommen **nie** das Gerät-Token. Das Backend der Webseite prüft den eingeloggten Nutzer und holt ein kurzlebiges Sitzungs-Token:

```http
POST /api/v1/sessions
Authorization: Bearer trd_Qm9r…

{ "user": "Maxi", "role": "moderator", "ttlSec": 900 }
```

```json
{ "sessionToken": "trs_8Hq…", "expiresAt": 1795714462606, "role": "moderator", "perms": { "upload": true } }
```

`ttlSec`: 60 bis 3600 (Standard 900). `role` darf `owner` heißen und wird trotzdem auf die erlaubte Rolle begrenzt (siehe Abschnitt 2).
Der Browser nutzt das Token für REST und WebSocket und holt vor Ablauf ein neues.

```http
GET  /api/v1/me                 # Authorization: Bearer <Sitzungs- oder Gerät-Token>
DELETE /api/v1/sessions/current # beendet die Sitzung
```

```json
{ "kind": "session", "role": "moderator", "perms": { "upload": true }, "user": "Maxi", "expiresAt": 1795714462606 }
```

## 6. Befehle (Command-API)

Alle Funktionen der App sind Befehle (`packages/core/src/commands.ts`, jeweils mit Mindestrolle). Die Oberfläche der App nutzt dieselbe Schnittstelle.

```http
POST /api/v1/cmd
Authorization: Bearer trs_8Hq…

{ "command": "servers.start", "args": "survival-3f2a" }
```

```json
{ "ok": true, "result": null }
```

Beispiele: `servers.list` (viewer), `servers.start`/`stop`/`restart` (moderator), `servers.command`, `backups.create`, `files.write` (admin), `mods.install` …
Gesperrte Befehle: `403 local_only`. Fehler: `403 forbidden`, `404 unknown_command`, `400 invalid_args`.

## 7. WebSocket (Live-Daten)

`wss://craft.meinedomain.de/api/v1/ws` (Origin wird geprüft). **Die erste Nachricht muss innerhalb von 5 Sekunden `auth` sein**, sonst schließt die App mit Code `4401`.
Das Token gehört nicht in die URL. Alle Nachrichten sind JSON mit `type`.

Browser → App:

```json
{ "type": "auth", "token": "trs_8Hq…" }
{ "type": "cmd", "id": "req-1", "command": "servers.list" }
{ "type": "subscribe", "events": ["servers.status", "servers.log", "servers.stats"], "serverIds": ["survival-3f2a"] }
{ "type": "ping" }
```

App → Browser:

```json
{ "type": "hello", "protocolVersion": 2, "minProtocolVersion": 2, "appVersion": "1.4.2", "deviceName": "Max Laptop", "role": "moderator", "perms": { "upload": true }, "user": "Maxi",
  "servers": [ { "id": "survival-3f2a", "name": "Survival", "edition": "java", "loader": "paper", "mcVersion": "1.21.1", "status": "running",
                 "players": ["Alex"], "port": 25565, "uptimeMs": 3600000, "cpu": 12.5, "ramMb": 2048, "tps": 19.9 } ] }
{ "type": "res", "id": "req-1", "ok": true, "result": [] }
{ "type": "res", "id": "req-1", "ok": false, "error": "Dafür fehlt die Berechtigung.", "code": "forbidden" }
{ "type": "snapshot", "at": 1795713562606, "servers": [] }
{ "type": "event", "event": "servers.event", "payload": { "id": "survival-3f2a", "name": "Survival", "kind": "join", "player": "Alex" } }
{ "type": "event", "event": "servers.log", "payload": { "id": "survival-3f2a", "lines": ["[12:00:01] Alex joined the game"] } }
{ "type": "pong" }
{ "type": "error", "error": "Sitzung fehlt oder ist abgelaufen.", "code": "unauthorized" }
```

- **`servers.event`** (immer, ohne Abo): `kind` ist `started`, `stopped`, `crashed` (mit `detail`), `join` oder `leave` (mit `player`). Spielerzahl, Abstürze und Beitritte also live.
- **`snapshot`** alle 15 Sekunden mit allen Servern (Status, Spieler, RAM/CPU/TPS).
- Abonnierbar: `servers.status`, `servers.log` (Zeilen gebündelt, höchstens alle 250 ms), `servers.stats`, `remote.upload` u. a. Ohne `serverIds` gilt das Abo für alle Server.
- Die App sendet alle 30 s ein WebSocket-Ping und trennt tote Verbindungen nach 90 s ohne Antwort. Wird eine Sitzung ungültig, schließt sie mit `4401`.

## 8. Uploads (direkt vom Browser)

Dateien gehen **direkt vom Browser zur App** (HTTPS, rohe Chunks, fortsetzbar). Voraussetzungen: Sitzung mit **Upload-Recht** (Gerät beim Koppeln erlaubt), Datei ≤ Upload-Limit der App,
SHA-256 vorab bekannt (im Browser z. B. mit `crypto.subtle.digest`).

1. **Start** (oder **Fortsetzen**: dieselbe `uploadId` erneut senden):

```http
POST /api/v1/uploads
Authorization: Bearer trs_8Hq…

{ "serverId": "survival-3f2a", "fileName": "cool-mod.jar", "size": 1048576, "sha256": "e3b0c4…", "restartAfter": false, "uploadId": "upl-0001" }
```

```json
{ "uploadId": "upl-0001", "received": 0, "chunkSize": 1048576 }
```

   `uploadId` ist optional (4–64 Zeichen `A-Za-z0-9_-`); ohne wird sie abgeleitet. `received` > 0 heißt: ab diesem Byte weitersenden.

2. **Chunks** (rohe Bytes, höchstens 8 MiB je Anfrage, in Reihenfolge):

```http
PUT /api/v1/uploads/upl-0001?offset=0
Content-Type: application/octet-stream
Authorization: Bearer trs_8Hq…

<Bytes>
```

```json
{ "received": 1048576 }
```

   Passt `offset` nicht: `409 conflict` mit `received`. Dann ab `received` neu senden.

3. **Abschluss** (prüft SHA-256 und Typ, installiert):

```http
POST /api/v1/uploads/upl-0001/finish
```

```json
{ "kind": "mod", "warnings": [] }
```

   Weitere: `GET /api/v1/uploads/<id>` (Status), `DELETE /api/v1/uploads/<id>` (abbrechen).

**Typerkennung statt stiller Installation:** Die App erkennt anhand des Inhalts, was die Datei ist (`kind`: `mod`, `plugin`, `modpack`, `world`, `datapack`, `bedrock-pack`),
und prüft den Loader. Passt etwas nicht, gibt es `422 wrong_loader`, bei unklarem Typ eine Warnung in `warnings`. Nichts wird heimlich installiert.
Mods landen in `mods/`, Plugins in `plugins/`. Weltpakete (ZIP mit `level.dat`) werden nur bei gestopptem Server importiert (`409 server_running`) und nicht automatisch aktiviert.
Modpacks legen vorher ein Backup an.
Mit `restartAfter: true` kündigt die App den Neustart im Spielchat an und startet danach neu.

**Schutz:** Dateinamen werden bereinigt, nie wird außerhalb des Server-Ordners geschrieben (auch nicht per ZIP-Pfad), Erweiterungen sind auf
`.jar .zip .mrpack .mcpack .mcaddon` beschränkt, Größenlimit gilt serverseitig.
**Verlauf mit Rückgängig:** *Einstellungen → Fernzugriff → Upload-Verlauf* zeigt Nutzer, Zeit, Datei und Ergebnis und macht Installationen rückgängig
(importierte Dateien entfernen, bei Modpacks das Backup von vorher wiederherstellen).

## 9. Versionierung

- `GET /api/v1/info` (ohne Token, aber mit Origin-Prüfung) liefert `{ name, appVersion, protocolVersion, minProtocolVersion, deviceName, tunnel }`.
- Abwärtskompatible Änderungen (neue Felder/Ereignisse) erhöhen `protocolVersion` nicht. Inkompatible Änderungen führen zu `/api/v2` und erhöhen `protocolVersion`.
  Clients ignorieren unbekannte Felder und Ereignisse.
- Die Webseite prüft `minProtocolVersion <= <ihre Version> <= protocolVersion` und zeigt sonst „Bitte TRM-Craft aktualisieren“.

## 10. Ablauf im Überblick (Beispiel-Client)

`scripts/demo-site.mjs` spielt genau diesen Ablauf nach: `info` → Kopplung (Weg A) → Sitzung → `servers.list` → gesperrter Befehl (`local_only`) →
fremde Origin (`403`) → WebSocket mit `auth`, `subscribe`, `cmd` → Upload in Chunks mit SHA-256 → Sitzung beenden → danach `401`.
