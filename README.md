# mcp-img-to-json 🍌

Serveur **MCP** pour _nano banana · img → JSON_. Il fait, depuis n'importe quel client MCP (Claude, etc.), ce que fait le site :

- `analyze_image` — image → JSON structuré (character / outfit / environment / style / palette / tags)
- `generate_image` — prompt → image nano banana (téléchargée localement)
- `generate_caption` — JSON → légende Instagram + hashtags (local, **gratuit**)
- `get_credits` / `list_models` — solde et modèles

## Principe de coût

L'utilisateur **n'apporte aucune clé Google**. Il achète des **crédits** sur le site, crée une **clé API personnelle** (`nb_live_…`) et la met dans le MCP. La génération tourne **côté serveur** avec la clé Google du service, **en direct sur l'API Gemini** (`gemini-2.5-flash-image` / `gemini-3-pro-image`) — donc **au prix coûtant Google, sans marge revendeur**.

```
Client MCP ──nb_live_──▶ api-generate (débite crédits) ──▶ nano-proxy ──▶ Google Gemini (direct)
                                                                        └▶ Storage `generations` ▶ URL
```

« Nano Banana » = modèles image Google Gemini :
| MCP `model` | Modèle Google | Note |
|---|---|---|
| `standard` | `gemini-2.5-flash-image` | Nano Banana |
| `pro` | `gemini-3-pro-image-preview` | Nano Banana Pro (2K) |
| `v2` | `gemini-3-pro-image-preview` | Nano Banana 2 |

## 1) Côté serveur (à déployer une fois)

Les modifs sont déjà dans `supabase/functions/` :

- **`nano-proxy`** — réécrit pour générer via **Google Gemini direct** + upload Storage.
- **`api-generate`** — nouvelle action `analyze` (métrée) + passage du `aspect_ratio`.

Étapes :

```bash
# a. Bucket Storage PUBLIC nommé "generations" (dashboard Supabase → Storage → New bucket → Public)

# b. Secrets Edge Functions
supabase secrets set NB_GEMINI_KEY=AIza...           # clé Google du service
#   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CONSUME_SECRET déjà présents)
#   optionnel : ANALYZE_CREDITS=1   (coût en crédits d'une analyse)

# c. Déploiement
supabase functions deploy nano-proxy   --no-verify-jwt
supabase functions deploy api-generate --no-verify-jwt
```

> Le site continue de marcher à l'identique : le contrat `generate→taskId` / `poll→imageUrl` est préservé (la génération Gemini est synchrone, l'URL est encodée dans le `taskId`).

## 2) Côté MCP (chaque utilisateur)

```bash
cd mcp-img-to-json
npm install
npm run build
cp .env.example .env   # puis renseigne IMG2JSON_API_KEY + IMG2JSON_API_BASE
```

`.env` :
```
IMG2JSON_API_KEY=nb_live_xxxxxxxx           # créée sur le site (Profil → API)
IMG2JSON_API_BASE=https://YOUR_PROJECT.supabase.co/functions/v1
IMG2JSON_OUT_DIR=                            # optionnel
```

### Brancher dans un client MCP (ex. Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "img-to-json": {
      "command": "node",
      "args": ["C:/chemin/vers/mcp-img-to-json/dist/index.js"],
      "env": {
        "IMG2JSON_API_KEY": "nb_live_xxxxxxxx",
        "IMG2JSON_API_BASE": "https://YOUR_PROJECT.supabase.co/functions/v1"
      }
    }
  }
}
```

## Exemples d'usage

- « Analyse cette image `C:/photos/perso.png` en détaillé » → `analyze_image`
- « Génère une pub 9:16 : *dark studio, acid lime neon…* en modèle `v2` » → `generate_image`
- « Fais-moi une légende Instagram `story` à partir de ce JSON » → `generate_caption`

## Sécurité

- La clé `nb_live_` n'est qu'un **identifiant de compte + crédits** (révocable, rate-limitée côté `api-generate`). Aucune clé Google côté client.
- Storage `generations` public = URLs partageables (publication Instagram). Mets une politique de rétention si besoin.
