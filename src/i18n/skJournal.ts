// Slovak journal entries (long-term design 5.6, 12.3): the title and the text of every knowledge-graph
// entry. An entry is at most 60 words, short, human, without pathos (no exclamation marks); the graph
// itself (kinds, links, triggers, positions) is data in src/data/journal.ts. enJournal.ts implements the
// same ids in English.
import type { JournalId } from '../data/journal';

export interface JournalText {
  title: string;
  /** At most 60 words (JOURNAL_MAX_WORDS), no exclamation marks. */
  text: string;
}

export type JournalTexts = Record<JournalId, JournalText>;

export const skJournal: JournalTexts = {
  scanner: {
    title: 'Skener',
    text: 'Pulz zachytí, čo radar nevidí. Signál je len otázka: smer, vzdialenosť a kruh neistoty. Odpoveď dostaneš, až keď priletíš. Podržaním Tab na objekte ho analyzuješ – Inštitút platí Dátami a Archív za ne odomyká diely.',
  },
  echo0Heard: {
    title: 'Tón pri domove',
    text: 'Tri údery a ticho, stále dokola. Žiadna z našich frekvencií. Inštitút tvrdí, že znie od začiatku osídlenia a nikto ho poriadne nezameral. Z jedného miesta sa dá určiť len smer – treba počúvať aspoň z troch.',
  },
  echo0: {
    title: 'Ozvena-0',
    text: 'Trojnožka z čiernych čepelí a kryštál, ktorý sa pomaly otáča. Staršie než čokoľvek, čo tu máme. Signál nie je správa, skôr opakovanie – ako ozvena niečoho, čo sa stalo dávno. Mieri von, k Vonkajším pásom.',
  },
  decoder: {
    title: 'Frekvencie Kováčov',
    text: 'V signáli Ozveny-0 je druhá vrstva utopená v šume. Archív Inštitútu má filter, ktorý ju vytiahne. S ním by skener mal počuť aj ďalšie majáky – ak nejaké sú.',
  },
  anomalies: {
    title: 'Anomálie',
    text: 'Miesta, kde priestor nesedí s výpočtom: gravitácia bez hmoty, iónové výboje, žiarenie bez zdroja, ozvena času. Inštitút platí za každý sken. Kto preletí jadrom, odnesie si z neho niečo – niekedy aj šrám.',
  },
  ruleSling: {
    title: 'Pozorovanie: prak',
    text: 'Jadro gravitačnej anomálie loď na chvíľu vystrelí. Motory ťahajú silnejšie, kým sa pole za loďou nezavrie. Kto pozná trasu, ušetrí palivo aj čas.',
  },
  ruleCharge: {
    title: 'Pozorovanie: iónový náboj',
    text: 'Prelet iónovým jadrom vybije štít do nuly. Batéria sa však nabije a reaktor chvíľu beží nad normál. V boji zlý nápad, pri ťažbe dobrý.',
  },
  ruleRadiation: {
    title: 'Pozorovanie: žiarenie',
    text: 'Radiačné jadro popáli diel, ktorý mu je najbližšie. Skener potom chvíľu vidí ďalej, akoby sa naň niečo nalepilo. Pancier na tej strane sa oplatí.',
  },
  ruleTime: {
    title: 'Pozorovanie: ozvena času',
    text: 'V ozvene času sa lasery neprehrievajú a skener sa nabíja dvakrát rýchlejšie. Palubné hodiny potom chvíľu meškajú. Nikto nevie prečo.',
  },
  caches: {
    title: 'Úkryty',
    text: 'Niekto tu schováva veci tak, aby ich radar nevidel. Pulz zachytí len odraz – kruh, kde by úkryt mohol byť. Každý ďalší pulz z iného miesta kruh zúži. Po troch či štyroch je poloha istá.',
  },
  cacheFound: {
    title: 'Otvorený úkryt',
    text: 'Kontajner bez značky, pripútaný k skale. Vnútri kredity, suroviny a občas útržok plánu. Na veku vyškrabaný pazúr – rovnaký, aký nosia lode Hrdze.',
  },
  wrecks: {
    title: 'Vraky',
    text: 'Lode z rovnakých dielov ako tvoja. Pred rozobratím ich naskenuj: ukáže sa, čo prežilo a či je v nich fragment plánu. Pirátske vraky vozia skôr bojové diely, nákladné logistiku.',
  },
  plans: {
    title: 'Plány',
    text: 'Fragment je kus výrobného plánu. Tri fragmenty dajú plán variantu – diel, ktorý mení jednu-dve vlastnosti za jasnú cenu. Fragmenty sa nestratia, ani keď loď zhorí. Dvojitý fragment Inštitút vymení za Dáta.',
  },
  giants: {
    title: 'Obrie asteroidy',
    text: 'Kameň s tvrdou škrupinou. Bežný laser ju len zahreje – treba ťažký laser alebo kanón. Pod ňou je jadro, hustejšie a bohatšie než okolie.',
  },
  giantCore: {
    title: 'Pozorovanie: jadro obra',
    text: 'Keď škrupina praskne, platne sa rozletia a jadro ostane holé. Ťaží sa o polovicu rýchlejšie než bežný kameň a vystačí na niekoľko plných nákladov.',
  },
  distress: {
    title: 'Núdzové signály',
    text: 'Ťažiar bez paliva, loď s dierou v trupe. Cech platí za pomoc a pamätá si mená. Nie každé volanie je však úprimné – piráti vedia vysielať ako ktokoľvek.',
  },
  trap: {
    title: 'Pozorovanie: nesúlad signatúry',
    text: 'Pri druhom skene volajúcej lode nesedí signatúra s trupom. Motory má teplé, hoci tvrdí, že stojí. Pasca. Kto skenuje dvakrát, nemusí sa naučiť bolestivo.',
  },
  echo1: {
    title: 'Ozvena-1',
    text: 'Rovnaký maják, iný tón. Na čepeliach sú stopy po rezaní – niekto sa pokúšal vylomiť kryštál. Signál zosilnie, keď sa doň opiera iný kryštál Kováčov. Piráti vraj také úlomky zbierajú.',
  },
  pirateLog1: {
    title: 'Pirátsky denník I',
    text: '„…Kotol zas platí za červené kúsky. Svietia, keď sa k nim priblížiš so zapnutým skenerom. Šéf ich zbiera do debny a nikomu nepovie načo. Zajtra ideme na ťažiarov pri Kotve.“',
  },
  pirateLog2: {
    title: 'Pirátsky denník II',
    text: '„…pri starom majáku v Pásoch sa úlomok v nákladovom priestore rozžiaril tak, že sme vypli svetlá. Kapitán kázal držať sa ďalej. Pevnosť chce všetky kusy, platí dvojnásobok.“',
  },
  pirateLog3: {
    title: 'Pirátsky denník III',
    text: '„…v pevnosti majú stroj, ktorý vyzerá ako kus majáka. Keď doň vložili úlomky, zaznel ten istý tón ako z Pásov. Odvtedy tam nikto nespí.“',
  },
  shard: {
    title: 'Žiariaci úlomok',
    text: 'Kúsok kryštálu s červeným jadrom, teplý aj cez rukavicu. Nevojde do nákladu, drží sa pri kokpite. V blízkosti Ozvien rezonuje – skener potom počuje aj majáky, ktoré inak mlčia.',
  },
  ruleResonance: {
    title: 'Pozorovanie: úlomky rezonujú',
    text: 'S úlomkom na palube pulz zachytil maják, ktorý predtým mlčal. Úlomok a Ozveny sú z jedného kusu – alebo aspoň z jednej dielne.',
  },
  echo2: {
    title: 'Ozvena-2',
    text: 'Tretí maják mlčal, kým sme nemali úlomok. Teraz odpovedá oboma. Jeho tón ukazuje hlbšie do Pásov, kam Hrdza nepúšťa nikoho. Ak úlomky niečo otvárajú, zámok bude tam.',
  },
  fortress: {
    title: 'Hrdzavá pevnosť',
    text: 'Skala s prilepeným hniezdom v hĺbke Pásov. Odtiaľ prichádzajú lode s pazúrom na boku.',
  },
  derelictLog_a: {
    title: 'Záznam: obytný prstenec',
    text: '„Deň 212. Prstenec sa točí pomalšie, šetríme prúd. Cech sľúbil tankovú loď, neprišla. Rodiny odleteli s poslednou loďou, ostali sme traja. Ak to niekto číta, relé ešte žijú – nechali sme ich pre teba. Vezmi si, čo nájdeš, a zatvor za sebou.“',
  },
  derelictLog_b: {
    title: 'Záznam: výskumná stanica',
    text: '„Anténa zachytila tón – tri údery a ticho. Ten istý ako pri domove, len silnejší. Doktorka chcela merať ďalej, kým sa jedna z kapsúl neroztrhla. Merania sme uložili do terminálu. Ak ste z Inštitútu, patria vám.“',
  },
  derelictLog_c: {
    title: 'Záznam: ťažobná plošina',
    text: '„Železo z tejto skaly nás živilo osem rokov. Potom prišli lode s pazúrom na boku a chceli podiel. Raz sme zaplatili, druhýkrát nie. Žeriav padol pri prvom výstrele. Strážne drony nechávame zapnuté – nech si ďalší prídu po svoje.“',
  },
  derelictLog_d: {
    title: 'Záznam: retranslačná veža',
    text: '„Veža prenášala správy medzi Pásmi a domovom. Keď stožiar praskol, ticho trvalo tri dni. Potom sa na našej frekvencii ozval cudzí tón a nikto ho nevysielal. Nechali sme záznamník bežať. Na konci pásky sú len tri údery a ticho.“',
  },
};
