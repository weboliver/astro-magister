/**
 * pages - Routentabelle des Frontends (einzige Quelle für Pfad, Loader, Meta und Zugriffsstufe)
 * @module pages
 * @description Jede Seite wird hier genau einmal beschrieben: `path` (veröffentlichter Vertrag),
 *              `load()` (stabile Modul-Funktion, damit der Prefetch sie erreicht),
 *              `meta` (Titel/Description für SEO, byte-gleich aus dem früheren `PAGE_META`),
 *              `access` ('public' | 'auth' | 'profile' | 'admin') und `shell` ('panel' | 'wide').
 *              `access` ist verbindlich: `routes.jsx` leitet die Guard-Stufe daraus ab und bricht
 *              ab, wenn eine Seite ohne passenden Guard eingehängt wird.
 *
 *              Diese Datei enthält bewusst nur Literale und `import()`-Funktionen — keine
 *              Komponenten-Importe. Dadurch können `routes.jsx`, `App.jsx`, `Dashboard.jsx` und
 *              `routing/nextParam.js` sie lesen, ohne einen Import-Zyklus über `AppShell` zu bauen.
 */

/**
 * Seiten-Tabelle: Schlüssel = Menü-/Testid-Kennung, Wert = Pfad, Loader, Metadaten, Zugriff, Hülle.
 * Rechtstexte tragen zusätzlich `pageName` (der Seitennamen-Literal des `page-entries`-Endpunkts);
 * `toRoute` reicht ihn in den Route-`handle` durch.
 * @type {Object.<string, {path: string, load: function(): Promise<Object>, meta: {title: string, description: string, dynamicTitle?: boolean}, access: string, shell: string, pageName?: string}>}
 */
export const pages = {
  home: {
    path: '/',
    load: () => import('../pages/Dashboard'),
    meta: { title: 'Startseite', description: 'Astro-Magister – dein Portal für astrologische Selbsterfahrung. Horoskop, Planeten, Häuser, Transite und mehr.' },
    access: 'public',
    shell: 'panel',
  },
  horoscope: {
    path: '/horoscope',
    load: () => import('../pages/Horoscope'),
    meta: { title: 'Horoskop', description: 'Dein persönliches Horoskop auf einen Blick – Planetenstellungen und astrologische Deutungen.' },
    access: 'profile',
    shell: 'panel',
  },
  mondknoten: {
    path: '/mondknoten',
    load: () => import('../pages/Mondknoten'),
    meta: { title: 'Mondknoten', description: 'Das Mondknoten Horoskop nach Huber — Rahu und Ketu in Zeichen und Häusern.' },
    access: 'profile',
    shell: 'panel',
  },
  synastrie: {
    path: '/synastrie',
    load: () => import('../pages/Synastrie'),
    meta: { title: 'Synastrie', description: 'Partnervergleich und Beziehungsanalyse nach Huber-Astrologie – Synastrie mit zwei individuellen Horoskopen.' },
    access: 'profile',
    shell: 'panel',
  },
  transits: {
    path: '/transits',
    load: () => import('../pages/Transits'),
    meta: { title: 'Transite', description: 'Aktuelle Transite und ihre astrologische Wirkung auf dein Geburtshoroskop.' },
    access: 'profile',
    shell: 'panel',
  },
  solar: {
    path: '/solar',
    load: () => import('../pages/SolarReturn'),
    meta: { title: 'Solar Jahr', description: 'Das solare Rückkehrhoroskop für dein aktuelles Lebensjahr.' },
    access: 'profile',
    shell: 'panel',
  },
  agepoints: {
    path: '/agepoints',
    load: () => import('../pages/AgePoints'),
    meta: { title: 'Alterspunkte', description: 'Die Alterspunkt-Methode nach Bruno Huber – deine persönliche Jahressteuerung.' },
    access: 'profile',
    shell: 'panel',
  },
  wiki: {
    path: '/wiki',
    load: () => import('../pages/Wiki'),
    meta: { title: 'Wiki', description: 'Das astrologische Wiki von Astro-Magister – Begriffe, Planeten, Aspekte und mehr erklärt.' },
    access: 'public',
    shell: 'panel',
  },
  wikiEntry: {
    path: '/wiki/:slug',
    load: () => import('../pages/Wiki'),
    // `dynamicTitle`: der Artikeltitel kommt aus dem geladenen Eintrag (`Wiki.jsx` ruft
    // `useSeoMeta` selbst). Die Hülle würde ihn sonst mit dem Tabellentitel überschreiben,
    // weil ihr Effekt nach dem der Seite läuft.
    meta: { title: 'Wiki', description: 'Das astrologische Wiki von Astro-Magister – Begriffe, Planeten, Aspekte und mehr erklärt.', dynamicTitle: true },
    access: 'public',
    shell: 'panel',
  },
  // Rechtstexte als eigene Adressen: Inhalt weiter aus dem `page-entries`-Mechanismus,
  // der Seitennamen-Literal steht hier und wandert über `toRoute` in den Route-`handle`.
  impressum: {
    path: '/impressum',
    load: () => import('../pages/LegalPage'),
    meta: { title: 'Impressum', description: 'Impressum und Anbieterkennzeichnung von Astro-Magister.' },
    access: 'public',
    shell: 'panel',
    pageName: 'Impressum',
  },
  datenschutz: {
    path: '/datenschutz',
    load: () => import('../pages/LegalPage'),
    meta: { title: 'Datenschutz', description: 'Informationen zum Datenschutz bei Astro-Magister.' },
    access: 'public',
    shell: 'panel',
    pageName: 'Datenschutz',
  },
  kontakt: {
    path: '/kontakt',
    load: () => import('../pages/LegalPage'),
    meta: { title: 'Kontakt', description: 'Kontakt zu Astro-Magister.' },
    access: 'public',
    shell: 'panel',
    pageName: 'Kontakt',
  },
  settings: {
    path: '/settings',
    load: () => import('../pages/Settings'),
    meta: { title: 'Profil', description: 'Deine Profileinstellungen auf Astro-Magister.' },
    access: 'auth',
    shell: 'wide',
  },
  admin: {
    path: '/admin/:tab?',
    load: () => import('../pages/Admin'),
    meta: { title: 'Admin', description: 'Administrationsoberfläche von Astro-Magister.' },
    access: 'admin',
    shell: 'wide',
  },
  login: {
    path: '/login',
    load: () => import('../pages/Login'),
    meta: { title: 'Login', description: 'Melde dich bei Astro-Magister an.' },
    access: 'public',
    shell: 'panel',
  },
  register: {
    path: '/register',
    load: () => import('../pages/Register'),
    meta: { title: 'Registrierung', description: 'Erstelle ein kostenloses Konto bei Astro-Magister.' },
    access: 'public',
    shell: 'panel',
  },
}

export default pages
