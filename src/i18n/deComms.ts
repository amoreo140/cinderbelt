// German texts of the communicator – the same keys as skComms.ts (CommsTexts); the terms follow GLOSSARY-DE.md.
import type { CommsTexts } from './skComms';

export const deComms: CommsTexts = {
  speakers: {
    instructor: 'Meister Hale',
    traffic: (station) => `${station} · Verkehr`,
    contracts: (station) => `${station} · Aufträge`,
    jackal: 'Rost-Schakal',
    hammer: 'Rost-Hammer',
    echoUnknown: 'Unbekanntes Signal',
    echoNamed: 'Schmiede-Echo',
    distress: 'Notruf',
    stranded: 'Gestrandetes Schiff',
    unknown: 'Unbekannte Stimme',
    gunner: 'Rost-Schütze',
    institute: 'Observatorium des Instituts',
    derelictAi: 'Stationsstimme',
  },
  roles: {
    instructor: 'Gildenausbilder',
    traffic: 'Verkehrsleitung',
    contracts: (faction) => `Aufträge · ${faction}`,
    pirate: 'Pirat',
    captain: (clan) => `Kapitän · ${clan}`,
    fortress: 'Rostfestung',
    echo: 'Signal',
    distress: 'Notsignal',
    research: 'Forschung des Instituts',
    derelict: 'Stationsautomat',
    convoy: 'Konvoi · Freie Händler',
    escort: 'Begleiteter Konvoi',
  },
  bearing: {
    clock: (hour) => `auf ${hour} Uhr`,
    inTime: (s) => (s < 60 ? `in ${Math.max(1, Math.round(s))} s` : `in ${Math.round(s / 60)} min`),
    contacts: (w) => `Kontakte ${w} – Hinterhalt.`,
  },
  factions: { guild: 'Gilde', institute: 'Institut' },
  clans: { rust: 'Rost', cauldron: 'Kessel', slantedStar: 'Schiefer Stern' },
  lines: {
    station: {
      zone: [
        'Wir haben dich auf dem Radar. Die Klammer am Ende des Arms ist frei.',
        'Anfliegendes Schiff, hier Verkehrsleitung. Komm langsam an die Klammer.',
        'Willkommen in unserem Raum, Pilot. Der Andockarm liegt direkt vor dir.',
      ],
      granted: ['Die Klammer hat dich. Wir ziehen dich rein.', 'Gefangen. Willkommen an Bord.', 'Sauberer Anflug. Klammer gesichert.'],
      rejected: ['Negativ, so können wir dich nicht fangen.', 'Die Klammer meldet einen schlechten Anflug.', 'Abgelehnt – korrigier den Anflug und versuch es noch mal.'],
      undocked: ['Bahn frei. Guten Flug.', 'Klammern gelöst. Pass auf dich auf da draußen.', 'Abflug bestätigt. Komm heil zurück.'],
    },
    contract: {
      accepted: ['Abgemacht. Wir zählen auf dich.', 'Der Zettel gehört dir. Melde dich, wenn es erledigt ist.', 'Eingetragen. Viel Glück, Pilot.'],
      ready: ['Bestätigt, Auftrag erledigt. Komm deine Bezahlung holen.', 'Erledigt, wir sehen es. Die Belohnung wartet auf der Station.'],
      completed: ['Ausgezahlt. Gute Arbeit, Pilot.', 'Genau das wollten wir. Danke dir.', 'Die Credits sind drin. Komm wieder.'],
      rescued: ['Treibstoff erhalten! Danke, wir sind unterwegs.', 'Die Tanks füllen sich. Wir schulden dir was, Pilot.'],
    },
    pirate: {
      tollDemand: [
        (a) => `Das hier ist Rost-Raum. ${a} und du darfst weiterfliegen.`,
        (a) => `Halt, Pilot. ${a} Wegzoll, oder wir nehmen dich auseinander.`,
        (a) => `Hübsche Fracht. Für ${a} schauen wir nicht hin.`,
      ],
      tollPaid: ['Kluger Pilot. Flieg.', 'Geschäft ist Geschäft. Verschwinde.', 'Na gut. Dich haben wir heute nie gesehen.'],
      tollRefused: ['Schlechte Wahl. Feuer frei!', 'Dann holen wir es uns selbst!'],
      tollTimeout: ['Genug gewartet. Schnappt ihn!', 'Die Zeit ist um. Feuer!'],
      tollEscaped: ['Entwischt… nächstes Mal hast du nicht so viel Glück.', 'Lasst ihn. Der kommt wieder.'],
      alert: ['Hab ihn! Alle drauf!', 'Ziel in Reichweite. Nehmt es auseinander!', 'He, Bergmann! Die Fracht gehört uns.'],
      hunt: ['Wir suchen dich, Pilot. Weglaufen bringt nichts.', 'Die Jagdgesellschaft ist unterwegs. Wir wissen, wo wir dich finden.'],
      challenge: [(m) => `Herausforderung angenommen. Sei in ${m} min am Leuchtfeuer.`, (m) => `Du willst einen Kampf? Kriegst du – in ${m} min am Leuchtfeuer.`],
      raid: [(w) => `Mach dich bereit, ${w}. Der Rost kommt für deine Kriegskasse.`, (w) => `${w}, mach deine Lager auf. Wir holen uns, was uns gehört.`],
      raidArrived: ['Wir sind da! Nehmt alles mit!', 'Überfall! Keine Gnade!'],
      ambush: ['Danke fürs Anhalten. Und jetzt die Fracht.', 'Hilfe? Hier braucht niemand Hilfe, Pilot.'],
      ambushWarn: ['Schön langsam, Bergmann. Wir sind näher, als du denkst.', 'Die Dunkelheit gehört uns, Pilot. Das merkst du gleich.', 'Ruhig, Jungs… und jetzt! Schnappt ihn!'],
      relayCounter: ['Wer hat unsere Route beleuchtet? Macht das Relais kaputt!', 'Die Gilde hat hier nichts verloren. Wir holen uns das Relais – und dich.'],
    },
    gunner: {
      ambush: ['Schütze in Position. Halt deinen Kurs, Pilot – dann ziele ich leichter.', 'Ich hab dich im Visier. Komm nicht näher, ich mag keine Gesellschaft.'],
      alert: ['Ziel erfasst. Feuer aus der Distanz!', 'Bleib auf Abstand und du brennst. Komm näher und ich bin weg.', 'So ein großes Schiff. Kaum zu verfehlen.'],
    },
    watch: {
      micrometeors: [
        (w, when) => `Hier Gildenwache: Mikrometeoritenschauer ${w}, ${when}. Dreh deine Panzerung in den Strom.`,
        (w, when) => `Gildenwache an alle Schiffe: Mikrometeoriten ${w}, ${when}. Zeig dem Strom ein schmales Profil und Panzerung.`,
      ],
      engaged: ['Kontakt, greifen an.', 'Gildenwache greift an. Auf unserem Revier bleibt kein Pirat.', 'Wir sehen sie. Patrouille greift an.'],
      defend: ['Wir geben dir Deckung, Pilot.', 'Bleib dicht bei uns, Pilot – wir übernehmen sie.', 'Gildenwache im Anflug. Halt durch!'],
      retreat: ['Schwerer Schaden, wir ziehen uns zurück.', 'Rumpf am Limit. Brechen ab.'],
      relayRepaired: [
        'Hier Gildenwache: Relais repariert. Jetzt lad es mit deinem Bergbaulaser auf.',
        'Reparatur bestätigt. Lad das Relais mit deinem Laser auf und die Route gehört wieder uns.',
      ],
      relayHold: [
        (w, when) => `Vorsicht, Pilot! Der Rost hat das Relaissignal aufgefangen – Kontakte ${w}, ${when}. Halt das Relais, Verstärkung der Gilde ist unterwegs.`,
        (w, when) => `Gildenwache: Gegenangriff des Rosts ${w}, ${when}. Halt sie vom Relais fern, wir kommen.`,
      ],
      reinforcement: ['Gildenwache vor Ort! Eine Fregatte und zwei Kutter, wir übernehmen sie.', 'Die Verstärkung der Gilde ist da. Jetzt drängen wir sie gemeinsam zurück.'],
      secured: [
        (s) => `Sektor ${s} ist ab jetzt Bewacht. Die Gilde dankt dir, Pilot.`,
        (s) => `Das Relais hält und der Rost hat sich zurückgezogen. ${s} steht ab jetzt unter dem Schutz der Wache.`,
      ],
    },
    convoy: {
      flyby: [
        (when, w) => `Hier Konvoi der Freien Händler: Wir fliegen ${when} vorbei, ${w}. Unser Handel ist offen.`,
        (when, w) => `Freie Händler rufen: Wir sind ${w} und kommen ${when} an dir vorbei. Komm an den Port, wenn du handeln willst.`,
      ],
      linked: ['Die Kupplung hält. Schau dir an, was wir dabeihaben.', 'Gekoppelt. Der Frachtraum ist offen, such dir was aus.', 'Sauber angepasst. Lass uns handeln.'],
      traded: ['War mir ein Vergnügen.', 'Abgemacht. Steht in den Büchern.', 'Guter Handel, Pilot.'],
    },
    escort: {
      departed: ['Bereit, wir folgen dir.', 'Triebwerke laufen. Bleib dicht bei uns, Pilot.'],
      stopped: ['Piraten an uns dran! Wir halten an – gib uns Deckung!', 'Wir warten hier, solange Piraten unterwegs sind. Vertreib sie!'],
      ambush: [(w) => `Kontakte voraus ${w}! Vorsicht, Hinterhalt.`, (w) => `Da bewegt sich was ${w}. Mach dich bereit, Pilot.`],
      arrived: ['Wir sind da, und zwar in einem Stück. Danke, Pilot – die Station zahlt dir die Belohnung.', 'Geschafft. Mit dir fliegt es sich sicher.'],
    },
    convoyUnlinked: {
      player: ['Entkoppelt. Gute Reise, Pilot.', 'Kupplung gelöst. Jederzeit wieder.'],
      turnaround: ['Wir wenden am Ende der Route – wir koppeln dich ab.', 'Ende der Route, wir wenden. Kupplung gelöst.'],
      pirates: ['Piraten! Wir koppeln dich ab, halt dich von uns fern!', 'Rost-Kontakte – Kupplung gelöst, der Handel ist vorbei.'],
      passOver: ['Die Route ist zu Ende. Kupplung gelöst.', 'Wir sind am Ende der Route. Wir koppeln ab.'],
      blocked: ['Ein Felsen im Weg deines Schiffs – wir lösen und bremsen dich.', 'Neben uns passt du nicht durch, da ist ein Felsen. Kupplung gelöst.'],
    },
    convoyRejected: {
      tooFar: ['Unser Handelsport ist auf der Backbordseite, Pilot. Komm näher heran.', 'So können wir dich nicht fangen – näher an den Port.'],
      tooFast: ['Langsamer, Pilot! Pass dich unserem Tempo an.', 'Du bist zu schnell. Flieg mit uns, nicht an uns vorbei.'],
      pirates: ['Solange Piraten unterwegs sind, bleibt der Port zu.', 'Kümmer dich erst um die Piraten, dann handeln wir.'],
    },
    escortFailed: {
      traderLost: ['Wir haben den Konvoi verloren. Der Auftrag ist hinfällig.', 'Der Händler ist weg. Die Eskorte ist gescheitert.'],
      playerLost: ['Dein Schiff ist untergegangen. Der Konvoi fliegt ohne Eskorte weiter – der Auftrag ist hinfällig.', 'Ohne dein Schiff ist die Eskorte vorbei. Der Auftrag ist hinfällig.'],
      missed: ['Länger konnten wir nicht warten, Pilot. Wir fliegen ohne dich.', 'Die Zeit ist um. Wir fliegen ohne Eskorte.'],
      abandoned: ['Du hast uns allein gelassen. Mit dir fliegen wir nicht mehr.', 'Keine Eskorte, kein Flug. Der Auftrag ist hinfällig.'],
    },
    comet: {
      flyby: [
        (c, when, w) => `Hier Observatorium des Instituts: ${c} zieht ${when} an dir vorbei, ${w}. Sein Kern enthält Eis und Titan.`,
        (c, when, w) => `${c} kommt – ${when}, ${w}. Fang ihn ab und bau im Vorbeiflug ab.`,
      ],
      sighted: [(c) => `${c} auf deinen Sensoren. Das Institut zeichnet seine Bahn auf.`, (c) => `Wir haben ihn: ${c}. Seine Bahn findest du auf der Karte.`],
    },
    derelict: {
      relay: [(lit, total) => `…Relais ${lit}/${total}… Busspannung… wiederhergestellt…`, (lit, total) => `[Energie ${lit}/${total}] …Systeme erwachen…`],
      ready: ['…alle Relais versorgt… Andockklammer freigegeben… verbinde dich, Schiff…', '[Energie 3/3] Klammer bereit. Erwarte Verbindung.'],
      greeting: [
        '…Identifikation… ein Schiff der Gilde? Die Gilde… gibt es noch? Das Terminal gehört dir, Pilot.',
        'Verbindung bestätigt. Öffne das Stationsarchiv. Die letzte Schicht… ist lange her.',
      ],
      welcomeBack: ['…du schon wieder… das Terminal ist offen.', 'Verbindung bestätigt. Willkommen zurück.'],
      unpowered: [(lit, total) => `…Klammer ohne Energie… Relais ${lit}/${total}…`, (lit, total) => `[Energie ${lit}/${total}] Andocken unmöglich.`],
      rejected: ['…Anflugfehler… Klammer rastet nicht ein…', 'Anflug außerhalb der Toleranz. Versuch es noch mal.'],
      farewell: ['…Verbindung getrennt… komm zurück…', 'Getrennt. Die Station schläft wieder ein.'],
    },
    derelictWake: {
      sentries: ['EINDRINGLING IM PERIMETER. AKTIVIERE WACHDROHNEN.', '…unbefugte Energie… Verteidigungsprotokoll… Drohnen starten…'],
      storm: ['…Schildfeld… Überlast… Entladung in die Umgebung…', 'VERTEIDIGUNGSPROTOKOLL: IONENFELD. Entfern dich von der Station.'],
      none: ['…Verteidigungssysteme… reagieren nicht…', '[Verteidigung: offline] …niemand bewacht mich mehr…'],
    },
    graveyard: {
      sleepersWoke: ['Aufwachen, Jungs! Die Beute ist von selbst reingekrochen.', 'Genug geschlafen – schnappt ihn!', 'Dachtest, wir sind bloß Schrott? Überraschung!'],
    },
    captain: {
      appear: ['Endlich treffen wir uns, Pilot.', 'Das ist mein Revier. Du hättest zu Hause bleiben sollen.', 'Sieh mal an, wer da reingeflogen ist.'],
      fled: ['Das merk ich mir!', 'Wir sehen uns wieder, Pilot!', 'Rückzug! Nächstes Mal endet es anders.'],
      gloat: ['Hübsches Stück. Das behalte ich.', 'Danke fürs Andenken, Pilot.'],
      defeated: ['Das… ist nicht das Ende des Rosts…', 'Ich hätte dich nicht unterschätzen sollen…'],
    },
    fortress: {
      alarm: ['Alarm! Fremdes Schiff in Reichweite der Geschütztürme!', 'Die Festung meldet einen Eindringling. Alle Schiffe raus!'],
      reinforcements: ['Hangar offen – Schakale, raus!', 'Verstärkung startet. Lasst ihn nicht zu Atem kommen!'],
    },
    distress: {
      fuel: ['Mayday, Mayday. Kein Treibstoff mehr, wir treiben. Hört uns jemand?', 'Hier ein Bergmann in Not. Leere Tanks, wir brauchen Treibstoff.'],
      repair: ['Mayday. Unser Rumpf ist leck, wir brauchen Eisen für Reparaturen.', 'Hier ein beschädigtes Schiff. Ohne Reparatur schaffen wir es nicht. Hilfe!'],
      resolved: ['Danke, Pilot! Die Gilde wird davon erfahren.', 'Du hast uns gerettet. Das vergessen wir dir nicht.'],
    },
    echo: {
      heard: ['[drei Schläge · Stille · drei Schläge]', '[…ein Ton unter dem Rauschen… wiederholt sich…]'],
      located: ['[Signal stabil · Quelle erfasst]', '[die Schläge werden lauter · Peilung bestätigt]'],
      journal: ['[…S·c·h·m·i… …S·t·e·r·n·e…]', '[Echo: …jemand… hört zu…]'],
      shard: ['[der Splitter antwortet · Resonanz]', '[der rote Kern klingt im selben Ton]'],
      resonator: ['[der Festungskern klingt im Ton des Leuchtfeuers]'],
    },
    home: {
      paintShop: [
        'Die Lackiererei ist bereit, Pilot. Such dir eine Farbe aus – das Portal erledigt den Rest.',
        'Lackiererei in Betrieb. Bring sie rein und wähl einen Lack, geht aufs Haus.',
      ],
      trophyHall: [
        'Die Trophäenhalle ist offen. Sechs Sockel warten auf das, was du nach Hause bringst.',
        'Trophäenhalle bereit. Sollen die Clans ruhig sehen, was mit denen passiert, die sich mit dir anlegen.',
      ],
      module: [(m) => `${m} ist fertig und in Betrieb. Gute Arbeit, Pilot.`, (m) => `Bau abgeschlossen: ${m}. Die Station wächst mit dir.`],
    },
  },
  instructor: {
    intro: {
      flyBuoy: [
        'Hier Meister Hale von der Gilde. Der Übungsrumpf gehört dir – dock ab und flieg zur Boje. Lässt du den Schub los, bremsen die Dämpfer von selbst; ein seitliches Rutschen stoppen nur langsam die Cockpitdüsen, Seitentriebwerke hast du noch keine.',
        'Willkommen in der Ausbildung, Pilot, ich bin Hale. Zuerst lernst du fliegen: Erreich die Boje der Gilde. Lass den Schub los und die Dämpfer bremsen dich – seitlich nur langsam, mit den schwachen Cockpitdüsen.',
      ],
      mineIron: [
        'Jetzt der Übungsfelsen: Bau 20 Eisen daraus ab. Richte den Laser auf die leuchtende Ader – dort geht der Abbau um die Hälfte schneller.',
        'Eisen ist dein erstes Einkommen. Flieg nah an den Felsen, brems ab und ziel auf die leuchtende Ader – da geht es am schnellsten.',
      ],
      dockSell: [
        'Flieg heim und verkauf das Eisen. Komm langsam und mit dem Bug voran an die Klammer, sonst fängt sie dich nicht. Für den ersten Verkauf bekommst du von der Gilde zwei Seitentriebwerke.',
        'Ab nach Hause, Pilot. Brems an der Klammer ab, dreh den Bug zur Station und drück F. Für das Eisen gibt dir die Gilde zwei Seitentriebwerke.',
      ],
      installSide: [
        'Die Seitentriebwerke liegen im Lager. Bau sie in der Werft an die Seiten, Düse nach außen – dann stoppen die Dämpfer ein seitliches Rutschen sofort, nicht nur langsam über die Düsen.',
        'Jetzt die Werft: an jede Flanke ein Seitentriebwerk, Düse nach außen. Danach trägt dich nichts mehr seitwärts.',
      ],
      brakeBuoy: [
        'Wer anhalten kann, baut keinen Unfall. Flieg zur zweiten Boje und halt dort unter 1,5 E/s an. Die Belohnung ist ein zweites Rückwärtstriebwerk.',
        'Ein Bremstest: Halt an der zweiten Boje fast reglos an. S bremst, die Dämpfer erledigen den Rest. Die Belohnung ist ein zweites Rückwärtstriebwerk.',
      ],
      installReverse: [
        'Bau das zweite Rückwärtstriebwerk mit der Düse zum Bug ein. Zwei bremsen doppelt so stark – du hältst auf der halben Strecke an.',
        'Setz in der Werft das zweite Rückwärtstriebwerk ein, Düse nach vorn. Mit zweien hältst du auf der halben Strecke an.',
      ],
      craftCargo: [
        'Mehr Fracht, weniger Heimflüge. Stell in der Fertigung einen Frachtraum her und bau ihn ein – Material und Gebühr zahlt die Gilde.',
        'Fertige einen Frachtraum und bau ihn ins Schiff ein. Material und Gebühr gehen auf die Gilde.',
      ],
      checklist: [
        'Eine Prüfung vor der Reise: voll tanken, die Ziele ansehen und im Flug die Karte. Die Karte zeigt Ursprung, die Gildenroute und die rote Ecke – flieg dort nicht ohne Kanone hin.',
        'Letzte Vorbereitungen: voller Tank, die Ziele und die Karte – die Karte geht nur im Flug auf. Für die Prüfung gibt dir die Gilde auch die Karte des ersten Abschnitts der Route.',
      ],
      finishShip: [
        'Die letzten Teile liegen im Lager: ein Reaktor, ein Radar, ein Gyroskop und ein zweites Haupttriebwerk. Bau sie ein und das Schiff ist fertig.',
        'Mach das Schiff fertig: Reaktor, Radar, Gyroskop und ein zweites Haupttriebwerk. Dann lässt dich die Gilde allein fliegen.',
      ],
    },
    praise: [(r) => `Gut gemacht, Pilot. Die Gilde hat dir ${r} gutgeschrieben.`, (r) => `Genau so. Deine Belohnung: ${r}.`, (r) => `So gefällt mir das. Du bekommst ${r}.`],
    reward: {
      credits: (c) => c,
      parts: (c, p) => `${c} und ${p} ins Lager`,
      kit: (c) => `${c} und das Material für einen Frachtraum`,
    },
    done: [
      'Das Schiff ist fertig und gehört dir. Die Tafel der Station bietet Arbeit. Guten Flug, Pilot.',
      'Und jetzt bist du Pilot der Gilde. Aufträge hängen an der Tafel der Station. Melde dich, wenn du was brauchst.',
    ],
    nudge: {
      flyBuoy: ['Die Boje ist dort, wo der Pfeil hinzeigt. W ist der Schub, A und D drehen.', 'Pilot, die Boje wartet nicht ewig. Dreh dem Pfeil nach und gib Schub.'],
      mineIron: ['Halt den Cursor auf dem Felsen und die rechte Taste gedrückt. Der Laser reicht nur ein Stück – flieg näher ran.', 'Der Felsen ist markiert. Brems neben ihm ab und bau mit der rechten Taste ab.'],
      dockSell: ['Drück in der Übersicht „Ganze Fracht verkaufen“ – das ist alles.', 'Das Eisen verkaufst du in der Übersicht. Ein Klick und fertig.'],
      installSide: ['R dreht das Triebwerk, bis seine Düse vom Schiff wegzeigt.', 'Die hervorgehobenen Zellen neben dem Rumpf sind die richtigen Plätze. Dann mit Enter bestätigen.'],
      brakeBuoy: ['Lass an der Boje den Schub los und brems mit S. Unter 1,5 E/s zählt es.', 'Keine Eile. Langsam zur Boje, und anhalten.'],
      installReverse: ['Dreh das Triebwerk mit R, bis seine Düse zum Bug zeigt. Dann Enter.', 'Das zweite Rückwärtstriebwerk wartet im Lager – Werft, Taste 4.'],
      craftCargo: ['Wähl in der Fertigung den Frachtraum T1 und drück Fertigen.', 'Das gefertigte Teil liegt im Lager – bau es in der Werft ein.'],
      checklist: ['Ein Teil der Prüfung fehlt noch – schau auf die Liste im Ausbildungsfenster.', 'Service tankt auf, G öffnet die Ziele, M im Flug die Karte.'],
      finishShip: ['Reaktor, Radar, Gyroskop, ein Haupttriebwerk – alles liegt im Lager.', 'Das Ausbildungsfenster zeigt, was noch fehlt. Dann Enter.'],
    },
    nudgeUndock: ['Erst abdocken – die Schaltfläche Abdocken oder F.', 'Im Dock lernst du das nicht. Dock ab, Pilot.'],
    nudgeDock: ['Dock an der Station an: langsam zur Klammer, Bug zur Station, dann F.', 'Die Teile warten im Lager der Station. Dock an, Pilot.'],
  },
  firstContact: {
    pirate: ['Sieh an, ein frisches Schiff der Gilde. Dein Übungsflug endet hier, Bergmann.', 'Ein grüner Pilot in unserem Raum? Heute wird ein guter Fang.'],
    warnInstructor: [
      'Pilot, das ist der Rost – Piraten. Kämpf nicht mit dem Übungsrumpf gegen sie: Zahl den Wegzoll oder flieh zur Station.',
      'Vorsicht, Rost-Piraten! Dein Schiff ist nicht zum Kämpfen gebaut. Flieg zur Station, dort trauen sie sich nicht hin.',
    ],
    warnTraffic: [
      'Hier Verkehrsleitung: Du hast Rost-Piraten auf dem Radar. Wenn sie Wegzoll verlangen, ist Zahlen billiger als ein neuer Rumpf.',
      'Vorsicht, Pilot – Rost-Piraten. Bleib in der Nähe der Stationen oder mach dich kampfbereit.',
    ],
    pirateRetort: ['Hör auf sie, Pilot. Die Klugen zahlen.', 'Lauf, so viel du willst. Wir finden dich sowieso.'],
    echo: ['[…Rauschen… drei Schläge… Stille… drei Schläge…]', '[…ein Ton unter dem Rauschen… schwillt an… verklingt…]'],
    echoReaction: [
      'Hörst du das auch? Der Ton ist nicht von uns – so sendet kein Leuchtfeuer der Gilde.',
      'Auf dieser Frequenz hat niemand was zu suchen. Schreib es dir auf, Pilot.',
    ],
    echoAgain: ['[…h·ö·r·s·t… …d·u… …u·n·s…?]', '[…w·e·r… …i·s·t… …d·a…?]'],
    ambush: ['Willkommen in der Dunkelheit, Bergmann. Die Gilde schickt ihre Schiffe nicht hier raus – weißt du, warum?', 'Wir haben auf so einen wie dich gewartet. Ein einzelnes Schiff, ein voller Frachtraum.'],
    ambushWarn: [
      'Vorsicht, Pilot – das ist ein Hinterhalt! Sie lauern im Dunkeln auf einzelne Schiffe. Kämpf oder flieh, aber halt nicht an.',
      'Kontakte aus dem Dunkeln, das ist kein Zufall. Piraten machen hier Jagd auf Bergleute – dreh ihnen deine Panzerung zu und bleib in Bewegung.',
    ],
    ambushRetort: ['Lass sie reden. Hier draußen hört uns keiner.', 'Die Gilde ist weit weg, Pilot. Wir sind genau hier.'],
    comet: [
      'Pilot, hier Observatorium des Instituts! Du hast einen Kometen auf den Sensoren – den ersten, den hier seit Langem jemand erwischt.',
      'Hörst du? Ein Komet! Das Institut wartet seit Jahren auf diesen Vorbeiflug und du hast ihn direkt vor der Nase.',
    ],
    cometReaction: [
      'Ein Komet? Der fliegt schneller, als er aussieht. Wenn du ihn abbauen willst, pass dich zuerst seinem Tempo an.',
      'Kometen kommen hier nur ab und zu durch. Ramm bloß nicht den Kern, Pilot.',
    ],
    cometAgain: ['Der Schweif ist reines Eis, der Kern Eis und Titan. Bau im Vorbeiflug ab, bevor er weg ist.', 'Pass dein Tempo dem Kern an und bau ab, solange er vorbeizieht. Der nächste Vorbeiflug ist weit weg.'],
    derelict: ['…Spannung… nach so langer Zeit… Wer ist da? Identifiziere dich, Schiff.', '…erwache… Relais 1… Die Gilde? Ist das die Gilde?'],
    derelictReaction: [
      'Eine verlassene Station antwortet? Die Gilde führt sie seit Jahren als tot. Sei vorsichtig, Pilot.',
      'Das ist ein alter Automat der Gilde. Diese Stationen wurden lange vor deiner Zeit geschlossen – und manche verteidigen sich noch.',
    ],
    derelictAgain: ['…die anderen Relais… dann öffne ich die Klammer… warte…', '…versorge die Relais… die Station erinnert sich… wartet…'],
    watch: ['Hier Gildenwache – Piraten in deiner Nähe, wir greifen an. Bleib dicht bei uns, Pilot.', 'Die Gildenpatrouille sieht die Piraten. Wir gehen rein – du hältst dich seitlich.'],
    watchReaction: [
      'Das ist die Gildenwache. Wo sie patrouilliert, halten sich Piraten nicht lange.',
      'Gildenpatrouillen fliegen die Routen und die Bewachten Sektoren ab. Wenn es brenzlig wird, flieg zu ihnen.',
    ],
    watchAgain: ['Verstanden. Nach dem Kampf zurück auf Patrouille.', 'Wenn du in Schwierigkeiten gerätst, weißt du, wo du uns findest.'],
    convoy: [
      'Hier Freie Händler! Wir fliegen auf der Gildenroute an dir vorbei – seltene Teile an Bord, und wir kaufen auch deine Fracht.',
      'Konvoi der Freien Händler ruft das Gildenschiff. Wir kommen vorbei, der Handel ist offen.',
    ],
    convoyReaction: [
      'Ein Händlerkonvoi? Flieg langsam und mit seinem Tempo an seinen Port auf der Backbordseite und drück F.',
      'Konvois fliegen die Gildenrouten nach einem veröffentlichten Fahrplan – du findest sie auf der Karte. Koppeln am Port, F.',
    ],
    convoyAgain: ['Keine hastigen Bewegungen, Pilot. Pass dich an und wir handeln im Flug.', 'Wir warten auf dich. Das Portlicht brennt, Backbordseite.'],
  },
  panel: {
    radio: 'Funk',
    queued: (n) => `+${n}`,
    journal: 'Journaleintrag',
    skip: 'Klick – fertig lesen / Nachricht schließen',
  },
  log: {
    title: 'Funk',
    subtitle: 'Nachrichtenprotokoll',
    empty: 'Der Funk war bisher still.',
    close: 'L – schließen',
  },
  settings: {
    label: 'Funk',
    options: { all: 'Alles', important: 'Wichtiges', off: 'Aus' },
    hint: 'Wer mit dir spricht: Stationsverkehr, Piraten, Kapitäne, Signale. Aus = kurze Hinweise wie bisher.',
  },
  help: 'L – Funk: Nachrichtenprotokoll',
};
