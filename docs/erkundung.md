# Erkundung

## Installation des Helfers (Stand 2026-11-04, Überlegung, noch nicht ausprobiert)

Ein echter Ping (ICMP) und das Öffnen eines Terminals gehen nur über einen kleinen Helfer auf dem
Rechner, den der Browser per Native Messaging startet. Die Erweiterung selbst darf nichts
installieren oder ausführen.

**Ablauf aus Nutzersicht** (Feinschliff später):
- Die Erweiterung prüft, ob der Helfer da ist: `chrome.runtime.connectNative` liefert immer einen
  Port, fehlt der Helfer, meldet `port.onDisconnect` „Specified native messaging host not found.“
  (dasselbe Ereignis kommt auch bei kaputtem Eintrag oder falscher ID). Braucht die Berechtigung
  `nativeMessaging`. Fehlt der Helfer: Hinweis mit dem Installationsbefehl für das eigene System
  (`chrome.runtime.getPlatformInfo`), Button „Kopieren“, Link „Skript ansehen“.
- Nach der Installation merkt die Erweiterung das von selbst, ohne Neuladen.
- Ohne Helfer könnte die Erweiterung schon per HTTP prüfen (Option D), mit Helfer echter Ping.

**Ein Befehl je System, ohne Nutzerpfade und ohne Admin-Rechte:**
- macOS: `curl -fsSL https://github.com/unbindthefog/tab2ping/releases/latest/download/install.sh | sh`
  - Helfer nach `~/Library/Application Support/tab2ping/`. Entweder eine Universal-Datei für Intel
    und Apple Silicon (zwei Go-Builds per `lipo` zusammengefügt, danach `codesign -s -`, Apple
    Silicon verlangt mindestens diese Ad-hoc-Signatur) oder zwei Dateien, das Skript wählt per
    `uname -m`.
  - Eintrag in die NativeMessagingHosts-Ordner der installierten Browser (Brave, Chrome, Edge).
  - `curl` setzt kein Herkunftskennzeichen (Quarantäne), daher keine Gatekeeper-Warnung. Gilt nur,
    wenn das Skript den Helfer selbst per `curl` holt, nicht für eine Datei aus dem Browser.
- Windows: `irm https://github.com/unbindthefog/tab2ping/releases/latest/download/install.ps1 | iex`
  - Helfer nach `%LOCALAPPDATA%\tab2ping\`, Anmeldung beim Browser per Registry unter `HKCU`.

**Voraussetzungen:**
- Öffentlich erreichbare Adresse für Skript und Helfer (ein privates Repo verlangt eine Anmeldung).
- Feste Erweiterungs-ID im Skript (`allowed_origins`); beim entpackten Laden per `key` im Manifest.
- Helfer in Go statt Swift, wenn Windows dazukommt: je System eine Datei ohne Abhängigkeiten.

**Weitere Punkte:**
- Pro macOS-Konto einmal installieren. Ein signiertes `.pkg` mit Admin-Passwort könnte für alle
  Konten installieren, braucht für einen Doppelklick ohne Warnung aber eine Apple Developer ID
  (99 $/Jahr).
- Deinstallation: Entfernen der Erweiterung lässt den Helfer liegen, daher ein eigener Befehl.
- Sicherheit: Der Helfer antwortet nur der eigenen Erweiterung und pingt nur geprüfte Adressen,
  ohne Umweg über eine Shell.

**Offen, zu prüfen:**
- Native Messaging in Brave unter macOS, in beiden Konten.
- Liest Brave unter Windows seinen eigenen Registry-Zweig oder den von Chrome?
- Meldet der Virenschutz von Windows einen unsignierten Helfer trotz Download per PowerShell?
