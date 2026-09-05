# 4D-dashboard – insticksprogram för Trimble Connect

Ett fristående insticksprogram (Extension) som visar en översikt och
nyckeltal för produktionsplaneringen. Läser samma Supabase-databas
(tabellerna `plan_items` och `plan_item_comments`) som **4D-planering**
skriver till – och skriver aldrig något till dem själv. Dashboarden
skriver däremot till fem egna, separata tabeller (milstolpar, bemanning,
leveransplan, säkerhet, besiktningar) via små formulär i respektive
panel – se "Vad det gör" nedan för detaljer. Bygger på **Trimble Connect
Workspace API** (https://developer.trimble.com/docs/connect/workspace-api/).

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
  baserat på koordinater som anges i inställningarna. Ingen ny tabell –
  koordinaterna sparas lokalt i webbläsaren, precis som Supabase-URL/
  nyckel.
- **Senaste kommentarer**: ett flöde med de senaste kommentarerna från
  `plan_item_comments` (samma tabell som kommentarerna i 4D-planering),
  för objekt som matchar den aktuella filtreringen.
- **Uppdatera-knapp** (↻) i headern hämtar senaste data på begäran; sidan
  visar även när den senast uppdaterades.

De sex nya tabellerna (`plan_item_progress_history`, `plan_milestones`,
`plan_staffing`, `plan_deliveries`, `plan_safety_events`,
`plan_inspections`) skapas av `supabase/migration_3_dashboard_features.sql`
i **4D-planering**-repot. Den måste köras en gång i Supabase (Dashboard
→ SQL Editor → klistra in → Run) innan panelerna ovan visar riktig data –
går att köra flera gånger utan att krascha. Fram tills dess visar
panelerna bara sina tomma lägen (dashboarden hanterar det utan att
krascha).

Bilagorna (PDF/bild) på Säkerhet och Kvalitet & besiktningar kräver
dessutom `supabase/migration_4_attachments.sql` (samma repo, samma
sätt att köra den) – den lägger till `attachment_url`/`attachment_name`
på de två tabellerna och skapar en publik Storage-bucket
(`dashboard-attachments`) för själva filerna. Utan den migreringen
fungerar allt annat som vanligt, filuppladdningsfälten visar bara ett
felmeddelande om man försöker bifoga något.

## Arkitektur

```
docs/     -> Frontend som körs inuti Trimble Connect (sidopanel)
             index.html + app.js + style.css + manifest.json
             Hostas gratis via GitHub Pages direkt från repot.
```

```
Trimble Connect (3D-visare)
   -> docs/ (statiska filer på GitHub Pages, gratis, direkt från repot)
        -> REST-anrop (läsning + skrivning till de nya tabellerna) mot
           https://<samma-projekt-som-4D-planering>.supabase.co
```

Ingen egen databas krävs – dashboarden pratar mot exakt samma
Supabase-projekt som 4D-planering redan har satt upp, plus sex nya
tabeller (se "Vad det gör" ovan) som skapas av
`migration_3_dashboard_features.sql`. Se **4D-planering**s README för
hela databas-guiden om den inte redan finns.

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

### 3. Koppla dashboarden till databasen

1. Öppna projektet i Trimble Connect for Browser och aktivera
   extensionen (se steg 4 om den inte redan är tillagd).
2. Klicka på kugghjulet (⚙) uppe till höger i panelen.
3. Klistra in **samma** Supabase-URL och anon key som du använder i
   4D-planering. Vill du även visa väder, ange projektets latitud/
   longitud i samma dialog (valfritt, används bara av väderpanelen).
4. Klicka **Spara**. Varningen "Ingen databas ansluten" ska försvinna och
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
- **plan_item_progress_history växer kontinuerligt** (en rad per
  ändring av progress/status). Inga problem för Postgres i nuvarande
  skala, men en enkel städrutin (t.ex. behåll bara en rad per objekt och
  dag) kan behövas längre fram.

## Snabbreferens: navigering i Trimble Connect (för framtida uppdateringar)

- **Program och funktioner** (lägga till/hantera extensions): öppna ett
  projekt → kugghjulet (⚙) längst ned i vänstermenyn → "Program och
  funktioner" → "Lägg till anpassad" → klistra in manifest-URL:en.
- **GitHub Pages**: repots **Settings → Pages** → "Deploy from a branch"
  → branch `main`, mapp `/docs` → Save. Vid en helt tom repo måste första
  filen laddas upp via `.../upload` (utan branch) innan `main` finns –
  därefter fungerar `.../upload/main/docs` för nya filer i `docs/`-mappen.
