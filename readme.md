# Getting Started

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## Next Steps

- Open a new terminal and run `npm run watch` (uses the project-local `npx cds watch`)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.


---

## LangGraph flow (`ask`)

Przeplyw w Node.js oparty o `@langchain/langgraph` + OpenAI. Kod: srv/lib/graph.js, srv/lib/bpClient.js.

Wezly:
1. extractPartner - LLM wyciaga numer business partnera z zapytania.
2. fetch - wywoluje przetestowany backend (ZMTO_AI_BP_SRV .../Identifications) dla tego numeru.
3. decide - LLM ocenia, czy personal id jest aktualny na dzis (current / outdated / unknown).
4. rozgalezienie:
   - ok    - komunikat: "Partner ... ma aktualny personal id".
   - draft - LLM przygotowuje propozycje e-maila do partnera; requiresConfirmation: true.
   - fail  - komunikat bledu.

Czlowiek zatwierdza wysylke - dopiero wtedy UI wola akcje sendPartnerEmail.

### Uruchomienie

    npm install
    cp .env.example .env    # uzupelnij OPENAI_API_KEY
    npm run watch           # albo: npx cds watch

WAZNE: uruchamiaj `npx cds watch` / `npm run watch`, a nie globalne `cds watch`.
Globalny `@sap/cds` + lokalny w projekcie = blad "loaded from different locations".
Toolchain jest w devDependencies (`@sap/cds-dk`), wiec `npx` bierze wersje z projektu.

W trybie dev CAP odpala pusta baze SQLite in-memory (aplikacja nie ma encji, wiec
jest ona nieuzywana). W profilu `production` bazy nie ma w ogole (`cds.requires.db: false`).

Test HTTP:

    curl -s http://localhost:4004/odata/v4/business-partner-a-i/ask \
      -H 'Content-Type: application/json' \
      -d '{"query":"czy partner 5 ma wazny personal id?"}'

Test samego grafu (dane z mocka):

    BP_MOCK=true OPENAI_API_KEY=sk-... node scripts/test-graph.js "czy partner 5 ma wazny personal id?"


## UI

`app/chat/` -> http://localhost:4004/chat/ . Opis w sekcji **Frontend (SAPUI5 / Fiori)** nizej.
Postep na zywo leci przez SSE: `GET /ai/ask-stream?query=...` ([srv/server.js](srv/server.js)),
`streamMode "updates"` z LangGraph.


## Deploy na SAP BTP (Cloud Foundry)

Aplikacja jest bezstanowa - NIE ma bazy danych (ani HANA, ani zadnej innej).

Wymagane raz:
- uprawnienia do uslug `xsuaa`, `destination`, `connectivity` w subaccount
- destinacja `SA1_300` skonfigurowana w subaccount (ta sama, ktorej uzywa `getPartner`)
- CLI: `cf`, plugin `multiapps` (`cf install-plugin multiapps`), oraz `mbt` (`npm i -g mbt`)

Kroki:

    # 1. klucz OpenAI jako user-provided service (nie trafia do gita)
    cf cups business-partner-ai-openai -p '{"OPENAI_API_KEY":"sk-...","OPENAI_MODEL":"gpt-4o-mini"}'

    # 2. build + deploy
    mbt build
    cf deploy mta_archives/business-partner-ai_1.0.0.mtar

Po deployu:
- URL aplikacji = route modulu `business-partner-ai-approuter`
- przypisz uzytkownikom role collection `BusinessPartnerAI_User` (BTP cockpit -> Security -> Role Collections)
- podmiana klucza: `cf uups business-partner-ai-openai -p '{"OPENAI_API_KEY":"sk-..."}'` i restart `cf restart business-partner-ai-srv`

Moduly MTA:
- `business-partner-ai-srv`      – serwis CAP + graf LangGraph + endpoint SSE `/ai/ask-stream` (bez bazy)
- `business-partner-ai-approuter` – serwuje UI z `app/chat/` i pilnuje logowania (xsuaa)

Klucz OpenAI: `OPENAI_API_KEY` z env wygrywa; na BTP kod czyta go z powiazanego serwisu (`VCAP_SERVICES`).


## Frontend (SAPUI5 / Fiori, English)

`app/chat/` is a real SAPUI5 app (no React/Vue - only SAP's Fiori UI5):
- `index.html` bootstraps UI5 1.120 from the CDN, theme `sap_horizon_dark`
- `Component.js` + `manifest.json` - standard Fiori app descriptor
- `view/App.view.xml` - `sap.f.ShellBar` header (logo, title, avatar), two `sap.m.Panel`s
  (Assistant + Process), `sap.m.OverflowToolbar` footer with a light/dark toggle
- `controller/App.controller.js` - chat, SSE client, block-diagram control, email `sap.m.Dialog`
- `css/style.css` - self-contained light/dark palette for the SVG block diagram
- all UI text is English and lives in `i18n/i18n.properties`
- `img/logo.svg` is a placeholder mark - replace with the official SAP logo if your
  project is licensed to use it (drop the file in and keep the name)

Block diagram = classic flowchart (terminator / process / decision / manual step),
no `fail` box after the decision; the running / done / waiting / error step is
highlighted live from the SSE `node` events.

Note: UI5 is loaded from `https://ui5.sap.com`. If your landscape blocks it, switch the
bootstrap `src` to your BTP UI5 version (HTML5 repo / `sapui5.hana.ondemand.com`).
