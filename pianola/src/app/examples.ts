export interface Example { name: string; code: string }

export const FUER_ELISE = `// Für Elise – Ludwig van Beethoven (WoO 59), Teil A und B
title("Für Elise")
composer("Ludwig van Beethoven")
tempo(66)
meter(3, 8)
pickup("/8")
humanize(0.6)

const rh = voice("Rechte Hand")
const lh = voice("Linke Hand")

// Hauptthema, Takt 1–7. Der Schlusstakt unterscheidet sich je Durchgang.
const thema = \`
  E5/16 D#5 E5 B4 D5 C5 | A4/8 r/16 C4 E4 A4 | B4/8 r/16 E4 G#4 B4 | C5/8 r/16 E4 E5 D#5 |
  E5/16 D#5 E5 B4 D5 C5 | A4/8 r/16 C4 E4 A4 | B4/8 r/16 E4 C5 B4 |\`
const begleitung = \`
  * r/4. | ped A2/16 E3 A3 r/16 r/8 | ped E2/16 E3 G#3 r/16 r/8 | ped A2/16 E3 A3 r/16 r/8 |
  * r/4. | ped A2/16 E3 A3 r/16 r/8 | ped E2/16 E3 G#3 r/16 r/8 |\`
const schlussLinks = "ped A2/16 E3 A3 r/16 r/8 |"

// Auftakt
rh.play("p E5/16 D#5 |")
lh.play("r/8 |")

// Teil A, erster Durchgang (endet mit dem Auftakt zur Wiederholung)
rh.play(thema + " A4/4 E5/16 D#5 |")
lh.play(begleitung + schlussLinks)

// Teil A, zweiter Durchgang (führt in Teil B)
rh.play(thema + " A4/8 r/16 B4 C5 D5 |")
lh.play(begleitung + schlussLinks)

// Teil B
rh.play(\`mp E5/8. G4/16 F5 E5 | D5/8. F4/16 E5 D5 | C5/8. E4/16 D5 C5 |
         B4/8 r/16 E4 E5 r | r E5 E6 r r D#5 | E5 r r D#5 E5 D#5 |\`)
lh.play(\`ped C3/16 G3 C4 r/16 r/8 | ped G2/16 G3 B3 r/16 r/8 | ped A2/16 E3 A3 r/16 r/8 |
         ped E2/16 E3 r/16 r/16 r/8 | * r/4. | r/4. |\`)

// Teil A zum Schluss
rh.play("p" + thema + " A4/4.~ | A4/4. |")
lh.play(begleitung + schlussLinks + " r/4. *")
`

export const NACHTLICHT = `// Nachtlicht – eine kleine Demo, die zeigt, dass PianoScript echtes JavaScript ist
title("Nachtlicht")
composer("Pianola Demo")
tempo(74)
meter(4, 4)
humanize(0.8)

const melodie = voice("Melodie")
const begleitung = voice("Begleitung")

// Akkorde für die linke Hand: Grundton, Quinte, Oktave, Terz
const akkorde = {
  Am: ["A2", "E3", "A3", "C4"],
  F:  ["F2", "C3", "F3", "A3"],
  C:  ["C3", "G3", "C4", "E4"],
  G:  ["G2", "D3", "G3", "B3"],
}
const folge = ["Am", "F", "C", "G"]

// Ein Takt Arpeggio in Achteln, mit Pedal
function arpeggio(name) {
  const [a, b, c, d] = akkorde[name]
  return \`ped \${a}/8 \${b} \${c} \${d} \${c} \${b} \${c} \${d} |\`
}

// Weiter gefächert: zwei Oktaven aufwärts
function arpeggioGross(name) {
  const [a, b, c, d] = akkorde[name]
  return \`ped \${transpose(a, -12)}/8 \${a} \${b} \${c} \${d} \${transpose(b, 12)} \${transpose(c, 12)} \${transpose(d, 12)} |\`
}

// Intro: nur Begleitung
melodie.play("r/1 | r/1 | r/1 | r/1 |")
for (const a of folge) begleitung.play("p " + arpeggio(a))

// Thema, zweimal mit leicht anderem Ende
melodie.play(\`mp E5/4. D5/8 C5/4 B4 | A4/2 C5/4 F5 | E5/4. D5/8 E5/4 G5 | D5/2. B4/4 |
              C5/4. B4/8 A4/4 E5 | F5/4. E5/8 C5/2 | G5/4. F5/8 E5/4 C5 | D5/1 |\`)
for (let i = 0; i < 2; i++) for (const a of folge) begleitung.play(arpeggio(a))

// Höhepunkt in Oktaven, Begleitung über zwei Oktaven
melodie.play(\`mp < [E5 E6]/4. [D5 D6]/8 [C5 C6]/4 [B4 B5] | [A4 C5 F5 A5]/2 [C5 C6]/4 [F5 F6] |
              f [E5 G5 C6 E6]/4. [D5 D6]/8 [E5 E6]/4 [G5 G6] | [D5 G5 B5 D6]/2. [B4 B5]/4 |\`)
for (const a of folge) begleitung.play(arpeggioGross(a))

// Ausklang
melodie.play("p [A4 C5 F5]/1 | pp [A4 C5 E5 A5]/1& |")
begleitung.play(\`p ped F2/8 C3 F3 A3 F3 C3 F3 A3 | ped [A1 A2]/1 |\`)
`

export const EXAMPLES: Example[] = [
  { name: 'Für Elise (Beethoven)', code: FUER_ELISE },
  { name: 'Nachtlicht (Demo mit Schleifen)', code: NACHTLICHT },
]
