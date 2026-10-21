/* Mallar för montageordning i Sovringsverket (Victor 2026-10-21). Varje mall är ett utkast med vanliga steg, längd i dagar och
   vad som väntar på vad ([index i listan]) – ändra, ta bort och lägg till steg efter behov. Längderna är grova riktvärden. */
const MS_TEMPLATES = [
  { g: "Betong och grund", n: "Fundament (platsgjutet)", a: "Fundament", d: "Fundament för stålpelare, maskiner eller väggar.", s: [
    ["Utsättning och inmätning", 1, [], ""], ["Schakt / bergrensning", 3, [0], "Kontrollera bergyta och nivåer."], ["Bärlager, packning och dränering", 2, [1], ""], ["Form", 3, [2], ""], ["Armering", 4, [3], "Armeringskontroll före gjutning."],
    ["Ingjutningsgods och bultgrupper", 2, [4], "Bultgrupper inmätta före gjutning."], ["Kontroll före gjutning", 1, [5], "Egenkontroll och besiktning."], ["Gjutning", 1, [6], ""], ["Härdning och skydd", 5, [7], "Vintertid: värme och täckning."], ["Rivning av form och efterkontroll", 2, [8], ""], ["Återfyllnad", 2, [9], ""]] },
  { g: "Betong och grund", n: "Kontrafor", a: "Kontrafor", d: "Betongkontrafor (stödvägg) mot berg eller mark.", s: [
    ["Utsättning och inmätning", 1, [], ""], ["Schakt / bergrensning", 3, [0], ""], ["Bärlager och dränering", 2, [1], ""], ["Form sida 1", 3, [2], ""], ["Armering", 4, [3], ""], ["Form sida 2 och ingjutningsgods", 3, [4], ""],
    ["Kontroll före gjutning", 1, [5], ""], ["Gjutning", 2, [6], "Gjut i etapper vid behov."], ["Härdning", 5, [7], ""], ["Rivning av form", 2, [8], ""], ["Återfyllnad och dränering", 3, [9], ""]] },
  { g: "Betong och grund", n: "Platta på mark", a: "Platta på mark", d: "Platsgjuten golvplatta.", s: [
    ["Planering och packning av underlag", 2, [], ""], ["Kapillärbrytande lager och isolering", 2, [0], ""], ["Utsättning, kantform och genomföringar", 2, [1], ""], ["Armering", 3, [2], ""], ["Kontroll före gjutning", 1, [3], ""],
    ["Gjutning och ytavjämning", 1, [4], ""], ["Slipning / ytbehandling", 2, [5], ""], ["Härdning", 5, [5], ""], ["Fogskärning", 1, [7], ""]] },
  { g: "Betong och grund", n: "Platsgjuten vägg", a: "Vägg", d: "Platsgjuten betongvägg i etapper (lyft).", s: [
    ["Utsättning och bygel / startarmering", 1, [], ""], ["Form sida 1", 2, [0], ""], ["Armering", 3, [1], ""], ["Form sida 2 och mellanlägg", 2, [2], ""], ["Kontroll före gjutning", 1, [3], ""], ["Gjutning", 1, [4], ""], ["Härdning", 3, [5], ""], ["Rivning av form", 1, [6], ""]] },
  { g: "Betong och grund", n: "Maskinfundament", a: "Maskinfundament", d: "Fundament för krossar, siktar eller annan tung maskin.", s: [
    ["Utsättning och inmätning", 1, [], ""], ["Schakt och bärlager", 3, [0], ""], ["Form", 4, [1], ""], ["Armering och ingjutningsgods", 6, [2], "Ankarbultar noggrant inmätta."], ["Kontroll före gjutning", 1, [3], ""],
    ["Gjutning", 2, [4], "Stora volymer – planera pumpar och leveranser."], ["Härdning", 7, [5], ""], ["Justering och underfyllning (injektering)", 2, [6], ""], ["Maskinmontage", 5, [7], ""]] },
  { g: "Stål", n: "Stålpelare", a: "Stålpelare", d: "Montage av enskild stålpelare på bultgrupp.", s: [
    ["Inmätning av bultgrupp", 1, [], ""], ["Justermuttrar och höjdinställning", 1, [0], ""], ["Montage av pelare", 1, [1], "Kran bokad och lyftplan klar."], ["Plumpning och åtdragning", 1, [2], ""], ["Underfyllning (injekteringsbruk)", 1, [3], ""], ["Rostskydd och målning", 2, [4], ""], ["Kontroll och dokumentation", 1, [5], ""]] },
  { g: "Stål", n: "Stålstomme (hall)", a: "Stålstomme", d: "Invändig eller bärande stålstomme i flera nivåer.", s: [
    ["Pelare nivå 1", 4, [], ""], ["Balkar nivå 1", 4, [0], ""], ["Förband och åtdragning nivå 1", 3, [1], ""], ["Pelare nivå 2", 4, [2], ""], ["Balkar nivå 2", 4, [3], ""], ["Förband och åtdragning nivå 2", 3, [4], ""],
    ["Vindförband och stabilisering", 3, [5], ""], ["Plåtbjälklag / galler", 4, [6], ""], ["Rostskydd och slutkontroll", 3, [7], ""]] },
  { g: "Stål", n: "Bandgång (gångbro längs transportband)", a: "Bandgång", d: "Gångbro eller gångbana längs transportband, med stöd, golv, räcken och eventuellt väderskydd. Utkast – anpassa efter ritning.", s: [
    ["Inmätning av stöd och konsoler", 2, [], ""], ["Montage av stöd / ramar", 4, [0], ""], ["Montage av bärande balkar", 4, [1], ""], ["Golv: gallerdurk eller plåt", 3, [2], ""], ["Räcken och sparkplåt", 3, [3], ""], ["Trappor, stegar och plattformar", 3, [3], ""],
    ["Väder- och bullerskydd (väggar / tak)", 5, [4], "Sandwichelement eller plåt – beroende på utförande."], ["El, belysning och nödbelysning", 3, [4], ""], ["Brand- och nödutrymning, skyltning", 2, [6, 7], ""], ["Slutbesiktning", 1, [8], ""]] },
  { g: "Stål", n: "Transportband", a: "Transportband", d: "Montage av ett transportband från fundament till provkörning.", s: [
    ["Gjutning av fundament och bultgrupper", 5, [], "Bultgrupperna ska vara inmätta före gjutning."], ["Uppmätning och justering av fundament", 2, [0], ""], ["Bärande stålstomme, första sektion", 3, [1], ""], ["Bärande stålstomme, resterande sektioner", 6, [2], ""],
    ["Stödrullar och returrullar", 3, [3], ""], ["Drivstation: drivtrumma, motor och växel", 4, [3], ""], ["Svansstation och sträckverk", 3, [3], ""], ["Band, skarvning och spänning", 3, [4, 5, 6], ""],
    ["Skydd, kåpor och gångbryggor", 3, [7], ""], ["El, kabelrännor och givare", 4, [7], ""], ["Provkörning och injustering", 2, [8, 9], ""]] },
  { g: "Stål", n: "Silo / bunker / tratt", a: "Silo", d: "Stålsilo, bunker eller tratt med bärande ram.", s: [
    ["Fundament och ankarbultar", 5, [], ""], ["Bärande ram / stödkonstruktion", 5, [0], ""], ["Montage av skal i sektioner", 7, [1], ""], ["Svetsning och kontroll", 5, [2], ""], ["Slitplåt / Hardox-montage", 4, [3], ""], ["Utloppsdon och matare", 3, [4], ""], ["Plattformar, stegar och räcken", 3, [3], ""], ["Täthetsprov och besiktning", 2, [5, 6], ""]] },
  { g: "Fasad och klimatskal", n: "Sandwichelement (vägg)", a: "Fasad", d: "Montage av ytterväggar i sandwichelement.", s: [
    ["Utsättning och nivåkontroll", 1, [], ""], ["Montage nivå 1", 4, [0], ""], ["Infästning och justering nivå 1", 2, [1], ""], ["Montage nivå 2", 4, [2], ""], ["Infästning och justering nivå 2", 2, [3], ""], ["Fogning och tätning", 4, [4], ""], ["Genomföringar, portar och dörrar", 3, [5], ""], ["Slutkontroll", 1, [6], ""]] },
  { g: "Fasad och klimatskal", n: "Tak (plåt / takelement)", a: "Tak", d: "Takmontage inklusive tätskikt och avvattning.", s: [
    ["Stomkomplettering och underlag", 3, [], ""], ["Montage av takelement / bärande plåt", 5, [0], ""], ["Isolering", 3, [1], ""], ["Tätskikt / ytplåt", 4, [2], ""], ["Avvattning och stuprör", 2, [3], ""], ["Takluckor, ljusinsläpp och genomföringar", 3, [3], ""], ["Taksäkerhet", 1, [4, 5], ""], ["Slutbesiktning", 1, [6], ""]] },
  { g: "Berg och mark", n: "Bergförstärkning", a: "Bergförstärkning", d: "Skrotning, bultning och sprutbetong. Observera risk för ras vid skivat berg – avvakta besked innan arbete startar (HOLD).", s: [
    ["Inmätning och bergbesiktning", 1, [], "Kontrollera bergets skick och riskområden."], ["Skrotning", 2, [0], ""], ["Bultning", 4, [1], ""], ["Nät", 2, [2], ""], ["Sprutbetong", 3, [3], ""], ["Kontroll och dokumentation", 1, [4], ""]] },
  { g: "Installationer", n: "El och kabelstegar", a: "El", d: "Stomnät för el: kabelstegar, kabeldragning och anslutning.", s: [
    ["Kabelstegar och rännor", 4, [], ""], ["Kabeldragning huvudkablar", 4, [0], ""], ["Skåp och fördelningar", 3, [0], ""], ["Anslutning och märkning", 3, [1, 2], ""], ["Mätning och funktionsprov", 2, [3], ""]] },
  { g: "Installationer", n: "Rör och processledningar", a: "Rör", d: "Rörstöd, rörledningar och provning.", s: [
    ["Utsättning och rörstöd", 3, [], ""], ["Montage av rör", 5, [0], ""], ["Svets och flänsförband", 4, [1], ""], ["Tryckprovning", 2, [2], ""], ["Isolering och märkning", 3, [3], ""], ["Slutkontroll", 1, [4], ""]] },
  { g: "Sektionsfickor", n: "Sektionsficka (SF)", a: "SF", d: "Montage av en sektionsficka enligt PP-tidplanens sekvens: L-stöd, sandwichelement, Hardox och spännarmering.", s: [
    ["L-stöd", 3, [], ""], ["Sandwichelement", 4, [0], ""], ["Hardox-montage", 3, [1], ""], ["Spännarmering", 3, [2], ""], ["Injektering och efterarbeten", 2, [3], ""], ["Kontroll", 1, [4], ""]] },
];
function msTemplateSteps(t) { const out = []; t.s.forEach(([n, d, dp, note]) => out.push({ id: msId(), kind: "free", name: n, note: note || "", start: "", dur: d, deps: dp.map(i => out[i].id), objs: [], cam: null, pS: "", pE: "" })); return out; }
