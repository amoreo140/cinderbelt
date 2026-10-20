// English texts of the communicator – the same keys as skComms.ts (CommsTexts), ready for the
// English locale.
import type { CommsTexts } from './skComms';

export const enComms: CommsTexts = {
  speakers: {
    instructor: 'Master Hale',
    traffic: (station) => `${station} · traffic`,
    contracts: (station) => `${station} · contracts`,
    jackal: 'Rust Jackal',
    hammer: 'Rust Hammer',
    echoUnknown: 'Unknown signal',
    echoNamed: 'Forge-smith Echo',
    distress: 'Distress call',
    stranded: 'Stranded ship',
    unknown: 'Unknown voice',
    gunner: 'Rust Gunner',
    institute: 'Institute Observatory',
    derelictAi: 'Station voice',
  },
  roles: {
    instructor: 'Guild instructor',
    traffic: 'Traffic control',
    contracts: (faction) => `Contracts · ${faction}`,
    pirate: 'Pirate',
    captain: (clan) => `Captain · ${clan}`,
    fortress: 'Rust fortress',
    echo: 'Signal',
    distress: 'Distress',
    research: 'Institute research',
    derelict: 'Station automaton',
    convoy: 'Convoy · Free Traders',
    escort: 'Escorted convoy',
  },
  bearing: {
    clock: (hour) => `at ${hour} o'clock`,
    inTime: (s) => (s < 60 ? `in ${Math.max(1, Math.round(s))} s` : `in ${Math.round(s / 60)} min`),
    contacts: (w) => `Contacts ${w} – ambush.`,
  },
  factions: { guild: 'Guild', institute: 'Institute' },
  clans: { rust: 'Rust', cauldron: 'Cauldron', slantedStar: 'Slanted Star' },
  lines: {
    station: {
      zone: [
        'We have you on radar. The clamp at the end of the arm is free.',
        'Approaching ship, this is traffic control. Come in slow to the clamp.',
        'Welcome to our space, pilot. The docking arm is right ahead.',
      ],
      granted: ['The clamp has you. Pulling you in.', 'Caught. Welcome aboard.', 'Nice approach. Clamp secured.'],
      rejected: ['Negative, we cannot catch you like that.', 'The clamp reports a bad approach.', 'Denied – fix the approach and try again.'],
      undocked: ['Clear lane. Fly safe.', 'Clamps released. Take care out there.', 'Departure confirmed. Come back in one piece.'],
    },
    contract: {
      accepted: ['Deal. We are counting on you.', 'The slip is yours. Call in when it is done.', 'Logged. Good luck, pilot.'],
      ready: ['Confirmed, job done. Come back for your pay.', 'Done, we see it. The reward waits at the station.'],
      completed: ['Paid out. Good work, pilot.', 'Exactly what we wanted. Thank you.', 'The credits are in. Come again.'],
      rescued: ['Fuel received! Thank you, we are on our way.', 'Tanks are filling. We owe you, pilot.'],
    },
    pirate: {
      tollDemand: [
        (a) => `This is Rust space. ${a} and you fly on.`,
        (a) => `Hold it, pilot. ${a} toll, or we take you apart.`,
        (a) => `Nice cargo. For ${a} we will not look at it.`,
      ],
      tollPaid: ['Smart pilot. Go.', 'Business is business. Get lost.', 'Fine. We never saw you today.'],
      tollRefused: ['Bad choice. Open fire!', 'Then we take it ourselves!'],
      tollTimeout: ['Enough waiting. Get him!', 'Time is up. Fire!'],
      tollEscaped: ['Got away… you will not be this lucky next time.', 'Let him go. He will be back.'],
      alert: ['Got him! Everyone on him!', 'Target in range. Take it apart!', 'Hey, miner! That cargo is ours.'],
      hunt: ['We are looking for you, pilot. You cannot run.', 'The hunting party is out. We know where to find you.'],
      challenge: [(m) => `Challenge accepted. Be at the beacon in ${m} min.`, (m) => `You want a fight? You will get one – in ${m} min at the beacon.`],
      raid: [(w) => `Get ready, ${w}. The Rust is coming for your treasury.`, (w) => `${w}, open your stores. We are coming for what is ours.`],
      raidArrived: ['We are here! Take everything!', 'Raid! Spare no one!'],
      ambush: ['Thanks for stopping. Now, the cargo.', 'Help? Nobody here needs help, pilot.'],
      ambushWarn: ['Nice and slow, miner. We are closer than you think.', 'The dark is ours, pilot. You are about to find out.', 'Quiet, boys… and now! Get him!'],
      relayCounter: ['Who lit up our lane? Smash that relay!', 'The Guild has no business here. We are coming for the relay – and for you.'],
    },
    gunner: {
      ambush: ['Gunner in position. Hold your course, pilot – it makes aiming easier.', 'I have you in my sights. Do not come closer, I do not like company.'],
      alert: ['Target locked. Fire from range!', 'Keep your distance and you burn. Come closer and I am gone.', 'Such a big ship. Hard to miss.'],
    },
    watch: {
      micrometeors: [
        (w, when) => `Guild Watch here: a micrometeor shower ${w}, ${when}. Turn your armour into the stream.`,
        (w, when) => `Guild Watch to all ships: micrometeors ${w}, ${when}. Show the stream a narrow profile and armour.`,
      ],
      engaged: ['Contact, engaging.', 'Guild Watch engaging. No pirates stay on our beat.', 'We see them. Patrol attacking.'],
      defend: ['We have you covered, pilot.', 'Stay close to us, pilot – we are taking them.', 'Guild Watch inbound. Hold on!'],
      retreat: ['Heavy damage, pulling out.', 'Hull at the limit. Breaking off.'],
      relayRepaired: [
        'Guild Watch here: relay repaired. Now charge it with your mining laser.',
        'Repair confirmed. Charge the relay with your laser and the lane is ours again.',
      ],
      relayHold: [
        (w, when) => `Careful, pilot! The Rust caught the relay signal – contacts ${w}, ${when}. Hold the relay, Guild reinforcements are on the way.`,
        (w, when) => `Guild Watch: Rust counterattack ${w}, ${when}. Keep them off the relay, we are coming.`,
      ],
      reinforcement: ['Guild Watch on station! A frigate and two cutters, we are taking them.', 'Guild reinforcements have arrived. Now we push them back together.'],
      secured: [
        (s) => `Sector ${s} is Guarded from now on. The Guild thanks you, pilot.`,
        (s) => `The relay holds and the Rust fell back. ${s} is under the Watch's protection from now on.`,
      ],
    },
    convoy: {
      flyby: [
        (when, w) => `Free Traders convoy here: we pass by ${when}, ${w}. Our trade is open.`,
        (when, w) => `Free Traders calling: we are ${w}, passing you ${when}. Come to the port if you want to trade.`,
      ],
      linked: ['The coupling holds. Have a look at what we carry.', 'Linked. The hold is open, take your pick.', 'Nicely matched. Let us trade.'],
      traded: ['A pleasure doing business.', 'Agreed. It is in the books.', 'Good trade, pilot.'],
    },
    escort: {
      departed: ['Ready, we follow you.', 'Engines up. Stay close to us, pilot.'],
      stopped: ['Pirates on us! Stopping – cover us!', 'We hold here while the pirates are about. Drive them off!'],
      ambush: [(w) => `Contacts ahead ${w}! Careful, ambush.`, (w) => `Something is moving ${w}. Be ready, pilot.`],
      arrived: ['We are here and in one piece. Thank you, pilot – the station will pay your reward.', 'We made it. Flying with you is safe.'],
    },
    convoyUnlinked: {
      player: ['Unlinked. Safe travels, pilot.', 'Coupling released. Any time.'],
      turnaround: ['We turn at the end of the route – unlinking you.', 'End of the route, turning. Coupling released.'],
      pirates: ['Pirates! Unlinking you, keep away from us!', 'Rust contacts – coupling released, trade is over.'],
      passOver: ['The route is over. Coupling released.', 'We are at the end of the route. Unlinking.'],
      blocked: ['A rock in the path of your ship – releasing and braking you.', 'You will not fit beside us, there is a rock. Coupling released.'],
    },
    convoyRejected: {
      tooFar: ['Our trade port is on the port side, pilot. Come closer to it.', 'We cannot catch you like that – closer to the port.'],
      tooFast: ['Slower, pilot! Match our speed.', 'You are too fast. Fly with us, not past us.'],
      pirates: ['While pirates are about, the port stays shut.', 'Deal with those pirates first, then we trade.'],
    },
    escortFailed: {
      traderLost: ['We lost the convoy. The contract is void.', 'The trader is gone. The escort failed.'],
      playerLost: ['Your ship went down. The convoy flies on without an escort – the contract is void.', 'Without your ship the escort is over. The contract is void.'],
      missed: ['We could not wait any longer, pilot. We leave without you.', 'Time is up. We fly without an escort.'],
      abandoned: ['You left us alone. We do not fly with you again.', 'No escort, no flight. The contract is void.'],
    },
    comet: {
      flyby: [
        (c, when, w) => `Institute Observatory here: ${c} passes by you ${when}, ${w}. Its core carries ice and titanium.`,
        (c, when, w) => `${c} is coming – ${when}, ${w}. Catch it and mine on the move.`,
      ],
      sighted: [(c) => `${c} on your sensors. The Institute is logging its track.`, (c) => `We have it: ${c}. You will find its track on the map.`],
    },
    derelict: {
      relay: [(lit, total) => `…relay ${lit}/${total}… bus voltage… restored…`, (lit, total) => `[power ${lit}/${total}] …systems waking…`],
      ready: ['…all relays powered… docking clamp released… connect, ship…', '[power 3/3] Clamp ready. Awaiting connection.'],
      greeting: [
        '…identification… a Guild ship? The Guild… still exists? The terminal is yours, pilot.',
        'Connection confirmed. Opening the station archive. The last shift… was long ago.',
      ],
      welcomeBack: ['…you again… the terminal is open.', 'Connection confirmed. Welcome back.'],
      unpowered: [(lit, total) => `…clamp without power… relays ${lit}/${total}…`, (lit, total) => `[power ${lit}/${total}] Docking impossible.`],
      rejected: ['…approach error… clamp not locking…', 'Approach out of tolerance. Try again.'],
      farewell: ['…connection closed… come back…', 'Disconnected. The station falls asleep again.'],
    },
    derelictWake: {
      sentries: ['INTRUDER IN THE PERIMETER. ACTIVATING SENTRY DRONES.', '…unauthorised power… defence protocol… drones launching…'],
      storm: ['…shield field… overload… discharging to the surroundings…', 'DEFENCE PROTOCOL: ION FIELD. Move away from the station.'],
      none: ['…defence systems… not responding…', '[defence: offline] …nobody guards me any more…'],
    },
    graveyard: {
      sleepersWoke: ['Wake up, boys! The loot crawled in on its own.', 'Enough sleep – get him!', 'Thought we were just scrap? Surprise!'],
    },
    captain: {
      appear: ['We finally meet, pilot.', 'This is my turf. You should have stayed home.', 'Well, look who flew in.'],
      fled: ['I will remember this!', 'We will meet again, pilot!', 'Fall back! Next time ends differently.'],
      gloat: ['Nice piece. I will keep it.', 'Thanks for the souvenir, pilot.'],
      defeated: ['This… is not the end of the Rust…', 'I should not have underestimated you…'],
    },
    fortress: {
      alarm: ['Alarm! A strange ship in turret range!', 'The fortress reports an intruder. All ships out!'],
      reinforcements: ['Hangar open – jackals, out!', 'Reinforcements launching. Do not let him breathe!'],
    },
    distress: {
      fuel: ['Mayday, mayday. Out of fuel and drifting. Does anyone read us?', 'Miner in distress here. Empty tanks, we need fuel.'],
      repair: ['Mayday. Our hull is breached, we need iron for repairs.', 'Damaged ship here. We will not make it without repairs. Help!'],
      resolved: ['Thank you, pilot! The Guild will hear of this.', 'You saved us. We will not forget it.'],
    },
    echo: {
      heard: ['[three beats · silence · three beats]', '[…a tone under the noise… repeating…]'],
      located: ['[signal holds · source locked]', '[the beats grew louder · bearing confirmed]'],
      journal: ['[…s·m·i… …s·t·a·r·s…]', '[echo: …someone… is listening…]'],
      shard: ['[the shard answers · resonance]', '[the red core rings with the same tone]'],
      resonator: ['[the fortress core rings with the beacon tone]'],
    },
    home: {
      paintShop: [
        'The paint shop is ready, pilot. Pick a colour – the gantry will do the rest.',
        'Paint shop on line. Bring her in and choose a paint, it is on the house.',
      ],
      trophyHall: [
        'The trophy hall is open. Six pedestals waiting for whatever you bring home.',
        'Trophy hall ready. Let the clans see what happens to those who cross you.',
      ],
      module: [(m) => `${m} is finished and on line. Good work, pilot.`, (m) => `Construction done: ${m}. The station grows with you.`],
    },
  },
  instructor: {
    intro: {
      flyBuoy: [
        'Master Hale of the Guild here. The training hull is yours – undock and fly to the buoy. Let go of the throttle and the dampers brake on their own; a sideways slide dies only slowly on the cockpit thrusters, there are no side engines yet.',
        'Welcome to the training, pilot, I am Hale. First learn to fly: reach the Guild buoy. Let go of the throttle and the dampers stop you – sideways only slowly, on the weak cockpit thrusters.',
      ],
      mineIron: [
        'Now the training rock: mine 20 iron from it. Aim the laser at the glowing vein – it mines half again as fast.',
        'Iron is your first income. Get close to the rock, slow down and aim at the glowing vein – it goes fastest.',
      ],
      dockSell: [
        'Fly home and sell the iron. Come to the clamp slowly and bow first, or it will not catch you. The first sale earns you two side engines from the Guild.',
        'Home, pilot. Slow down at the clamp, turn the bow to the station and press F. The Guild gives you two side engines for the iron.',
      ],
      installSide: [
        'The side engines are in the storage. Mount them on the sides in the Shipyard, nozzle out – the dampers will stop a sideways slide with them at once, not just slowly on the thrusters.',
        'Now the Shipyard: one side engine on each flank, nozzle out. After that nothing will carry you sideways.',
      ],
      brakeBuoy: [
        'Who can stop does not crash. Fly to the second buoy and stop there below 1.5 u/s. The reward is a second reverse engine.',
        'A braking test: stop at the second buoy almost dead still. S brakes, the dampers settle the rest. The reward is a second reverse engine.',
      ],
      installReverse: [
        'Mount the second reverse engine with its nozzle to the bow. Two brake twice as hard – you stop in half the distance.',
        'In the Shipyard add the second reverse engine, nozzle forward. With two you stop in half the distance.',
      ],
      craftCargo: [
        'More cargo, fewer trips home. Make a cargo hold in Crafting and mount it – the Guild pays the materials and the fee.',
        'Craft a cargo hold and add it to the ship. The materials and the fee are on the Guild.',
      ],
      checklist: [
        'A check before the journey: refuel to full, look at the objectives and, in flight, the map. The map shows Origin, the Guild Lane and the red corner – do not fly there without a cannon.',
        'Last preparations: a full tank, the objectives and the map – the map opens only in flight. For the check the Guild also gives you the chart of the first leg of the lane.',
      ],
      finishShip: [
        'The last parts are in the storage: a reactor, a radar, a gyroscope and a second forward engine. Mount them and the ship is finished.',
        'Finish the ship: reactor, radar, gyroscope and a second forward engine. Then the Guild lets you fly alone.',
      ],
    },
    praise: [(r) => `Well done, pilot. The Guild credited you ${r}.`, (r) => `Exactly. Your reward: ${r}.`, (r) => `That is what I like to see. You get ${r}.`],
    reward: {
      credits: (c) => c,
      parts: (c, p) => `${c} and ${p} into the storage`,
      kit: (c) => `${c} and the materials for a cargo hold`,
    },
    done: [
      'The ship is finished and it is yours. The station Board offers work. Fly safe, pilot.',
      'And now you are a Guild pilot. Contracts are on the station Board. Call if you need anything.',
    ],
    nudge: {
      flyBuoy: ['The buoy is where the arrow points. W is the throttle, A and D turn.', 'Pilot, the buoy will not wait forever. Turn after the arrow and open the throttle.'],
      mineIron: ['Keep the cursor on the rock and hold the right button. The laser reaches only a little – get closer.', 'The rock is marked. Slow down by it and mine with the right button.'],
      dockSell: ['In the Overview press "Sell the whole cargo" – that is all.', 'You sell the iron in the Overview. One click and done.'],
      installSide: ['R turns the engine until its nozzle points away from the ship.', 'The highlighted cells next to the hull are the right places. Then confirm with Enter.'],
      brakeBuoy: ['At the buoy let go of the throttle and brake with S. Below 1.5 u/s I will count it.', 'No need to hurry. Slowly to the buoy, and stop.'],
      installReverse: ['Turn the engine with R so its nozzle points to the bow. Then Enter.', 'The second reverse engine waits in the storage – Shipyard, key 3.'],
      craftCargo: ['In Crafting pick the cargo hold T1 and press Craft.', 'The crafted part is in the storage – mount it in the Shipyard.'],
      checklist: ['A part of the check is still missing – look at the list in the training panel.', 'Service refuels, G opens the objectives, M the map in flight.'],
      finishShip: ['Reactor, radar, gyroscope, a forward engine – it is all in the storage.', 'The training panel shows what is still missing. Then Enter.'],
    },
    nudgeUndock: ['Undock first – the Undock button or F.', 'You will not learn this in the dock. Undock, pilot.'],
    nudgeDock: ['Dock at the station: slowly to the clamp, bow to the station, then F.', 'The parts wait in the station storage. Dock, pilot.'],
  },
  firstContact: {
    pirate: ['Look at that, a fresh Guild ship. Your training run ends here, miner.', 'A green pilot in our space? Today will be a fine catch.'],
    warnInstructor: [
      'Pilot, that is the Rust – pirates. Do not fight them with the training hull: pay the toll, or run to the station.',
      'Careful, Rust pirates! Your ship is not made to fight. Fly to the station, they will not dare there.',
    ],
    warnTraffic: [
      'Traffic control here: you have Rust pirates on your radar. If they ask for a toll, paying is cheaper than a new hull.',
      'Careful, pilot – Rust pirates. Stay close to the stations, or get ready to fight.',
    ],
    pirateRetort: ['Listen to them, pilot. The smart ones pay.', 'Run all you like. We will find you anyway.'],
    echo: ['[…noise… three beats… silence… three beats…]', '[…a tone under the noise… swells… fades…]'],
    echoReaction: [
      'Do you hear that too? That tone is not ours – no Guild beacon sends like that.',
      'Nobody has any business on that frequency. Note it down, pilot.',
    ],
    echoAgain: ['[…d·o… …y·o·u… …h·e·a·r… …u·s…?]', '[…w·h·o… …i·s… …t·h·i·s…?]'],
    ambush: ['Welcome to the dark, miner. The Guild does not send its ships out here – know why?', 'We have been waiting for someone like you. A lone ship, a full hold.'],
    ambushWarn: [
      'Careful, pilot – that is an ambush! They lie in the dark for lone ships. Fight or run, but do not stop.',
      'Contacts out of the dark, that is no accident. Pirates prey on miners here – keep your armour to them and keep moving.',
    ],
    ambushRetort: ['Let them talk. Nobody hears us out here.', 'The Guild is far away, pilot. We are right here.'],
    comet: [
      'Pilot, Institute Observatory here! You have a comet on your sensors – the first anyone has caught here in a long time.',
      'Do you hear? A comet! The Institute has waited years for this pass and you have it right under your nose.',
    ],
    cometReaction: [
      'A comet? It flies faster than it looks. If you want to mine it, match its speed first.',
      'Comets pass through here only once in a while. Just do not ram the core, pilot.',
    ],
    cometAgain: ['The tail is all ice, the core ice and titanium. Mine on the move before it is gone.', 'Match speed with the core and mine while it passes. The next pass is a long way off.'],
    derelict: ['…voltage… after so long… Who is there? Identify yourself, ship.', '…waking… relay 1… The Guild? Is it the Guild?'],
    derelictReaction: [
      'A derelict station answering? The Guild has listed it as dead for years. Be careful, pilot.',
      'That is an old Guild automaton. Those stations closed long before your time – and some still defend themselves.',
    ],
    derelictAgain: ['…the other relays… then I open the clamp… waiting…', '…power the relays… the station remembers… waits…'],
    watch: ['Guild Watch here – pirates near you, engaging. Stay close to us, pilot.', 'Guild patrol sees the pirates. We are going in – you keep to the side.'],
    watchReaction: [
      'That is the Guild Watch. Where they patrol, pirates do not last long.',
      'Guild patrols fly the lanes and the Guarded sectors. When things go bad, fly to them.',
    ],
    watchAgain: ['Copy. Back on patrol after the fight.', 'If you get in trouble, you know where to find us.'],
    convoy: [
      'Free Traders here! We fly the Guild Lane past you – rare parts on board, and we buy your cargo too.',
      'Free Traders convoy calling the Guild ship. We are passing by, trade is open.',
    ],
    convoyReaction: [
      'A traders convoy? Approach its port on the port side slowly, at its speed, and press F.',
      'Convoys fly the Guild Lanes on a published schedule – you will find them on the map. Link at the port, F.',
    ],
    convoyAgain: ['No sudden moves, pilot. Match us and we trade on the move.', 'We are waiting for you. The port light is on, port side.'],
  },
  panel: {
    radio: 'Radio',
    queued: (n) => `+${n}`,
    journal: 'Journal entry',
    skip: 'Click – finish reading / close the message',
  },
  log: {
    title: 'Radio',
    subtitle: 'Message log',
    empty: 'The radio has been silent so far.',
    close: 'L – close',
  },
  settings: {
    label: 'Radio',
    options: { all: 'All', important: 'Important', off: 'Off' },
    hint: 'Who talks to you: station traffic, pirates, captains, signals. Off = short notices as before.',
  },
  help: 'L – radio: message log',
};
