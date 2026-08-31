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


## Deploy na SAP BTP (Cloud Foundry) — krok po kroku

Aplikacja jest bezstanowa: NIE ma bazy danych (ani HANA, ani zadnej innej).
MTA sklada sie z 2 modulow: `business-partner-ai-srv` (CAP + LangGraph + SSE)
i `business-partner-ai-approuter` (UI z `app/chat/` + logowanie xsuaa).

### 0. Wymagania (raz)

- narzedzia w terminalu: `cf`, `mbt`, plugin `multiapps`
  ```
  cf version
  mbt --version              # brak? -> npm i -g mbt
  cf plugins | grep multiapps # brak? -> cf install-plugin multiapps -f
  ```
- w subaccount: uprawnienia do uslug `xsuaa`, `destination`, `connectivity`
- destynacja **`SA1_300`** skonfigurowana w subaccount (ta sama, ktorej uzywa `getPartner`)

### 1. Zaloguj sie do Cloud Foundry

```
cf api https://api.cf.<region>.hana.ondemand.com
cf login --sso
cf target        # sprawdz org / space
```

### 2. Zapisz klucz OpenAI w Destynacji (raz)

Klucz NIE jest w mta.yaml ani w service bindingu (tam byl widoczny goly).
Trzyma go Destynacja z zamaskowanym polem Password.

BTP cockpit -> subaccount -> **Connectivity -> Destinations -> New Destination**:

| Pole | Wartosc |
|---|---|
| Name | `OPENAI` |
| Type | `HTTP` |
| URL | `https://api.openai.com/v1` |
| Proxy Type | `Internet` |
| Authentication | `BasicAuthentication` |
| User | `apikey` |
| Password | `sk-...` (zapisze sie jako `****`) |

Additional Properties (opcjonalnie): `OpenAI.Model` = `gpt-4o-mini`

Aplikacja czyta ja przez podpiety serwis `destination` (`srv/lib/graph.js`).

### 3. Zbuduj archiwum MTA

```
npm install
mbt build
```

Powstaje `mta_archives/business-partner-ai_1.0.0.mtar`.

### 4. Wdroz

```
cf deploy mta_archives/business-partner-ai_1.0.0.mtar
```

Deploy sam tworzy instancje `xsuaa` / `destination` / `connectivity`, podpina
`business-partner-ai-openai` i wypycha oba moduly.

### 5. Po wdrozeniu

```
cf apps                                  # URL modulu business-partner-ai-approuter
cf logs business-partner-ai-srv --recent # gdyby cos nie dzialalo
```

- w BTP cockpit: **Security -> Role Collections -> `BusinessPartnerAI_User`** -> dodaj swojego uzytkownika, przeloguj sie
- otworz `https://<approuter-url>` -> logowanie -> aplikacja

### Aktualizacje

- zmiana kodu: `mbt build` + `cf deploy mta_archives/*.mtar`
- sam klucz OpenAI: edytuj Destynacje `OPENAI` w cockpicie, potem `cf restart business-partner-ai-srv`

Kolejnosc szukania klucza: `OPENAI_API_KEY` z env -> bound service z `VCAP_SERVICES` ->
Destynacja `OPENAI` (pole Password). Model: `OPENAI_MODEL` z env -> `OpenAI.Model` z Destynacji -> `gpt-4o-mini`.
UI5 leci z `https://ui5.sap.com` — jesli landscape to blokuje, patrz sekcja Frontend nizej.


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
