# mcp-nano-banana 🍌

Serveur **MCP** pour générer des images **Nano Banana** (modèles image Google Gemini) depuis n'importe quel client MCP (Claude Desktop, Claude Code, etc.). Il pilote le backend métré du site : tu apportes **ta clé perso** (crédits achetés sur le site), la génération tourne **côté serveur** avec la clé Google du service.

## Outils exposés

- `generate_image` — prompt → **image Nano Banana** générée puis téléchargée localement
- `analyze_image` — image → JSON structuré (character / outfit / environment / style / palette / tags)
- `generate_caption` — JSON → légende Instagram + hashtags (local, **gratuit**)
- `get_credits` / `list_models` — solde de crédits et modèles disponibles

« Nano Banana » = modèles image Google Gemini :

| MCP `model` | Modèle Google | Note |
|---|---|---|
| `standard` | `gemini-2.5-flash-image` | Nano Banana |
| `pro` | `gemini-3-pro-image-preview` | Nano Banana Pro (2K) |
| `v2` | `gemini-3-pro-image-preview` | Nano Banana 2 |

## Principe de coût

L'utilisateur **n'apporte aucune clé Google**. Il achète des **crédits** sur le site, crée une **clé API personnelle** (`nb_live_…`) et la met dans le MCP. La génération tourne côté serveur avec la clé Google du service, **en direct sur l'API Gemini**, donc au prix coûtant Google, sans marge revendeur.

```
Client MCP ──nb_live_──▶ api-generate (débite crédits) ──▶ nano-proxy ──▶ Google Gemini (direct)
                                                                        └▶ Storage `generations` ▶ URL
```

## Installation (chaque utilisateur)

```bash
cd mcp-nano-banana
npm install
npm run build
cp .env.example .env   # puis renseigne NANOBANANA_API_KEY + NANOBANANA_API_BASE
```

`.env` :
```
NANOBANANA_API_KEY=nb_live_xxxxxxxx           # créée sur le site (Profil → API)
NANOBANANA_API_BASE=https://YOUR_PROJECT.supabase.co/functions/v1
NANOBANANA_OUT_DIR=                            # optionnel (défaut ./nano-banana-output)
```

### Brancher dans un client MCP (ex. Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["C:/chemin/vers/mcp-nano-banana/dist/index.js"],
      "env": {
        "NANOBANANA_API_KEY": "nb_live_xxxxxxxx",
        "NANOBANANA_API_BASE": "https://YOUR_PROJECT.supabase.co/functions/v1"
      }
    }
  }
}
```

## Exemples d'usage

- « Génère une pub 9:16 : *dark studio, acid lime neon…* en modèle `v2` » → `generate_image`
- « Analyse cette image `C:/photos/perso.png` en détaillé » → `analyze_image`
- « Fais-moi une légende Instagram `story` à partir de ce JSON » → `generate_caption`

## Côté serveur (déploiement du backend, une fois)

Les Edge Functions sont dans `supabase/functions/` du projet site :

- **`nano-proxy`** — génère via **Google Gemini direct** + upload Storage.
- **`api-generate`** — action `generate` / `poll` / `analyze` (métrées) + `aspect_ratio`.

```bash
# a. Bucket Storage PUBLIC nommé "generations"
# b. Secrets Edge Functions
supabase secrets set NB_GEMINI_KEY=AIza...           # clé Google du service
#   optionnel : ANALYZE_CREDITS=1
# c. Déploiement
supabase functions deploy nano-proxy   --no-verify-jwt
supabase functions deploy api-generate --no-verify-jwt
```

## Sécurité

- La clé `nb_live_` n'est qu'un **identifiant de compte + crédits** (révocable, rate-limitée côté `api-generate`). Aucune clé Google côté client.
- Storage `generations` public = URLs partageables (publication Instagram). Ajoute une politique de rétention si besoin.

## Licence

MIT
