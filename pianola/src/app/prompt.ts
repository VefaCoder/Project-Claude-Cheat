// The instructions users paste into ChatGPT, Claude & co. They double as the language reference.

export const LANGUAGE_GUIDE = `PianoScript ist normales JavaScript mit ein paar Zusatzfunktionen.

GRUNDGERÜST
title("Titel"); composer("Komponist")
tempo(72)            // Viertelnoten pro Minute
meter(3, 4)          // Taktart, Standard ist 4/4
pickup("/8")         // nur bei Auftakt: Länge des Auftakts
humanize(0.6)        // leichte menschliche Ungenauigkeit, 0 = exakt
const rh = voice("Rechte Hand")
const lh = voice("Linke Hand")
rh.play(\`...Notentext...\`)   // hängt Noten an die Stimme an
sync()                        // setzt alle Stimmen auf denselben Zeitpunkt

NOTENTEXT IN play() (Einträge durch Leerzeichen getrennt)
Tonhöhe:   Buchstabe A–G, optional # oder b, dann Oktave. Mittleres C = C4.
           Beispiele: C4 F#3 Bb5 Eb2. Tiefste Taste A0, höchste C8.
           Englische Namen: H heißt B, B heißt Bb.
Dauer:     /1 ganze, /2 halbe, /4 Viertel, /8 Achtel, /16, /32, /64
           punktiert: /4. /8.   Triolen: /12 Achteltriole, /6 Vierteltriole, /24 Sechzehnteltriole
           Die Dauer gilt weiter, bis eine neue kommt: "C4/8 D4 E4" sind drei Achtel.
Pause:     r/4  r/8  r/16 …
Akkord:    [C4 E4 G4]/2      gebrochen (arpeggiert): [C3 G3 E4]/2&
Bindebogen über gleiche Töne: C4/2~ C4/8   (klingt als ein Ton)
Staccato:  C4/8'     Akzent: C4/8>     exakte Lautstärke 1–127: C4/8@100
Dynamik:   ppp pp p mp mf f ff fff   (gilt für alle folgenden Noten)
Crescendo/Decrescendo: < bzw. > setzen, die nächste Dynamik ist das Ziel: "p < C4 D4 E4 F4 f G4"
Pedal:     ped = Pedal treten (erneutes ped tritt neu), * = Pedal loslassen
Tempo:     T=90 sofort, T~60 allmählich bis hierhin (ritardando/accelerando)
Taktart:   M=3/4 ab hier
Taktstrich | ist optional, aber nutze ihn: Pianola prüft damit jede Taktlänge.
Kommentare: // oder %

WEITERE FUNKTIONEN
rh.note("C4", "/8", {vel: 90})    rh.chord(["C4","E4","G4"], "/2")    rh.rest("/4")
rh.at(bar(17))       setzt die Stimme an den Anfang von Takt 17
transpose("C4 E4 G4", 2)   verschiebt Notentext um Halbtöne
voice("Name", {color: "#ff8800"})   eigene Farbe für die Stimme
Variablen, Funktionen, Schleifen und Template-Strings sind ausdrücklich erlaubt.`

const RULES = `REGELN
1. Jede Stimme läuft unabhängig. Beide Hände müssen pro Takt exakt gleich lang sein. Zähle jeden Takt nach.
2. Keine Wiederholungszeichen wie |: :|. Wiederholungen ausschreiben oder mit Variablen und Schleifen bauen.
3. Schreibe das Original mit beiden Händen, allen Akkord- und Basstönen, nicht vereinfacht (außer ich verlange es).
4. Setze Pedal und Dynamik so, wie ein guter Pianist spielen würde.
5. Schreibe das Stück vollständig bis zum Ende, auch wenn es lang ist.
6. Antworte nur mit einem einzigen JavaScript-Codeblock, ohne Erklärungen davor oder danach.`

const EXAMPLE = `BEISPIEL
title("Beispiel"); composer("Ich"); tempo(84); meter(4, 4)
const rh = voice("Rechte Hand"), lh = voice("Linke Hand")
rh.play(\`mf E5/4 D5 C5 D5 | E5/4 E5 E5/2 | p < D5/4 D5 E5 F5 | f G5/1 |\`)
lh.play(\`ped C3/8 G3 E4 G3 C3 G3 E4 G3 | ped C3/8 G3 E4 G3 C3 G3 E4 G3 |
         ped G2/8 D3 B3 D3 G2 D3 B3 D3 | ped [C2 C3]/1 * |\`)`

export function buildPrompt(piece: string): string {
  const what = piece.trim() || '[HIER DAS STÜCK EINTRAGEN]'
  return `Du bist ein erfahrener Pianist und JavaScript-Programmierer. Schreibe das Klavierstück „${what}“ als PianoScript-Programm für die Mac-App „Pianola“. Pianola spielt den Code mit einem echten Konzertflügel ab und zeigt die Noten als fallende Balken.

${LANGUAGE_GUIDE}

${RULES}

${EXAMPLE}

Jetzt bitte: „${what}“`
}

export function buildFixPrompt(problems: { message: string; line?: number }[]): string {
  const list = problems.map(p => `- ${p.line ? `Zeile ${p.line}: ` : ''}${p.message}`).join('\n')
  return `Pianola meldet diese Probleme in deinem PianoScript-Code:\n${list}\n\nKorrigiere sie (achte besonders darauf, dass jeder Takt in jeder Stimme exakt die richtige Länge hat) und gib den vollständigen, korrigierten Code als einen einzigen JavaScript-Codeblock zurück.`
}
