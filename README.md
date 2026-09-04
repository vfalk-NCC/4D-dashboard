# 4D-dashboard – insticksprogram för Trimble Connect

Ett fristående insticksprogram (Extension) som visar en översikt och
nyckeltal för produktionsplaneringen. Läser samma Supabase-databas
(tabellen `plan_items`) som **4D-planering** skriver till, men skriver
aldrig något själv – rent läsläge. Bygger på **Trimble Connect Workspace
API** (https://developer.trimble.com/docs/connect/workspace-api/).

## Vad det gör (första versionen)

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
- **Uppdatera-knapp** (↻) i headern hämtar senaste data på begäran; sidan
  visar även när den senast uppdaterades.

Fler delar är tänkta att byggas på ovanpå detta: ett samlat
kommentars-/avvikelseflöde över alla objekt, och en
"planerat vs. utfall"-kurva för framdrift över tid. Se avsnittet
"Vidareutveckling" nedan.

## Arkitektur

```
docs/     -> Frontend som körs inuti Trimble Connect (sidopanel)
             index.html + app.js + style.css + manifest.json
             Hostas gratis via GitHub Pages direkt från repot.
```

```
Trimble Connect (3D-visare)
   -> docs/ (statiska filer på GitHub Pages, gratis, direkt från repot)
        -> REST-anrop (läsning) mot https://<samma-projekt-som-4D-planering>.supabase.co
```

Ingen egen databas eller schema behövs – dashboarden pratar mot exakt
samma Supabase-projekt och tabell (`plan_items`) som 4D-planering redan
har satt upp. Se **4D-planering**s README för hela databas-guiden om den
inte redan finns.

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
   4D-planering.
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

Två delar diskuterade men inte byggda än:

- **Kommentarer/avvikelser-flöde**: en samlad lista över de senaste
  kommentarerna från `plan_item_comments` över alla objekt, med möjlighet
  att klicka en kommentar för att hoppa till och markera objektet i
  3D-vyn.
- **Framdrift över tid**: en "planerat vs. utfall"-kurva. Kräver ett
  beslut: antingen (a) bara rita en planerad kurva utifrån start-/
  slutdatum och lägga dagens faktiska snitt som en punkt ovanpå, eller
  (b) börja logga framdriftshistorik i en ny tabell (progress +
  tidsstämpel vid varje ändring) för att kunna rita en riktig
  utfallskurva över tid.

## Snabbreferens: navigering i Trimble Connect (för framtida uppdateringar)

- **Program och funktioner** (lägga till/hantera extensions): öppna ett
  projekt → kugghjulet (⚙) längst ned i vänstermenyn → "Program och
  funktioner" → "Lägg till anpassad" → klistra in manifest-URL:en.
- **GitHub Pages**: repots **Settings → Pages** → "Deploy from a branch"
  → branch `main`, mapp `/docs` → Save. Vid en helt tom repo måste första
  filen laddas upp via `.../upload` (utan branch) innan `main` finns –
  därefter fungerar `.../upload/main/docs` för nya filer i `docs/`-mappen.
