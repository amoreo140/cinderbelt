// English journal entries – the same ids as skJournal.ts (JournalTexts). At most 60 words per entry, no
// exclamation marks; the voice is terse and quiet, like the Slovak.
import type { JournalTexts } from './skJournal';

export const enJournal: JournalTexts = {
  scanner: {
    title: 'Scanner',
    text: 'A pulse catches what the radar cannot see. A signal is only a question: a direction, a distance and a circle of doubt. The answer comes when you fly there. Hold Tab on an object to analyse it – the Institute pays in Data, and the Archive turns Data into parts.',
  },
  echo0Heard: {
    title: 'A tone near home',
    text: 'Three beats and silence, over and over. None of our frequencies. The Institute says it has sounded since the first settlers came, and nobody has ever pinned it down. One place gives only a direction – you have to listen from at least three.',
  },
  echo0: {
    title: 'Echo-0',
    text: 'A tripod of black blades around a slowly turning crystal. Older than anything we have here. The signal is not a message, more a repetition – like the echo of something that happened long ago. It points outwards, to the Outer Belts.',
  },
  decoder: {
    title: 'Forge-smith frequencies',
    text: 'The Echo-0 signal has a second layer, drowned in the noise. The Institute Archive has a filter that pulls it out. With it the scanner should hear other beacons too – if there are any.',
  },
  anomalies: {
    title: 'Anomalies',
    text: 'Places where space does not match the maths: gravity without mass, ion discharges, radiation with no source, an echo of time. The Institute pays for every scan. Whoever flies through a core takes something away – sometimes a scar.',
  },
  ruleSling: {
    title: 'Observation: the sling',
    text: 'The core of a gravity anomaly flings the ship forward for a moment. The engines pull harder until the field closes behind you. Know the route and you save both fuel and time.',
  },
  ruleCharge: {
    title: 'Observation: ion charge',
    text: 'A pass through an ion core drains the shield to nothing. But the battery fills, and the reactor runs above normal for a while. A bad idea in a fight, a good one for mining.',
  },
  ruleRadiation: {
    title: 'Observation: radiation',
    text: 'A radiation core burns the part nearest to it. Afterwards the scanner sees farther for a while, as if something had stuck to it. Armour on that side pays off.',
  },
  ruleTime: {
    title: 'Observation: time echo',
    text: 'Inside a time echo the lasers do not overheat and the scanner charges twice as fast. Afterwards the ship’s clock runs late for a while. Nobody knows why.',
  },
  caches: {
    title: 'Caches',
    text: 'Someone hides things out here where the radar cannot see them. A pulse catches only a reflection – a circle where a cache might be. Each pulse from another place narrows the circle. After three or four, the position is certain.',
  },
  cacheFound: {
    title: 'An opened cache',
    text: 'An unmarked container strapped to a rock. Inside: credits, resources, sometimes a scrap of a blueprint. A claw is scratched into the lid – the same one the Rust ships carry.',
  },
  wrecks: {
    title: 'Wrecks',
    text: 'Ships built from the same parts as yours. Scan them before you strip them: you see what survived and whether a blueprint fragment is aboard. Pirate wrecks tend to carry combat parts, freighters logistics.',
  },
  plans: {
    title: 'Blueprints',
    text: 'A fragment is a piece of a production blueprint. Three fragments make the blueprint for a variant – a part that changes one or two properties at a clear price. Fragments are not lost even when the ship burns. The Institute trades a duplicate fragment for Data.',
  },
  giants: {
    title: 'Giant asteroids',
    text: 'A rock with a hard shell. An ordinary laser only warms it – it takes a heavy laser or a cannon. Beneath lies the core, denser and richer than anything around it.',
  },
  giantCore: {
    title: 'Observation: a giant’s core',
    text: 'When the shell cracks, the plates fly apart and the core is left bare. It mines half as fast again as ordinary rock and fills several holds.',
  },
  distress: {
    title: 'Distress signals',
    text: 'A miner with no fuel, a ship with a hole in its hull. The Guild pays for help and remembers names. But not every call is honest – pirates can broadcast as anyone.',
  },
  trap: {
    title: 'Observation: signature mismatch',
    text: 'On the second scan the calling ship’s signature does not match its hull. Its engines are warm, though it claims to be dead in space. A trap. Scan twice, and you need not learn the hard way.',
  },
  echo1: {
    title: 'Echo-1',
    text: 'The same beacon, a different tone. The blades bear cut marks – someone tried to break the crystal out. The signal grows stronger when another Forge-smith crystal is near. Pirates are said to collect such shards.',
  },
  pirateLog1: {
    title: 'Pirate log I',
    text: '“…the Cauldron is paying for the red bits again. They glow when you get close with the scanner on. The boss keeps them in a crate and won’t say what for. Tomorrow we hit the miners near Anchor.”',
  },
  pirateLog2: {
    title: 'Pirate log II',
    text: '“…by the old beacon in the Belts the shard in the hold lit up so bright we killed the lights. The captain said keep our distance. The fortress wants every piece, pays double.”',
  },
  pirateLog3: {
    title: 'Pirate log III',
    text: '“…the fortress has a machine that looks like a piece of a beacon. When they fed it the shards, it sounded the same tone as out in the Belts. Nobody sleeps there since.”',
  },
  shard: {
    title: 'Glowing shard',
    text: 'A sliver of crystal with a red heart, warm even through a glove. It will not go in the hold; it stays by the cockpit. Near the Echoes it resonates – and the scanner hears beacons that are otherwise silent.',
  },
  ruleResonance: {
    title: 'Observation: the shards resonate',
    text: 'With a shard aboard, the pulse caught a beacon that had been silent. The shards and the Echoes are of one piece – or at least from one forge.',
  },
  echo2: {
    title: 'Echo-2',
    text: 'The third beacon stayed silent until we had a shard. Now it answers both. Its tone points deeper into the Belts, where the Rust lets no one in. If the shards open something, the lock is there.',
  },
  fortress: {
    title: 'Rust Fortress',
    text: 'A rock with a nest clinging to it, deep in the Belts. That is where the ships with a claw on their flank come from.',
  },
  derelictLog_a: {
    title: 'Log: habitat ring',
    text: '“Day 212. The ring turns slower, we are saving power. The Guild promised a tanker; it never came. The families left on the last ship, three of us stayed. If you read this, the relays still live – we left them for you. Take what you find and close the hatch behind you.”',
  },
  derelictLog_b: {
    title: 'Log: research station',
    text: '“The dish caught a tone – three beats and silence. The same one you hear near home, only stronger. The doctor wanted to keep measuring until one of the pods tore open. We stored the readings in the terminal. If you are from the Institute, they are yours.”',
  },
  derelictLog_c: {
    title: 'Log: mining rig',
    text: '“The iron of this rock fed us for eight years. Then the ships with a claw on their flank came and wanted a share. We paid once, not twice. The crane fell at the first shot. We leave the sentry drones on – let the next ones come for what is theirs.”',
  },
  derelictLog_d: {
    title: 'Log: relay spire',
    text: '“The spire carried messages between the Belts and home. When the mast snapped, the silence lasted three days. Then a strange tone came up on our frequency, and nobody was sending it. We left the recorder running. At the end of the tape there are only three beats and silence.”',
  },
};
