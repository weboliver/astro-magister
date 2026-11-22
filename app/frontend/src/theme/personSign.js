/**
 * personSign.js — das Zeichen, das die Palette färbt
 *
 * Die Zodiac-Palette folgt app-weit dem Zeichen der **gewählten Person**, nicht mehr dem Datum.
 * Die Auswahl liegt global in `PersonSelectionContext`; damit färbt eine Auswahl auf einer
 * Auswertungs-Seite auch alle anderen Seiten um, ohne dass eine dieser Seiten angefasst wird.
 *
 * Warum die Ableitung hier und nicht in `PersonSelector`: die Komponente wird von sechs Seiten
 * genutzt und gibt `null` zurück, sobald die **gewählte** Person kein Geburtsjahr hat — sie fällt
 * bewusst nicht aufs Profil durch. Für die Palette wäre das falsch: wer eine Person ohne
 * Geburtsdatum auswählt, soll die Profilfarben behalten und nicht auf das Tageszeichen fallen.
 * Diese Abweichung ist Absicht und der Grund, warum die Regel ein eigenes, reines Modul bekommt
 * statt in die Komponente zu wandern.
 *
 * Beide Funktionen werfen nie: fehlende Argumente, `null`-Werte und unvollständige Geburtsdaten
 * führen zur nächsten Stufe bzw. zum Tageszeichen.
 */
import { getSignIndex } from './ThemeApplier'
import { THEME_SIGN_STORAGE_KEY } from './storageKeys'

/**
 * Merker für das zuletzt angewandte personen- bzw. profilabgeleitete Zeichen.
 * Das blockierende Anti-Flash-Skript in `index.html` liest ihn vor dem ersten Paint.
 * Der Schlüssel liegt in `storageKeys.js`, weil `services/api.js` dieselbe Zeichenkette beim
 * Beenden der Sitzung löscht und `personSign` dafür nicht importieren darf.
 * @type {string}
 */
export { THEME_SIGN_STORAGE_KEY }

/**
 * Zeichenindex (0…11) für die Palette.
 *
 * Reihenfolge: gewählte Person mit Geburtsjahr → eigenes Profil mit
 * Geburtsjahr → Tageszeichen über `getSignIndex(new Date())`. Der `{}`-Default erlaubt den Aufruf
 * ohne Argument, ohne dass der Aufrufer auf `null` prüfen muss.
 *
 * @param {Object} [selection]
 * @param {{birth_year?: number, birth_month?: number, birth_day?: number}|null} [selection.selectedPerson]
 * @param {{birth_year?: number, birth_month?: number, birth_day?: number}|null} [selection.profile]
 * @returns {number} 0 (Widder) … 11 (Fische)
 */
/**
 * Liest den Merker so, wie das Anti-Flash-Skript in `index.html` ihn liest — oder `undefined`,
 * wenn keiner (oder ein unbrauchbarer) vorliegt.
 *
 * Gebraucht wird das in `App.jsx` **vor** der Sitzungsklärung: der Theme-Effekt muss wissen, ob die
 * Palette, die gerade auf dem Schirm steht, aus dem Merker stammt (dann ist sie schon die richtige
 * und darf nicht überschrieben werden) oder aus dem Datum (dann wird sie nach der Klärung
 * ersetzt). Die Prüfung ist bewusst dieselbe wie im Boot-Skript: ganze Zahl 0…11, alles
 * andere gilt als „kein Merker".
 *
 * @returns {number|undefined} Zeichenindex 0…11, sonst `undefined`
 */
export function readStoredSignMarker() {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(THEME_SIGN_STORAGE_KEY)
    if (raw === null) return undefined
    const parsed = parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed === Number(raw) && parsed >= 0 && parsed <= 11) {
      return parsed
    }
  } catch (_) {
    /* gesperrter Speicher — dann gibt es keinen Merker */
  }
  return undefined
}

export function signIndexForPerson({ selectedPerson, profile } = {}) {
  if (selectedPerson?.birth_year) {
    return getSignIndex(new Date(selectedPerson.birth_year, (selectedPerson.birth_month || 1) - 1, selectedPerson.birth_day || 1))
  }
  if (profile?.birth_year) {
    return getSignIndex(new Date(profile.birth_year, (profile.birth_month || 1) - 1, profile.birth_day || 1))
  }
  return getSignIndex(new Date())
}

/**
 * Wert für `localStorage[THEME_SIGN_STORAGE_KEY]` — oder `null`, wenn kein Merker geschrieben
 * werden darf.
 *
 * Diese Funktion ist die einzige Stelle, die entscheidet, **ob** gemerkt werden darf. Gemerkt wird
 * ausschließlich ein personen- oder profilabgeleitetes Zeichen; das Tageszeichen darf nie in den
 * Speicher (anonym gilt das Tageszeichen, jeden Tag neu). Ein gemerktes Tageszeichen würde
 * nach einem Datumswechsel die gestrige Palette malen, bis React sie korrigiert.
 *
 * Der Rückgabewert ist ein String, weil localStorage textbasiert ist. `null` heißt „kein Merker",
 * nicht „Zeichen 0" — deshalb ist die Rückgabe nicht einfach `String(index)`.
 *
 * @param {Object} [selection] - gleiche Form wie bei `signIndexForPerson`
 * @returns {string|null} `'0'`…`'11'` oder `null`
 */
export function signMarkerFor({ selectedPerson, profile } = {}) {
  if (!selectedPerson?.birth_year && !profile?.birth_year) return null
  return String(signIndexForPerson({ selectedPerson, profile }))
}
