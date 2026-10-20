// German journal entries – the same ids as skJournal.ts (JournalTexts); the terms follow GLOSSARY-DE.md. At
// most 60 words per entry, no exclamation marks; the voice is terse and quiet, like the Slovak.
import type { JournalTexts } from './skJournal';

export const deJournal: JournalTexts = {
  scanner: {
    title: 'Scanner',
    text: 'Ein Puls erfasst, was das Radar nicht sieht. Ein Signal ist nur eine Frage: eine Richtung, eine Entfernung und ein Kreis des Zweifels. Die Antwort kommt, wenn du hinfliegst. Halte Tab auf einem Objekt, um es zu analysieren – das Institut zahlt in Daten, und das Archiv macht aus Daten Teile.',
  },
  echo0Heard: {
    title: 'Ein Ton nahe der Heimat',
    text: 'Drei Schläge und Stille, immer wieder. Keine unserer Frequenzen. Das Institut sagt, er klingt seit der Ankunft der ersten Siedler, und niemand hat ihn je genau geortet. Ein Ort gibt nur eine Richtung – du musst von mindestens drei aus lauschen.',
  },
  echo0: {
    title: 'Echo-0',
    text: 'Ein Dreibein aus schwarzen Klingen um einen langsam drehenden Kristall. Älter als alles, was wir hier haben. Das Signal ist keine Nachricht, eher eine Wiederholung – wie das Echo von etwas, das vor langer Zeit geschah. Es zeigt nach außen, zu den Äußeren Gürteln.',
  },
  decoder: {
    title: 'Schmiede-Frequenzen',
    text: 'Das Signal von Echo-0 hat eine zweite Ebene, im Rauschen versunken. Das Archiv des Instituts hat einen Filter, der sie herausholt. Damit sollte der Scanner auch andere Leuchtfeuer hören – falls es welche gibt.',
  },
  anomalies: {
    title: 'Anomalien',
    text: 'Orte, an denen der Raum nicht zur Mathematik passt: Gravitation ohne Masse, Ionenentladungen, Strahlung ohne Quelle, ein Echo der Zeit. Das Institut zahlt für jeden Scan. Wer durch einen Kern fliegt, nimmt etwas mit – manchmal eine Narbe.',
  },
  ruleSling: {
    title: 'Beobachtung: die Schleuder',
    text: 'Der Kern einer Gravitationsanomalie schleudert das Schiff kurz nach vorn. Die Triebwerke ziehen stärker, bis sich das Feld hinter dir schließt. Wer die Route kennt, spart Treibstoff und Zeit.',
  },
  ruleCharge: {
    title: 'Beobachtung: Ionenladung',
    text: 'Ein Flug durch einen Ionenkern leert den Schild vollständig. Dafür füllt sich die Batterie, und der Reaktor läuft eine Weile über dem Normalwert. Im Kampf eine schlechte Idee, beim Abbau eine gute.',
  },
  ruleRadiation: {
    title: 'Beobachtung: Strahlung',
    text: 'Ein Strahlungskern verbrennt das Teil, das ihm am nächsten ist. Danach sieht der Scanner eine Weile weiter, als wäre etwas an ihm hängen geblieben. Panzerung auf dieser Seite zahlt sich aus.',
  },
  ruleTime: {
    title: 'Beobachtung: Zeitecho',
    text: 'In einem Zeitecho überhitzen die Laser nicht, und der Scanner lädt doppelt so schnell. Danach geht die Bordzeit eine Weile nach. Niemand weiß, warum.',
  },
  caches: {
    title: 'Verstecke',
    text: 'Jemand versteckt hier draußen Dinge, wo das Radar sie nicht sieht. Ein Puls erfasst nur einen Reflex – einen Kreis, in dem ein Versteck sein könnte. Jeder Puls von einem anderen Ort verkleinert den Kreis. Nach drei oder vier ist die Position sicher.',
  },
  cacheFound: {
    title: 'Ein geöffnetes Versteck',
    text: 'Ein unmarkierter Container, an einen Felsen gezurrt. Darin: Credits, Rohstoffe, manchmal ein Stück Bauplan. In den Deckel ist eine Klaue geritzt – dieselbe, die die Schiffe des Rosts tragen.',
  },
  wrecks: {
    title: 'Wracks',
    text: 'Schiffe aus denselben Teilen wie deins. Scanne sie, bevor du sie ausschlachtest: Du siehst, was überlebt hat und ob ein Bauplanfragment an Bord ist. Piratenwracks tragen eher Kampfteile, Frachter eher Logistik.',
  },
  plans: {
    title: 'Baupläne',
    text: 'Ein Fragment ist ein Stück eines Fertigungsbauplans. Drei Fragmente ergeben den Bauplan einer Variante – eines Teils, das eine oder zwei Eigenschaften zu einem klaren Preis ändert. Fragmente gehen nicht verloren, auch wenn das Schiff verbrennt. Das Institut tauscht ein doppeltes Fragment gegen Daten.',
  },
  giants: {
    title: 'Riesenasteroiden',
    text: 'Ein Fels mit harter Schale. Ein gewöhnlicher Laser wärmt ihn nur – es braucht einen Schweren Laser oder eine Kanone. Darunter liegt der Kern, dichter und reicher als alles ringsum.',
  },
  giantCore: {
    title: 'Beobachtung: der Kern eines Riesen',
    text: 'Wenn die Schale birst, fliegen die Platten auseinander, und der Kern liegt frei. Er lässt sich anderthalbmal so schnell abbauen wie gewöhnliches Gestein und füllt mehrere Frachträume.',
  },
  distress: {
    title: 'Notsignale',
    text: 'Ein Bergmann ohne Treibstoff, ein Schiff mit einem Loch im Rumpf. Die Gilde zahlt für Hilfe und merkt sich Namen. Aber nicht jeder Ruf ist ehrlich – Piraten können als jeder beliebige senden.',
  },
  trap: {
    title: 'Beobachtung: Signatur passt nicht',
    text: 'Beim zweiten Scan passt die Signatur des rufenden Schiffs nicht zu seinem Rumpf. Seine Triebwerke sind warm, obwohl es angeblich tot im Raum treibt. Eine Falle. Scanne zweimal, dann musst du es nicht auf die harte Tour lernen.',
  },
  echo1: {
    title: 'Echo-1',
    text: 'Dasselbe Leuchtfeuer, ein anderer Ton. Die Klingen tragen Schnittspuren – jemand hat versucht, den Kristall herauszubrechen. Das Signal wird stärker, wenn ein weiterer Schmiede-Kristall in der Nähe ist. Piraten sollen solche Splitter sammeln.',
  },
  pirateLog1: {
    title: 'Piratenlogbuch I',
    text: '„…der Kessel zahlt wieder für die roten Stücke. Sie leuchten, wenn du mit eingeschaltetem Scanner näher kommst. Der Boss hält sie in einer Kiste und sagt nicht, wofür. Morgen schlagen wir bei den Bergleuten nahe Anker zu.“',
  },
  pirateLog2: {
    title: 'Piratenlogbuch II',
    text: '„…beim alten Leuchtfeuer in den Gürteln hat der Splitter im Frachtraum so hell geleuchtet, dass wir das Licht ausgemacht haben. Der Kapitän sagte, wir sollen Abstand halten. Die Festung will jedes Stück, zahlt doppelt.“',
  },
  pirateLog3: {
    title: 'Piratenlogbuch III',
    text: '„…die Festung hat eine Maschine, die aussieht wie ein Stück von einem Leuchtfeuer. Als sie die Splitter hineingaben, gab sie denselben Ton von sich wie draußen in den Gürteln. Seitdem schläft dort niemand mehr.“',
  },
  shard: {
    title: 'Leuchtender Splitter',
    text: 'Ein Kristallsplitter mit rotem Herz, warm sogar durch den Handschuh. In den Frachtraum will er nicht; er bleibt beim Cockpit. Nahe den Echos schwingt er mit – und der Scanner hört Leuchtfeuer, die sonst stumm sind.',
  },
  ruleResonance: {
    title: 'Beobachtung: die Splitter schwingen mit',
    text: 'Mit einem Splitter an Bord hat der Puls ein Leuchtfeuer erfasst, das stumm gewesen war. Die Splitter und die Echos sind aus einem Guss – oder zumindest aus einer Schmiede.',
  },
  echo2: {
    title: 'Echo-2',
    text: 'Das dritte Leuchtfeuer blieb stumm, bis wir einen Splitter hatten. Jetzt antwortet es beiden. Sein Ton zeigt tiefer in die Gürtel, wohin der Rost niemanden lässt. Wenn die Splitter etwas öffnen, ist das Schloss dort.',
  },
  fortress: {
    title: 'Rostfestung',
    text: 'Ein Fels mit einem daran klebenden Nest, tief in den Gürteln. Von dort kommen die Schiffe mit der Klaue an der Flanke.',
  },
  derelictLog_a: {
    title: 'Protokoll: Habitatring',
    text: '„Tag 212. Der Ring dreht sich langsamer, wir sparen Strom. Die Gilde hat einen Tanker versprochen; er kam nie. Die Familien sind mit dem letzten Schiff weg, drei von uns sind geblieben. Wenn du das liest, leben die Relais noch – wir haben sie für dich gelassen. Nimm, was du findest, und schließ die Luke hinter dir.“',
  },
  derelictLog_b: {
    title: 'Protokoll: Forschungsstation',
    text: '„Die Schüssel hat einen Ton aufgefangen – drei Schläge und Stille. Derselbe, den man nahe der Heimat hört, nur stärker. Die Doktorin wollte weitermessen, bis eine der Kapseln aufriss. Wir haben die Messwerte im Terminal gespeichert. Wenn du vom Institut bist, gehören sie dir.“',
  },
  derelictLog_c: {
    title: 'Protokoll: Bergbauplattform',
    text: '„Das Eisen dieses Felsens hat uns acht Jahre ernährt. Dann kamen die Schiffe mit der Klaue an der Flanke und wollten einen Anteil. Wir haben einmal gezahlt, nicht zweimal. Der Kran fiel beim ersten Schuss. Wir lassen die Wachdrohnen an – sollen die Nächsten kommen und holen, was ihnen gehört.“',
  },
  derelictLog_d: {
    title: 'Protokoll: Relaisturm',
    text: '„Der Turm trug Nachrichten zwischen den Gürteln und der Heimat. Als der Mast brach, dauerte die Stille drei Tage. Dann tauchte ein fremder Ton auf unserer Frequenz auf, und niemand sendete ihn. Wir haben den Rekorder laufen lassen. Am Ende des Bands sind nur drei Schläge und Stille.“',
  },
};
