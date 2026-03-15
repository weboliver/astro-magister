# Astro-Nex Debug-Anleitung

## Methode 1: Basis Debug-Ausgaben
```bash
python nex.py 2>&1 | tee debug.log
```
Speichert alle Ausgaben in debug.log

## Methode 2: Mit erweiterten Umgebungsvariablen
```bash
DEBUG_NEX=1 ./debug_nex.sh
```
Aktiviert:
- Python Faulthandler (zeigt C-Stack bei Crashes)
- GTK Debug-Modus
- Ausführliches Logging nach /tmp/astronex_debug.log

## Methode 3: Mit Python Debugger (pdb)
```bash
python -m pdb nex.py
```
Breakpoints setzen:
```
(Pdb) b astronex/boss.py:70
(Pdb) c  # continue bis Breakpoint
(Pdb) n  # next line
(Pdb) p self.da  # Variable anzeigen
(Pdb) bt  # Backtrace
```

## Methode 4: GDB für Segfaults
```bash
gdb --args python nex.py
```
In GDB:
```
(gdb) run
# Warten bis Crash
(gdb) bt full  # Vollständiger Backtrace
(gdb) info threads  # Alle Threads
```

## Methode 5: Valgrind für Memory-Probleme
```bash
valgrind --leak-check=full --track-origins=yes python nex.py 2>&1 | tee valgrind.log
```

## Methode 6: Strace für System-Calls
```bash
strace -f -o strace.log python nex.py
```
Zeigt alle System-Calls

## Methode 7: GTK Inspector (live debugging)
```bash
GTK_DEBUG=interactive python nex.py
```
Drücke Ctrl+Shift+D in der laufenden App für GTK Inspector

## Aktuelles Problem: Gtk.Layout Segfaults

### Symptome:
- App startet ohne Errors
- Zeigt Toolbar und MainPanel
- Horoskop (DrawMaster/Gtk.Layout) wird nicht angezeigt
- Gelegentliche Segfaults beim show()

### Debug-Schritte:
1. Prüfe ob dispatch() aufgerufen wird:
```bash
cd astronex/surfaces
# In layoutsurface.py dispatch() Zeile 505:
# Füge hinzu: print("DISPATCH CALLED", file=sys.stderr, flush=True)
```

2. Prüfe DrawMaster Sichtbarkeit:
```bash
cd astronex/boss.py
# Nach show_main_window() hinzufügen:
# print(f"DA visible: {self.da.get_visible()}", file=sys.stderr, flush=True)
# print(f"DA size: {self.da.get_allocated_width()}x{self.da.get_allocated_height()}", file=sys.stderr, flush=True)
```

3. Teste add() vs add_with_viewport():
```bash
# In astronex/gui/winnex.py Zeile 191
# Wechsle zwischen:
scrolled.add(self.da)  # Direkt
# vs
scrolled.add_with_viewport(self.da)  # Mit Viewport
```

### Bekanntes Problem:
Gtk.Layout ist deprecated in GTK3 und hat bekannte Stabilitätsprobleme.
Alternative: Migration zu Gtk.DrawingArea oder Cairo-basiertem Widget.
