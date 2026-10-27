# Schnobbis Quiz 🎯

Allgemeinwissen-Quiz für den Spieleabend – **selbst gehostet, und jeder spielt mit dem eigenen Handy.**

Der Spielleiter erstellt ein Spiel, alle anderen scannen den QR-Code und sind dabei. Fragen, Lösungen, Buzzer und Punkte laufen live über WebSockets. Jedes Spiel landet in einer Statistik mit ewiger Bestenliste.

Weiterentwicklung der Quiz-PWA aus [lenegoeslean/Schnobsi-quiz](https://github.com/lenegoeslean/Schnobsi-quiz). Alle 500 Fragen, 70 Duell-Paare und alle Spielregeln von dort sind übernommen.

---

## Was kann es?

- **4 Spielmodi**
  - 🎯 **Klassik:** Reihum bekommt jeder eine eigene Frage. Der Spielleiter deckt auf und wertet.
  - ⚔️ **Duell:** Zwei Spieler bekommen vergleichbare Fragen zum gleichen Thema. Ist nur einer richtig, gibt es +1.
  - 🔔 **Buzzer** *(neu)*: Alle sehen die Frage, wer zuerst buzzert, antwortet. Bei falscher Antwort ist man für die Frage gesperrt und der Buzzer öffnet sich wieder.
  - ✍️ **Alle tippen** *(neu)*: Jeder tippt seine Antwort ins Handy. Der Spielleiter sieht alle Antworten mit automatischem Vorschlag (Tippfehler-tolerant) und bestätigt mit einem Tipp.
- **Alle Regeln aus dem Original:** Fragen pro Spieler, Schwierigkeit (einzeln/kombiniert), 📈 Steigend, 💎 Schwer zählt mehr, 🏷️ Kategorien, ⏱️ Timer, 🃏 Joker, 🔥 Serien-Bonus, 🫳 Klauen, 🎉 Finale doppelt, Punkte korrigieren, Rückgängig, Spiel beenden.
- **Handys und Weitergeben gemischt:** Spieler ohne Handy trägt der Spielleiter einfach selbst ein.
- **📺 TV-Ansicht** für Fernseher oder Beamer unter `/tv/CODE`.
- **Robust:** Seite neu laden, Sperrbildschirm oder WLAN-Wechsel? Man ist sofort wieder drin. Handy-Akku leer? Mit einem anderen Gerät auf „Ich bin …“ tippen. Server-Neustart? Laufende Spiele bleiben erhalten.
- **Fair:** Die Lösung verlässt den Server erst, wenn sie aufgedeckt ist – außer zum Spielleiter. Das ist durch Tests abgesichert.
- **📊 Statistik:** ewige Bestenliste, Punkteverlauf, Stärken und Schwächen pro Kategorie, schwerste Fragen nach echter Trefferquote, jedes Spiel im Detail, Rekorde auf dem Endscreen.
- **🗂️ Fragenverwaltung im Browser** unter `/admin` – suchen, anlegen, bearbeiten, Duell-Paare, Import/Export. Ohne Code.
- **REST-API** für Automatisierungen (z. B. n8n).
- **Datensparsam:** keine externen Abrufe, Schriften liegen lokal, keine Cookies, kein Tracking.

---

## Schnellstart

Voraussetzung: Docker mit Compose.

```bash
mkdir schnobbis-quiz && cd schnobbis-quiz
curl -O https://raw.githubusercontent.com/ex0th/schnobbis-quiz/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/ex0th/schnobbis-quiz/main/.env.example
# .env öffnen: ADMIN_TOKEN und PUBLIC_URL setzen
docker compose up -d
```

Dann `http://<server>:8080` öffnen. Beim ersten Start werden die Fragen automatisch in die Datenbank geladen.

Selbst bauen statt Image ziehen: Repo klonen, in `docker-compose.yml` `image:` durch `build: .` ersetzen, `docker compose up -d --build`.

Das Image wird bei jedem Push auf `main` von GitHub Actions gebaut (amd64 + arm64, läuft also auch auf dem Raspberry Pi) und liegt unter `ghcr.io/ex0th/schnobbis-quiz`.

> **Hinweis zum Image:** Falls `docker pull` ein „denied“ meldet, ist das Paket auf GitHub noch privat. Einmal unter *Profil → Packages → schnobbis-quiz → Package settings → Change visibility* auf „Public“ stellen.

### Einstellungen (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `ADMIN_TOKEN` | leer | Passwort für `/admin` und die Fragen-API. Leer = Verwaltung aus. Erzeugen: `openssl rand -base64 24` |
| `PUBLIC_URL` | leer | Adresse im QR-Code, z. B. `https://quiz.example.de`. Leer = aus der Anfrage abgeleitet |
| `TRUST_PROXY` | `false` | `true` hinter einem Reverse Proxy (wertet `X-Forwarded-*` aus) |
| `ROOM_TTL_HOURS` | `12` | Spielräume ohne Aktivität werden danach gelöscht |
| `MAX_ROOMS` | `200` | Obergrenze gleichzeitiger Spielräume |
| `PORT` | `8080` | Port im Container |
| `DATA_DIR` | `/data` | Ort der SQLite-Datenbank (Volume) |

### Hinter einem Reverse Proxy

Wichtig ist nur, dass **WebSockets auf `/ws`** durchgereicht werden.

**Caddy** (WebSockets gehen automatisch):

```caddy
quiz.example.de {
    reverse_proxy schnobbis-quiz:8080
}
```

**Traefik** (Labels im Compose-File, WebSockets gehen automatisch):

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.quiz.rule=Host(`quiz.example.de`)
      - traefik.http.routers.quiz.entrypoints=websecure
      - traefik.http.routers.quiz.tls.certresolver=letsencrypt
      - traefik.http.services.quiz.loadbalancer.server.port=8080
```

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
}
```

HTTPS ist empfehlenswert: Nur dann lassen sich Wake-Lock (Bildschirm bleibt an) und „Zum Home-Bildschirm“ auf allen Handys nutzen.

### Backup

Alles steckt in einer Datei: `/data/quiz.db` (SQLite). Zum Sichern im laufenden Betrieb:

```bash
docker compose exec quiz node -e "new (require('node:sqlite').DatabaseSync)('/data/quiz.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp quiz:/data/backup.db ./quiz-backup-$(date +%F).db
```

Nur die Fragen sichern: in `/admin` unter *Import* → *Fragen exportieren* (JSON).

---

## Spielen

1. **Spielleiter:** Startseite → *Neues Spiel leiten*. Es erscheinen Code und QR-Code.
2. **Mitspieler:** QR-Code scannen oder auf der Startseite den 4-stelligen Code eingeben, Namen und Tier wählen.
3. Spieler ohne Handy trägt der Spielleiter unter *Spieler ohne Handy* ein. Wer selbst mitspielen will, tippt auf *Ich spiele selbst mit*.
4. Modus und Regeln einstellen, *Spiel starten*.

Tipps:
- Auf den Punktestand tippen öffnet das Menü: Punkte von Hand korrigieren, Rückgängig, Spiel beenden, TV-Ansicht, Nachzügler einladen.
- Bei *Buzzer* und *Alle tippen* können Nachzügler mitten im Spiel einsteigen.
- Im *Buzzer*-Modus kann der Spielleiter für Spieler ohne Handy buzzern („hat sich gemeldet“).
- Gespielte Fragen kommen erst wieder, wenn alle Fragen der gewählten Auswahl durch sind. Zurücksetzen geht in der Lobby.
- Die Statistik erkennt Spieler am Namen. Wer mal „Ben“ und mal „Benni“ tippt, lässt sich in `/admin` → *Spieler* zusammenlegen.

---

## Fragen pflegen

**Im Browser:** `/admin` öffnen, mit dem `ADMIN_TOKEN` anmelden. Dort kann man Fragen suchen, anlegen, bearbeiten und deaktivieren, Duell-Paare anlegen sowie alles als JSON exportieren und importieren. Fragen werden nie gelöscht, nur deaktiviert, damit die Statistik vollständig bleibt.

Lösungen dürfen Alternativen in Klammern enthalten, etwa `Nil (Amazonas auch gelten lassen)`. Der Antwort-Vorschlag bei *Alle tippen* berücksichtigt sie.

**Per Datei:** `data/questions.json` wird nur beim allerersten Start geladen. Für spätere Massen-Imports:

```bash
docker compose cp fragen.json quiz:/data/fragen.json
docker compose exec quiz node --disable-warning=ExperimentalWarning scripts/import-questions.js /data/fragen.json
```

Format (Fragen mit vorhandener `id` werden aktualisiert, ohne `id` neu angelegt):

```json
{
  "questions": [
    { "question": "Was ist die Hauptstadt von Kroatien?", "answer": "Zagreb", "category": "Geografie", "difficulty": 2 }
  ],
  "pairs": [
    { "topic": "Hauptstädte Balkan", "a": 501, "b": 502 }
  ]
}
```

`difficulty`: 1 = Leicht, 2 = Mittel, 3 = Schwer. Unbekannte Kategorien werden automatisch angelegt.

---

## API

Lesen ist offen, Schreiben braucht `Authorization: Bearer <ADMIN_TOKEN>`.

| Methode & Pfad | Zweck |
|---|---|
| `GET /api/meta` | Kategorien, Anzahl Fragen, Voreinstellungen |
| `GET /api/stats` | Übersicht, Bestenliste, Kategorien, schwerste Fragen, letzte Spiele |
| `GET /api/stats/players/:id` | Details zu einem Spieler |
| `GET /api/stats/games?limit=&offset=` | Spiele |
| `GET /api/stats/games/:id` | Ein Spiel mit allen Antworten |
| `GET /api/stats/export` | Statistik als JSON |
| `GET /api/questions?search=&category=&difficulty=&active=&limit=&offset=` 🔑 | Fragen suchen |
| `POST /api/questions` 🔑 | Eine Frage (Objekt) oder viele (Array) anlegen |
| `PATCH /api/questions/:id` 🔑 | Frage ändern, z. B. `{ "active": false }` |
| `DELETE /api/questions/:id` 🔑 | Frage deaktivieren |
| `GET/POST /api/pairs`, `PATCH/DELETE /api/pairs/:id` 🔑 | Duell-Paare |
| `GET /api/export`, `POST /api/import` 🔑 | Alles als JSON |
| `POST /api/people/merge` 🔑 | `{ "from": 7, "into": 3 }` Spieler zusammenlegen |
| `GET /healthz` | Health-Check |

Beispiel: Frage aus einer Automatisierung anlegen.

```bash
curl -X POST https://quiz.example.de/api/questions \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"Wie viele Herzen hat ein Oktopus?","answer":"3","category":"Natur","difficulty":3,"source":"n8n"}'
```

In **n8n** reicht dafür ein *HTTP Request*-Node mit *Header Auth*. `source` hilft später beim Filtern, woher eine Frage kam.

---

## Entwicklung

```bash
npm install
npm run dev     # http://localhost:8080, startet bei Änderungen neu
npm test        # Engine-Tests + echte WebSocket-Spiele mit 1 Host und 3 Handys
```

Benötigt Node.js ≥ 22.13 (im Image: Node 24). Abhängigkeiten: nur `ws` und `uqr` (QR-Codes). SQLite ist in Node eingebaut, es gibt keine nativen Module und keinen Build-Schritt.

```
server/
  engine.js     Spiellogik als reine Zustandsübergänge (alle Modi, Punkte, Undo)
  view.js       Was darf welches Gerät sehen? (Lösung erst nach dem Aufdecken)
  rooms.js      Spielräume, WebSocket-Protokoll, Reconnect, Persistenz
  questions.js  Fragen, Duell-Paare, Auswahl ohne Wiederholung, Import/Export
  stats.js      Spiele speichern und auswerten
  api.js        REST-API
public/
  js/views/     Startseite, Spiel (Spielleiter/Handy/TV), Statistik, Verwaltung
data/questions.json   Startbestand: 500 Fragen, 70 Duell-Paare
```

Der Service Worker versioniert sich selbst: Der Server berechnet beim Start einen Hash über alle Dateien in `public/`. Keine Versionsnummer mehr von Hand hochzählen.

---

## Lizenz

Noch offen – Fragen und Grundidee stammen aus dem gemeinsamen Ursprungsprojekt. Schriften: Inter und Montserrat unter SIL Open Font License (`public/fonts/OFL-*.txt`).
