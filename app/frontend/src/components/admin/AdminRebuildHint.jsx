/**
 * AdminRebuildHint - quittierbarer Hinweis „Statisches Wiki neu bauen“.
 *
 * Der Serverstempel (`GET /wiki/content-stamp`) ist die Wahrheit; der Browser merkt sich nur
 * den Stempel, den der Admin bereits quittiert hat. Verglichen werden deshalb **Werte**, nie
 * ein Boolean: ein Boolean bliebe nach der ersten Quittung für immer still, obwohl eine
 * spätere Bildänderung den Stempel erneut bewegt.
 *
 * Der Hinweis verschwindet ausschließlich über „Als erledigt markieren“ oder über einen
 * erfolgreichen Build im Tab „Einstellungen → Build Wiki“ (`AdminBuildWikiTab` quittiert den
 * Stempel). Es gibt keinen Schließen-Knopf, kein Wegtippen und keinen Build-Aufruf.
 *
 * @component
 * @returns {(JSX.Element|null)} Hinweis, oder `null` solange nichts zu quittieren ist
 */
import React, { useEffect, useState } from 'react'
import {
  WIKI_CONTENT_CHANGED_EVENT,
  acknowledgeRebuild,
  readAckedStamp,
  refreshRebuildStamp,
} from '../../services/wikiRebuild'

/**
 * Formatiert den ISO-Stempel als „TT.MM.JJJJ, HH:MM“ (de-DE, kurzes Datum und kurze Zeit).
 * @param {(string|null)} stamp - ISO-8601-Stempel aus `/wiki/content-stamp`
 * @returns {string} formatierte Metazeile oder `''`, wenn der Wert unbrauchbar ist
 */
function formatStamp(stamp){
  if (!stamp) return ''
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return ''
  try{
    return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
  }catch(_){
    return ''
  }
}

export default function AdminRebuildHint(){
  const [acknowledged, setAcknowledged] = useState(() => readAckedStamp())
  const [stamp, setStamp] = useState(null)

  useEffect(() => {
    let active = true

    // Der Erststand kommt aus einem einzigen GET. Scheitert er, bleibt der Hinweis verborgen —
    // `refreshRebuildStamp()` loggt den Grund als `console.warn` (kein falscher Alarm).
    async function load(){
      const current = await refreshRebuildStamp()
      if (!active || !current) return
      setStamp(String(current))
    }

    // Jede gemeldete Änderung (Bild, Kuration, Bulk) bringt einen neuen Stempel. Die Quittung
    // wird dabei neu gelesen, damit auch eine Quittung aus einem anderen Tab hier ankommt
    // (erfolgreicher Build in „Einstellungen → Build Wiki“).
    function handleChange(event){
      const next = event?.detail?.stamp
      if (next) setStamp(String(next))
      setAcknowledged(readAckedStamp())
    }

    void load()
    window.addEventListener(WIKI_CONTENT_CHANGED_EVENT, handleChange)
    return () => {
      active = false
      window.removeEventListener(WIKI_CONTENT_CHANGED_EVENT, handleChange)
    }
  }, [])

  const meta = formatStamp(stamp)
  const visible = Boolean(stamp) && stamp !== acknowledged

  if (!visible) return null

  function acknowledge(){
    acknowledgeRebuild(stamp)
    setAcknowledged(String(stamp))
  }

  return (
    <section className="admin-rebuild-hint" role="status" data-testid="rebuild-hint">
      <div>
        <h3 className="admin-rebuild-hint-heading">Statisches Wiki neu bauen</h3>
        <p className="admin-rebuild-hint-body">
          Artikelbilder oder die Startseite haben sich geändert. Das statische Wiki unter
          /astro-wiki/ zeigt das erst nach einem neuen Build unter Einstellungen → Build Wiki.
        </p>
        {meta ? <p className="admin-rebuild-hint-meta">{'Letzte Änderung: ' + meta}</p> : null}
      </div>
      <button
        type="button"
        className="admin-secondary-button"
        data-testid="rebuild-hint-ack"
        onClick={acknowledge}
      >
        Als erledigt markieren
      </button>
    </section>
  )
}
