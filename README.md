<p align="center"><img src="assets/logo.svg" width="96" alt="just-Code"></p>

# just-Code

IDE di codice AI **nel terminale** e con **interfaccia grafica**: un modello *orchestratore* (es. Gemini) capisce la richiesta, la divide in piccoli compiti e lancia **sub-agenti in parallelo** che leggono, scrivono e modificano i file ed eseguono comandi. L'orchestratore raccoglie i report, verifica e risponde.

Provider supportati: **Google Gemini** (login con account Google oppure API key), **Groq**, **OpenRouter**, **OpenAI** e **qualsiasi API compatibile OpenAI** (Ollama, LM Studio, vLLM…).

```
❯ aggiungi i test per utils/date.ts e aggiorna il README

╭──────────────────────────────────────────────────────────────────╮
│ ⠹ orchestrator gemini:gemini-pro-latest  delegating to 3 agents… │
│   sub-agents ████████░░░░░░░░ 1/3                                │
│   ├─ ✔ explorer    gemini:gemini-flash-latest · 4.1s · 5 tools   │
│   ├─ ⠼ test-writer groq:llama-3.3-70b · 6.0s  write_file …       │
│   └─ ⠦ docs        gemini:gemini-flash-latest  edit_file README  │
╰──────────────────────────────────────────────────────────────────╯
```

## Installazione

Funziona su **macOS, Linux e Windows** con Node.js 20 o successivo.

```bash
npm install -g @justapps/just-code
just-code            # oppure: jc
```

In alternativa:
- macOS e Linux: `curl -fsSL https://code.justapps.it/install.sh | sh`
- Windows (PowerShell): `irm https://code.justapps.it/install.ps1 | iex`
- Ultima release da GitHub: `npm install -g https://code.justapps.it/latest.tgz`

I comandi degli agenti girano con la tua shell su macOS e Linux, con `cmd.exe` su Windows. In Git Bash su Windows avvia con `winpty just-code`.

Da sorgente: `npm install && npm run build && npm link`.

## Primo avvio: configurazione guidata

Al primo avvio just-Code ti guida in 5 passi:
1. scegli il provider (Gemini con chiave gratuita, Groq, OpenRouter, OpenAI, login Google, Ollama/locale);
2. inserisci la chiave (si apre la pagina dove crearla) o fai il login;
3. just-Code prova la connessione;
4. scegli i modelli per orchestratore e sub-agenti;
5. scegli se chiedere conferma o andare in TURBO.

Puoi rifarla quando vuoi con `/setup` oppure `just-code setup`.

## App desktop

Nelle [release su GitHub](https://github.com/justapps-it/JustCode/releases/latest) trovi l'app già pronta, senza bisogno di Node.js né del terminale:

| Sistema | File |
|---|---|
| macOS (Apple Silicon) | `just-Code-<versione>-mac-arm64.dmg` |
| macOS (Intel) | `just-Code-<versione>-mac-x64.dmg` |
| Windows | `just-Code-<versione>-win-x64.exe` |
| Linux | `just-Code-<versione>-linux-x86_64.AppImage` |

All'avvio scegli la cartella del progetto (*File → Apri cartella*, `Ctrl/Cmd+O`; ogni cartella si apre nella sua finestra, con le recenti nel menu). L'app non è firmata da Apple/Microsoft: su macOS, dopo il primo tentativo di apertura, vai in *Impostazioni di Sistema → Privacy e sicurezza → Apri comunque*; su Windows clicca *Ulteriori informazioni → Esegui comunque*.

L'app è costruita con Electron dalla cartella `desktop/` (`cd desktop && npm install && npm start` per provarla da sorgente, dopo `npm run build` nella radice).

## Interfaccia grafica dal terminale

```bash
just-code gui
```

Apre just-Code in una finestra (Chrome/Edge in modalità app, altrimenti il browser) con chat, pannello dei sub-agenti in tempo reale, finestre di conferma con il diff, interruttore TURBO, configurazione guidata e autocompletamento. Gira solo in locale (`127.0.0.1`, con un token casuale) e usa lo stesso motore, gli stessi comandi e la stessa configurazione del terminale. Opzioni: `--port <n>`, `--no-open`.

## Autocompletamento e suggerimenti

- `/` mostra i comandi; **Tab** completa anche gli argomenti (provider, modelli `provider:modello`, `on/off`, file `.json`…). Il testo suggerito appare in grigio dopo il cursore.
- `@` cerca i file del progetto (ricerca fuzzy): `sistema @src/auth/log` → `@src/auth/login.ts`. I file citati vengono segnalati all'orchestratore.
- **↑/↓** scorrono i suggerimenti, oppure la cronologia dei prompt (salvata in `~/.just-code/history.json`).
- A conversazione vuota just-Code propone dei prompt adatti al progetto (test, build, revisione delle modifiche…).

## Release

Ad ogni push GitHub Actions esegue i test su Linux, macOS e Windows (Node 20 e 22). Se la versione in `package.json` non è ancora pubblicata, crea la release su GitHub e pubblica su npm con **Trusted Publishing** (OIDC, senza token). Per una nuova release basta aumentare `version` in `package.json` e fare push.

## Accesso a Gemini

**Il modo più semplice (gratis):** crea una chiave su [Google AI Studio](https://aistudio.google.com/apikey) — senza attivare la fatturazione hai il livello gratuito — e in just-Code scrivi `/key gemini <KEY>` (oppure `export GEMINI_API_KEY=...`). Se c'è una chiave, ha la precedenza sul login.

**Con il login Google:** `/login <id-progetto>` apre il browser, accedi con il tuo account e il token viene salvato in `~/.just-code/google-auth.json` (si rinnova da solo). L'uso viene addebitato al **tuo** progetto Google Cloud (con la *Generative Language API* abilitata), mai a quello di just-Code. Puoi cambiarlo con `/project <id-progetto>` o `GOOGLE_CLOUD_QUOTA_PROJECT`.

Per usare un tuo client OAuth (tipo **Desktop app**): `/google-client ~/Downloads/client_secret_xxx.json` oppure `/google-client <CLIENT_ID> <CLIENT_SECRET>`.

## Altri provider

| Provider   | Chiave                                       | Esempio modello                       |
|------------|----------------------------------------------|---------------------------------------|
| groq       | `GROQ_API_KEY` o `/key groq …`               | `groq:llama-3.3-70b-versatile`        |
| openrouter | `OPENROUTER_API_KEY` o `/key openrouter …`   | `openrouter:deepseek/deepseek-chat`   |
| openai     | `OPENAI_API_KEY` o `/key openai …`           | `openai:gpt-4.1-mini`                 |
| custom     | `/baseurl custom http://localhost:11434/v1`  | `custom:llama3.1`                     |

Scegli i modelli:

```
/model orchestrator gemini:gemini-pro-latest
/model sub groq:llama-3.3-70b-versatile
```

L'orchestratore può anche scegliere un modello diverso per ogni singolo sub-agente (campo `model` di `spawn_agents`).

## Permessi e ⚡ TURBO

Di default, prima di **scrivere o modificare file** e di **eseguire comandi shell**, just-Code chiede conferma:
`[y]` sì · `[a]` sempre per questo tool · `[n]` no · `[t]` **TURBO**.

**Ragionamento:** con `/thinking on` (oppure `just-code --thinking`, o l'interruttore 💭 *Thinking* nella GUI) just-Code mostra il ragionamento dei modelli che lo rendono disponibile: riassunti dei pensieri di Gemini 2.5/3, il campo `reasoning` di OpenRouter e Groq (gpt-oss), `reasoning_content` di DeepSeek, i blocchi `<think>` di Qwen3/DeepSeek-R1 su Ollama. Quello dell'orchestratore compare nella conversazione, quello dei sub-agenti nel loro pannello.

**TURBO** (`/turbo`, il tasto `t` in un prompt, oppure `just-code --turbo`) fa agire gli agenti senza chiedere conferma, e si attiva con un'animazione arcobaleno. `/turbo` lo spegne.
Gli agenti possono lavorare solo dentro la cartella in cui hai avviato just-Code.

## Budget e scelta dei modelli

L'orchestratore sceglie il modello di **ogni sub-agente** tra quelli che i tuoi provider offrono in quel momento: economico e veloce per leggere e cercare, più forte per bug difficili e refactoring. Il limite lo decidi tu con il **budget per richiesta**:

- `/budget` apre lo slider (← → per spostarsi, `c` per un importo esatto, `a` per attivare/disattivare la scelta automatica); nella GUI clicca il pulsante del budget in alto.
- `/budget free` → solo modelli gratuiti · `/budget 0.25` o `/budget 50c` → al massimo quella spesa · `/budget off` → nessun limite.
- `/auto off` → i sub-agenti usano sempre il modello di `/model sub`.

Da dove arrivano i prezzi (in USD per 1M token): **OpenRouter** li pubblica e just-Code li legge dal vivo; i **modelli locali** (Ollama, LM Studio…) sono gratis; le chiavi del **piano gratuito** senza fatturazione (es. AI Studio, Groq free) contano come gratis — si segnano nella GUI, e la configurazione guidata lo fa da sola; puoi aggiungere prezzi tuoi in `~/.just-code/config.json` (`"prices": { "openai:gpt-4.1": { "in": 2, "out": 8 } }`). Per gli altri modelli il prezzo è sconosciuto: possono essere usati ma la loro spesa non viene contata (lo slider te lo dice). La spesa della richiesta in corso appare nella barra di stato e, nella GUI, nella barra sotto l'intestazione; a budget esaurito just-Code si ferma.

## Comandi

| Comando | |
|---|---|
| `/help` | elenco comandi (Tab completa) |
| `/setup` | configurazione guidata |
| `/login [progetto]`, `/logout` | account Google per Gemini |
| `/project <id>` | progetto Google Cloud usato con il login |
| `/google-client <id> <secret> [project]` | client OAuth |
| `/key <provider> <key>` | salva una API key |
| `/baseurl <provider> <url>` | endpoint compatibile OpenAI |
| `/model <orchestrator\|sub> <provider:model>` | cambia modello |
| `/budget [free\|0.25\|off]` | budget per richiesta (senza argomento: slider) |
| `/auto [on\|off]` | l'orchestratore sceglie il modello dei sub-agenti |
| `/parallel <n>` | numero massimo di sub-agenti in parallelo |
| `/turbo` | attiva o disattiva TURBO |
| `/thinking [on\|off]` | mostra il ragionamento dei modelli |
| `/models [provider]` | modelli disponibili ora presso i tuoi provider |
| `/status`, `/clear`, `/exit` | |

Tasti: `Tab` completa, `↑/↓` suggerimenti e cronologia, `Esc` interrompe il lavoro in corso, `Ctrl+C` due volte esce.

Opzioni da riga di comando: `just-code --turbo --orchestrator gemini:gemini-pro-latest --sub groq:llama-3.3-70b-versatile --parallel 6 "prompt iniziale"`

La configurazione sta in `~/.just-code/config.json` (puoi cambiare la cartella con `JUST_CODE_HOME`).

## Architettura

```
src/
  cli.tsx                 entry point e argomenti
  config.ts               configurazione, provider, chiavi
  auth/google.ts          login OAuth Google (loopback + PKCE, refresh token)
  providers/              gemini.ts (API nativa) · openaiCompat.ts (Groq/OpenRouter/OpenAI/custom)
  agents/loop.ts          ciclo agente con tool-calling (tool eseguiti in parallelo)
  agents/orchestrator.ts  orchestratore + tool spawn_agents (pool parallelo di sub-agenti)
  tools/                  read_file, list_files, search, write_file, edit_file, run_shell
  core/                   comandi, autocompletamento, cronologia, configurazione guidata (condivisi da TUI e GUI)
  ui/                     Ink: logo animato, prompt con suggerimenti, setup, pannello agenti, permessi, TURBO
  gui/server.ts           server locale della GUI (SSE + API, solo 127.0.0.1 con token)
gui/                      interfaccia grafica (HTML/CSS/JS, font IBM Plex Mono incluso)
desktop/                  app desktop Electron (main.mjs) + configurazione degli installer
```

Ispirato all'esperienza d'uso di [Claude Code](https://github.com/anthropics/claude-code).
