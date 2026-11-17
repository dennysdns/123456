<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/61fe81b2-2c80-4e65-942e-ff7c4c686438

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Versão desktop (Windows .exe)

O app roda em Electron carregando o build do Vite (`electron/main.cjs`), que é servido
por um esquema próprio `app://` para preservar IndexedDB (projetos e mídias),
áudio e caminhos relativos de assets.

```bash
bun install
bun run desktop:dist   # instalador NSIS + versão portátil (.exe) em release/
```

Em Linux/macOS o instalador NSIS precisa do Wine; para gerar apenas o pacote
Windows portátil (`.zip` com o `.exe` dentro), use `bun run desktop:pack`.
Também é possível gerar o `.exe` pelo GitHub Actions:
*Actions → Desktop (Windows) → Run workflow*.

Para desenvolver com o servidor Vite já rodando: `bun run desktop:dev`.

