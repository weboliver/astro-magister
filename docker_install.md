# Docker Installation (Linux, systemd)

Kurz: Anleitung, um Docker Engine und das Compose-Plugin sicher zu installieren. Fokus: Debian/Ubuntu (korrigierte Schreibweise der `docker.list`-Erzeugung).

## Voraussetzungen

- 64‑bit Linux, `sudo`-Rechte
- Internetzugang
- Entferne ggf. alte Docker-Pakete (nur bei Bedarf):

```bash
sudo apt remove -y docker docker-engine docker.io containerd runc || true
```

## Debian / Ubuntu (empfohlen)

1. System aktualisieren und notwendige Pakete installieren:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
```

2. Docker GPG-Schlüssel + Keyring anlegen:

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

3. Docker-Repository korrekt hinzufügen (wichtig: Umleitung mit `sudo tee` oder `sh -c` verwenden, sonst landet die Datei im falschen Verzeichnis):

Mit `tee` (empfohlen):

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" |
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

Oder mit `sh -c`:

```bash
sudo sh -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list'
```

> Falls `docker.list` versehentlich lokal erzeugt wurde, verschieben:

```bash
sudo mv ./docker.list /etc/apt/sources.list.d/docker.list
```

4. Docker Engine + Compose-Plugin installieren:

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

5. Docker-Dienst aktivieren und starten:

```bash
sudo systemctl enable --now docker
```

## Alternative Distributionen

- Fedora / RHEL / CentOS: Nutze die offizielle Anleitung auf https://docs.docker.com/engine/install/ und ersetze `apt` durch `dnf`/`yum` entsprechend.
- Arch: `pacman -S docker` und `systemctl enable --now docker`.

## Benutzer ohne sudo (optional)

Damit Nicht‑Root‑Benutzer `docker` ohne `sudo` verwenden können:

```bash
sudo usermod -aG docker $USER
# Abmelden/Anmelden oder: newgrp docker
```

## Verifikation

- Docker-Version prüfen:

```bash
docker --version
```

- Compose-Plugin prüfen:

```bash
docker compose version
```

- Test-Container:

```bash
docker run --rm hello-world
```

## Schnellstart für dieses Projekt

Im Projektroot (`~/Projects/Python/astronex`):

```bash
cd ~/Projects/Python/astronex
docker compose up -d --build
docker compose ps
docker compose logs -f
```

## Fehlerbehebung / Hinweise

- Wenn `docker.list` an falscher Stelle liegt: verschieben (siehe oben).
- Permission-Fehler → prüfen, ob `$USER` Mitglied der `docker`-Gruppe ist.
- Logs: `sudo journalctl -u docker -b` oder `docker compose logs -f`.
- Bei Firewall/SELinux: Regeln für Containernetzwerk prüfen.

## Quellen

- Offizielle Docker-Dokumentation: https://docs.docker.com/engine/install/

---
Datei erstellt: `docker_install.md` — passe sie bei Bedarf an deine Distribution an.
