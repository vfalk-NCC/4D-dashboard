# 4D-dashboard – insticksprogram för Trimble Connect

Ett fristående insticksprogram (Extension) som visar en översikt och
nyckeltal för produktionsplaneringen. Läser samma datalager (filerna
`plan_items.json` och `plan_item_comments.json` i det privata repot
`vfalk-NCC/4D-data`) som **4D-planering** skriver till – och skriver
aldrig något till dem själv. Dashboarden skriver däremot till egna,
separata filer (milstolpar, bemanning, leveransplan, säkerhet,
besiktningar, hinder) via små formulär i respektive panel – se "Vad det
gör" nedan för detaljer. Bygger på **Trimble Connect Workspace API**
(https://developer.trimble.com/docs/connect/workspace-api/).

## Vad det gör

- **Översikt**: en KPI-rad högst upp – totalt antal objekt, andel klara,
  andel försenade, genomsnittlig framdrift och antal ej planerade objekt.
- **Statusfördelning**: ett stapeldiagram med antal (och andel) objekt per
  status – samma statusar och färger som i 4D-planering, så de två
  apparna känns igen som en helhet.
- **Filtrering**: tre filter (område, aktivitet, entreprenör) längst upp
  som styr hela sidan – KPI:er, statusfördelning och framdriftspanelerna
  räknas om direkt i webbläsaren, utan ny hämtning från databasen.
- **Framdrift per område** och **Framdrift per entreprenör**: två paneler
  med horisontella staplar som visar genomsnittlig framdrift (%), antal
  objekt och antal försenade per grupp.
- **Kommande veckor**: en lookahead-tabell (denna vecka + två veckor
  framåt) som visar hur många objekt som ska starta respektive vara
  klara varje vecka, samt hur många av de sistnämnda som redan ligger
  som försenade. Bygger på `start_date`/`end_date` i `plan_items`.
- **Försenade objekt**: en lista sorterad på flest dagar över planerat
  slutdatum längst upp. Baseras på `end_date` jämfört med dagens datum
  (inte bara statusfältet), så listan fångar även objekt vars status
  inte hunnit uppdateras manuellt.
- **Framdrift över tid (S-kurva)**: en kurva med två linjer – "Planerat"
  (andel objekt vars slutdatum har passerat, vecka för vecka) och
  "Utfall" (genomsnittlig verklig framdrift, hämtad ur den nya tabellen
  `plan_item_progress_history`). Historiken fylls på helt automatiskt av
  en databastrigger i 4D-planering, så dashboarden bara läser den.
- **Milstolpar**: en lista (t.ex. "Stomresning klar", "Tätt hus") med
  måldatum, en kryssruta för att markera klar och ett litet formulär för
  att lägga till nya. Förfallna, ej klara milstolpar flaggas rött.
  Skriver till `plan_milestones`.
- **Bemanning**: ett rutnät med antal personer per entreprenör för denna
  vecka och de två kommande, med ett litet formulär för att
  registrera/uppdatera bemanningen per vecka. Skriver till
  `plan_staffing`.
- **Leveransplan**: en lista över planerade leveranser (beskrivning,
  leverantör, entreprenör, område, datum, status) med ett formulär för
  att lägga till nya. Skriver till `plan_deliveries`.
- **Säkerhet**: en logg över tillbud, olyckor, skyddsronder,
  riskobservationer eller valfri egen kategori (typen är fritext med
  förslag, inte en låst lista), med allvarlighetsgrad, ett valfritt
  bifogat PDF/bild och ett formulär för att registrera nya händelser.
  Skriver till `plan_safety_events`.
- **Kvalitet & besiktningar**: en logg över besiktningar (egenkontroll,
  besiktning, slutbesiktning, myndighetsbesiktning eller valfri egen
  kategori) med resultat (godkänd/anmärkning/underkänd), valfritt
  bifogat PDF/bild och valfritt kopplad till ett specifikt objekt.
  Skriver till `plan_inspections`.
- **Väder**: aktuellt väder och en 4-dagarsprognos från
  [Open-Meteo](https://open-meteo.com/) (gratis, ingen API-nyckel),
  baserat på koordinater som anges i inställningarna. Ingen egen fil –
  koordinaterna sparas lokalt i webbläsaren, precis som GitHub-token:en.
- **Lösenordsgrind**: extensionen visar "Du har ej åtkomst" tills rätt
  lösenord anges (se avsnittet i 4D-planerings README). Enbart en enkel
  klientsidesspärr, inte riktig säkerhet.
- **Senaste kommentarer**: ett flöde med de senaste kommentarerna från
  `plan_item_comments` (samma tabell som kommentarerna i 4D-planering),
  för objekt som matchar den aktuella filtreringen.
- **Uppdatera-knapp** (↻) i headern hämtar senaste data på begäran; sidan
  visar även när den senast uppdaterades.
- **Kalenderexport (.ics)**: knappen "Kalender ⤓" i headern laddar ner
  milstolpar och leveransplan som en `.ics`-fil (heldagshändelser), redo
  att importera i Outlook eller Google Kalender. Ren nedladdning – ingen
  delningslänk eller levande koppling, samma GitHub-token som resten av
  appen behövs inte av mottagaren.
- **Cykeltidsanalys**: en panel som jämför planerad varaktighet (start-
  till slutdatum) mot verklig varaktighet per aktivitet, för klarmarkerade
  objekt med start-, slut- och verkligt avslutsdatum ifyllda. Visar
  snittavvikelsen i dagar och antal objekt per aktivitet, störst avvikelse
  överst – en indikation på vilka aktiviteter som systematiskt tar längre
  (eller kortare) tid än planerat. Verklig varaktighet räknas från
  **Verklig start** (fylls i valfritt i 4D-planering, se dess README) när
  den finns – annars faller den tillbaka på planerat startdatum som en
  ungefärlig proxy. Metaraden för varje aktivitet visar hur många av
  objekten som räknats med en riktig verklig start (t.ex. "3 av 5 med
  verklig start"), så du ser direkt hur tillförlitlig siffran är och kan
  avgöra om det är värt att börja fylla i Verklig start mer konsekvent.
- **Gantt-schema**: en rad per objekt (planerat start- till slutdatum),
  läsbarhetsuppdaterat 2026-09-17 (och en gång till samma dag efter
  feedback om att det fortfarande var svårläst). Tidsaxeln visar månads-
  och veckogridlinjer, veckonummer, helgskuggning (lör-sön) och en tydlig
  "Idag"-linje – alla tre hålls medvetet dämpade/bakgrundstysta så de inte
  konkurrerar med staplarna om uppmärksamheten. Varje stapel har en fast,
  alltid synlig bottenfärg, en heldragen kant i statusfärgen (bär
  identiteten, syns även för ljusa statusfärger) och en solid fyllning som
  motsvarar objektets framdrift i procent, samt en tunn ring i panelens
  egen bakgrundsfärg som lyfter den från rutnätet bakom. Staplar har en
  minsta synlig bredd så att även korta delaktiviteter (någon enstaka dag)
  inte försvinner helt vid utzoomning. En hover-/tabb-tooltip visar status,
  datum, framdrift och entreprenör (ersätter webbläsarens inbyggda
  title-rutor), och en färgförklaring ovanför visar statusarna samt vad
  verkligt/helg/idag betyder. Objekt med sparade delaktiviteter (från
  4D-planerings "Koppla markering") har en utfällbar pil som visar
  delaktiviteterna som egna, mindre staplar under objektet; klick på ett
  objektnamn markerar det i 3D-modellen (där koppling finns). Kryssrutan
  "Visa verkligt" lägger till en extra, randig stapel med verklig
  start/avslut bredvid den planerade – bara för objekt som har **båda**
  fälten ifyllda i 4D-planering (av som standard). Toolbaren låter dig
  gruppera raderna (Område/Entreprenör/Aktivitet, med hopfällbara
  grupphuvuden), sortera (Startdatum/Entreprenör/Status/Namn), växla
  radtäthet (Kompakt/Bekväm) och zooma in/ut (med horisontell scroll vid
  inzoomning) – och "Visa från/till" låter dig begränsa vilket
  datumintervall som visas (objekt helt utanför intervallet döljs, med en
  hint om hur många). Objekt-, delaktivitets- och gruppnamnen är
  fastklistrade i vänsterkanten och förblir alltid synliga även när man
  skrollar i sidled i inzoomat läge. Alla dessa inställningar (utom "Visa
  verkligt", som medvetet alltid är av vid sidladdning) sparas i
  webbläsaren och gäller vid nästa besök. Delaktiviteter har ännu inga egna
  verkliga datum, så de
  visas alltid bara med sin planerade stapel.
- **Statusfärger** (i inställningarna, kugghjulet): de sex statusfärgerna
  (Ej planerad/Planerad/Pågående/Försenad/Klar/Pausad) går att byta ut mot
  egna via en färgruta per status – ändringen syns direkt i Gantt-schemat,
  cirkeldiagrammet och statusfördelningen, utan att behöva klicka Spara.
  Sparas i webbläsaren och gäller vid nästa besök. "Återställ
  standardfärger" nollställer alla sex till de ursprungliga.
- **Resurstimmar (planerat)**: ett enkelt planeringsunderlag som fördelar
  varje objekts – eller, om objektet har delaktiviteter, varje
  delaktivitets – "Uppskattade timmar" (fylls i i 4D-planering) jämnt
  över dess datumintervall och summerar timmarna per vecka och
  entreprenör, ungefär som ett bemanningsschema. Objekt utan ifyllda
  timmar och/eller datum räknas inte med (en hint visar hur många). Visar
  bara planerad tidsåtgång i denna omgång, ingen jämförelse mot verkligt
  nedlagd tid ännu.
- **Synliga block**: i inställningarna (kugghjulet) kan du bocka ur vilka
  block som ska visas i dashboarden. Ett urbockat block försvinner direkt
  och tas heller inte med i PDF-exporten (utskriften) – och för de block
  som har en egen Excel-fil (Cykeltidsanalys, Milstolpar, Bemanning,
  Leveransplan, Leveransplan handlingar, Hinder, Säkerhet, Besiktningar,
  Väder) utesluts den filen ur Excel-exporten också. Den grundläggande
  objektlistan (planeringsobjekt) hör inte till något enskilt block och
  tas alltid med. Valet sparas lokalt i webbläsaren.

Alla filer som paneler ovan använder (`plan_item_progress_history.json`,
`plan_milestones.json`, `plan_staffing.json`, `plan_deliveries.json`,
`plan_document_deliveries.json`, `plan_safety_events.json`,
`plan_inspections.json`, `plan_blockers.json`,
`plan_blocker_comments.json`) skapas automatiskt av `github-storage.js`
första gången något skrivs dit för ett projekt – inget separat
migreringssteg krävs. Fram tills dess visar panelerna bara sina tomma
lägen (dashboarden hanterar det utan att krascha).

Bilagorna (PDF/bild) på Säkerhet och Kvalitet & besiktningar lagras som
binärfiler i samma privata repo, under
`projects/<projekt-id>/attachments/<safety|inspections>/` – ingen
separat uppsättning krävs, det fungerar med samma GitHub-token som
resten av datan.

## Arkitektur

```
docs/     -> Frontend som körs inuti Trimble Connect (sidopanel)
             index.html + app.js + github-storage.js + style.css + manifest.json
             Hostas gratis via GitHub Pages direkt från DETTA (publika) repot.
```

```
Trimble Connect (3D-visare)
   -> docs/ (statiska filer på GitHub Pages, gratis, direkt från repot)
        -> GitHub Contents API (läsning + skrivning) mot det PRIVATA
           repot vfalk-NCC/4D-data
```

Ingen egen databas krävs – dashboarden pratar mot exakt samma privata
`4D-data`-repo som 4D-planering redan har satt upp, med egna JSON-filer
per projekt (se "Vad det gör" ovan). Se **4D-planering**s README för
hela bakgrunden till den här arkitekturen (varför två repon, hur
GitHub-token:en fungerar) om den inte redan är bekant.

## Kom igång

### 1. Skapa ett nytt GitHub-repo

1. Skapa ett nytt, tomt repo på GitHub, t.ex. `4D-dashboard`.
2. Pusha upp den här mappens innehåll till `main`-branchen.

### 2. Publicera frontend (GitHub Pages)

Precis som 4D-planering är det här en helt statisk webbsida, så den
hostas gratis direkt från repot:

1. Gå till repots **Settings → Pages**.
2. Under **Build and deployment**, välj **Deploy from a branch**.
3. Välj branch `main` och mapp `/docs`, spara.
4. Efter någon minut är sidan live på
   `https://<ditt-github-användarnamn>.github.io/4D-dashboard/`.
5. Uppdatera `url` i `docs/manifest.json` om adressen skiljer sig från
   den som redan står där.

### 3. Koppla dashboarden till datalagret

1. Öppna projektet i Trimble Connect for Browser och aktivera
   extensionen (se steg 4 om den inte redan är tillagd).
2. Om lösenordsgrinden visas ("Du har ej åtkomst"): ange lösenordet.
3. Klicka på kugghjulet (⚙) uppe till höger i panelen.
4. Klistra in **samma** GitHub-token som du använder i 4D-planering (se
   `GITHUB_TOKEN_SETUP.md`). Vill du även visa väder, ange projektets
   latitud/longitud i samma dialog (valfritt, används bara av
   väderpanelen).
5. Klicka **Spara**. Varningen om saknad token ska försvinna och
   KPI:erna fyllas i.

### 4. Registrera extensionen i Trimble Connect

1. Öppna projektet i Trimble Connect for Browser.
2. Inställningar → Extensions.
3. Ange manifest-URL:en, t.ex.
   `https://<ditt-github-användarnamn>.github.io/4D-dashboard/manifest.json`,
   och lägg till.
4. Aktivera extensionen under "Custom Extensions".

## Vidareutveckling

De sju funktionerna ovan (S-kurva, milstolpar, bemanning, leveransplan,
säkerhet, kvalitet/besiktningar, väder) är byggda. Kvarstående, öppna
uppslag:

- **"Planerat"-formeln i S-kurvan** är en enkel första version (andel
  objekt vars slutdatum har passerat). Går att förfina senare, t.ex.
  genom att vikta objekt olika efter storlek/omfattning istället för att
  räkna dem lika.
- **Milstolpar i "Kommande veckor"**: milstolpar visas idag i en egen
  panel, inte som markörer i lookahead-tabellen – kan slås ihop senare
  om det efterfrågas.
- **plan_item_progress_history.json växer kontinuerligt** (en rad per
  ändring av progress/status). Inga problem i nuvarande skala, men en
  enkel städrutin (t.ex. behåll bara en rad per objekt och dag) kan
  behövas längre fram om filen blir väldigt stor.

## Snabbreferens: navigering i Trimble Connect (för framtida uppdateringar)

- **Program och funktioner** (lägga till/hantera extensions): öppna ett
  projekt → kugghjulet (⚙) längst ned i vänstermenyn → "Program och
  funktioner" → "Lägg till anpassad" → klistra in manifest-URL:en.
- **GitHub Pages**: repots **Settings → Pages** → "Deploy from a branch"
  → branch `main`, mapp `/docs` → Save. Vid en helt tom repo måste första
  filen laddas upp via `.../upload` (utan branch) innan `main` finns –
  därefter fungerar `.../upload/main/docs` för nya filer i `docs/`-mappen.
