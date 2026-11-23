# Changelog

Was sich für Nutzerinnen und Nutzer von Astro-Magister ändert — nutzernah beschrieben, ohne interne
Ticket-Nummern.

Format: [Keep a Changelog](https://keepachangelog.com/de/1.0.0/); die interne Meilenstein-Historie
dokumentiert ältere Versionen. Ab `1.1` folgt die Nummerierung den öffentlichen Releases; `v3.1`
und `v3.2` darunter tragen noch die interne Meilenstein-Nummer.

## [1.1] — 2026-11-23

Erste öffentliche Fassung. Sie enthält den Stand aus v3.1 und v3.2 (siehe unten) sowie die
Härtung dieses Releases.

### Geändert

- **Klares Verhalten bei Ausfall des Zwischenspeichers:** Fällt der Zwischenspeicher aus, antworten
  Anmeldung, Registrierung und Sitzungserneuerung mit `503` und einem Hinweis, wann es weitergeht —
  statt Anfragen durchzulassen. Sobald der Dienst zurück ist, läuft alles ohne Neustart der API
  weiter, und eine abgemeldete Sitzung wird nicht wieder gültig.
- **KI-Budget bei Ausfall nachvollziehbar:** Die KI-Funktionen antworten weiter; das Tagesbudget
  greift in dieser Zeit eingeschränkt, und jede Einschränkung steht mit benanntem Grund im Log.

### Entfernt

- **Länder-Sperre (GeoIP2):** Die Seite ist weltweit ohne regionale Zugangsbeschränkung erreichbar.
  Die Ländererkennung samt ihrer `GEOIP2_*`-Konfiguration, dem nginx-Modul und dem Aktualisierungs-
  skript für die Datenbank ist entfernt. Wer die Seite aufruft, wird nicht mehr nach seinem Land
  beurteilt.

### Sicherheit

- **Sicherheits-Header auf allen Seiten:** Jede Seite liefert jetzt eine durchsetzende
  Content-Security-Policy sowie `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `frame-ancestors 'none'` und HSTS — auch auf Asset- und API-Pfaden, wo
  eigene Header-Regeln die geerbten sonst verdrängen würden.
- **Abhängigkeiten aus geprüftem Stand:** API und Frontend installieren ausschließlich aus
  versionierten Lock-Dateien; beide Ökosysteme laufen durch ein Audit-Gate. Zum Stand dieses
  Releases: keine Laufzeit-Findings, benannte Ausnahmen sind dokumentiert.
- **Dienste ohne Root-Rechte:** Die Container laufen mit eigenem Benutzer und lesbarem
  Wurzeldateisystem; geschrieben wird nur in den dafür vorgesehenen Verzeichnissen.

## [v3.2] — 2026-11-06

### Hinzugefügt

- **Startseite mit ausgewählten Artikeln:** Die Startseite ist öffentlich und zeigt eine vom Team
  kuratierte Auswahl an Artikeln — mit Bild, Bereich, Kategorie und Anriss. Frisch veröffentlichte
  Artikel tragen ein „Neu"-Kennzeichen.
- **Artikelbilder:** Jeder Artikel kann ein Bild aus einer festen Auswahl an Symbolen und Farben
  bekommen. Fehlt eine Datei, entsteht sie beim ersten Aufruf; Artikel ohne eigene Auswahl erhalten
  ein Standardbild.
- **Datenkästchen am Chart:** Ein Klick neben dem Chartbild öffnet eine Tabelle mit Planetenständen,
  Aspekten und Häusern zum selben Zeitpunkt — ohne dass die KI ein zweites Mal rechnet.
- **Eigene Adressen für die Rechtstexte:** Impressum, Datenschutz und Kontakt sind direkt
  erreichbar und verlinkbar.
- **Auffindbarkeit:** Startseite und Wiki dürfen von Suchmaschinen gefunden werden, Rechner- und
  Verwaltungsseiten nicht. Eine `robots.txt` und eine Sitemap gehören dazu.

### Geändert

- **Adressen und Neuladen:** Jede Seite hat eine eigene Adresse. Ein Neuladen bleibt auf der Seite,
  ein geteilter Link öffnet dieselbe Ansicht, und der Zurück-Knopf führt dorthin zurück, wo man
  herkam — auch beim Wiki-Artikel und beim Admin-Reiter.
- **Ein einziger API-Eingang:** Die Anwendung spricht den Server nur noch über `/api/…` an;
  Entwicklung und Produktion nutzen dieselbe Grenze.
- **Neue Navigation und Hülle:** Eine einheitliche Kopfzeile mit Menü und Gruppen („Auswertungen",
  „Konto"), ein Footer mit dem Rechtlichen und ein Sprunglink für die Tastaturbedienung — auf
  Desktop und Mobil dieselbe Struktur.
- **Anwendernahe KI-Texte:** Die Auswertungen sind knapper und auf die Anwendung bezogen;
  Folgefragen bleiben für Poweruser möglich.
- **Testeinstieg:** Gezielte Testläufe laufen über ein Skript mit genau einem Ziel. Der volle
  Backend-Lauf nutzt eine Wegwerf-Datenbank, der E2E-Lauf ein Umschalt-Skript, das die Umgebung
  danach unverändert wiederherstellt.

### Entfernt

- **Häuser-Auswertung als eigene Seite:** Sie ist entfallen; die alte Adresse leitet auf die
  Startseite um. Häuserstellungen bleiben im Horoskop, in der Synastrie und in den Transiten
  sichtbar.

### Behoben

- Die Transit-Auswertung rechnete Planeten doppelt und verlor dabei Chiron; Transit- und
  Grafik-Auswertung liefern jetzt dieselben 13 Planeten.
- Ein fehlender Aspekt-Eintrag führt nicht mehr zu einem Serverfehler, sondern zu einer entfallenden
  Zeile.
- Die Interpretation eines Charts wurde gelegentlich mehrfach geladen; sie wird jetzt nur noch
  einmal geholt.
- Der E2E-Lauf scheiterte am eigenen Versuchslimit für Sitzungs-Erneuerungen; der Testmodus hebt
  das Limit für die Dauer des Laufs an.
- Ein Layout-Test der Interpretationsseite prüfte eine Ansicht, die es mit vollständigen
  Profildaten nie gibt; er prüft jetzt das tatsächlich angezeigte Chartbild.

## [v3.1] — 2026-10-30

### Hinzugefügt

- **Sichtbare Sicherheitsprüfung als Ausweichweg:** Lässt sich die unsichtbare Prüfung auf der
  Anmelde- oder Registrierungsseite nicht abschließen (Inhaltsblocker, Privat-Relay, langsames
  Skript), erscheint an derselben Stelle eine sichtbare Cloudflare-Challenge. Nach dem Lösen geht es
  automatisch weiter; ein Tastendruck nach einem Fehlversuch schaltet auf einen ausdrücklichen
  Absende-Klick um, ohne die angefangene Challenge zu verlieren.
- **Änderungsprotokoll:** diese Datei.

### Geändert

- Das Turnstile-Skript wird nur noch einmal geladen. Trudelt die Antwort eines zuvor abgebrochenen
  Ladeversuchs später ein, wird sie übernommen, statt ein zweites Skript zu starten.
- Die E2E-Tests laufen über HTTPS gegen den vollen Stack und prüfen die Anmeldung am
  Dashboard-Anker statt an einer nicht mehr existierenden Überschrift.
- Die Testsuite startet über ein versioniertes Umschalt-Skript, das die nötigen Testwerte setzt und
  die `.env` danach wiederherstellt.

### Entfernt

- Die GeoIP2-Länder-Sperre samt ihrer `GEOIP2_*`-Variablen ist aus nginx und der Docker-Umgebung
  verschwunden. Seite und API sind weltweit erreichbar.

### Behoben

- Der Login bleibt bei einer blockierten oder zu langsamen Sicherheitsprüfung nicht mehr bei
  „Lade…" hängen: Es erscheint eine klare Fehlermeldung, und ein erneuter Versuch ist ohne
  Seiten-Neuladen möglich.
- Die Registrierung meldet ehrlich, wenn nach der Kontoerstellung ein anderes Passwort eingegeben
  wurde, statt eine falsche Anmeldung zu versuchen.
- Ein Tastendruck verwirft die angefangene Sicherheitsprüfung nicht mehr.
- Die Anmeldung bleibt in Safari über einen Reload und einen Neustart hinweg erhalten
  (Secure-Cookies über HTTPS).
