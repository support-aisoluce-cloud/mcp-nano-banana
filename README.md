# mcp-nano-banana 🍌

An **MCP** server to generate **Nano Banana** images (Google Gemini image models) from any MCP client (Claude Desktop, Claude Code, etc.). It drives the site's metered backend: you bring **your own key** (credits bought on the site), and generation runs **server-side** with the service's Google key.

## Tools

- `generate_image` — prompt → **Nano Banana image**, generated then downloaded locally
- `analyze_image` — image → structured JSON (character / outfit / environment / style / palette / tags)
- `generate_caption` — JSON → Instagram caption + hashtags (local, **free**)
- `get_credits` / `list_models` — credit balance and available models

"Nano Banana" = Google Gemini image models:

| MCP `model` | Google model | Note |
|---|---|---|
| `standard` | `gemini-2.5-flash-image` | Nano Banana |
| `pro` | `gemini-3-pro-image-preview` | Nano Banana Pro (2K) |
| `v2` | `gemini-3-pro-image-preview` | Nano Banana 2 |

## Cost model

The user **never provides a Google key**. They buy **credits** on the site, create a **personal API key** (`nb_live_…`) and put it in the MCP. Generation runs server-side with the service's Google key, **directly against the Gemini API**, so at Google cost price, with no reseller markup.

```
MCP client ──nb_live_──▶ api-generate (charges credits) ──▶ nano-proxy ──▶ Google Gemini (direct)
                                                                        └▶ Storage `generations` ▶ URL
```

## Install (per user)

```bash
cd mcp-nano-banana
npm install
npm run build
cp .env.example .env   # then fill in NANOBANANA_API_KEY + NANOBANANA_API_BASE
```

`.env`:
```
NANOBANANA_API_KEY=nb_live_xxxxxxxx           # created on the site (Profile → API)
NANOBANANA_API_BASE=https://YOUR_PROJECT.supabase.co/functions/v1
NANOBANANA_OUT_DIR=                            # optional (default ./nano-banana-output)
```

### Wire it into an MCP client (e.g. Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["C:/path/to/mcp-nano-banana/dist/index.js"],
      "env": {
        "NANOBANANA_API_KEY": "nb_live_xxxxxxxx",
        "NANOBANANA_API_BASE": "https://YOUR_PROJECT.supabase.co/functions/v1"
      }
    }
  }
}
```

## Usage examples

- "Generate a 9:16 ad: *dark studio, acid lime neon…* with model `v2`" → `generate_image`
- "Analyze this image `C:/photos/portrait.png` in detail" → `analyze_image`
- "Write me a `story`-style Instagram caption from this JSON" → `generate_caption`

## Server side (backend deployment, once)

The Edge Functions live in `supabase/functions/` of the site project:

- **`nano-proxy`** — generates via **Google Gemini direct** + Storage upload.
- **`api-generate`** — `generate` / `poll` / `analyze` actions (metered) + `aspect_ratio`.

```bash
# a. PUBLIC Storage bucket named "generations"
# b. Edge Function secrets
supabase secrets set NB_GEMINI_KEY=AIza...           # the service's Google key
#   optional: ANALYZE_CREDITS=1
# c. Deploy
supabase functions deploy nano-proxy   --no-verify-jwt
supabase functions deploy api-generate --no-verify-jwt
```

## Security

- The `nb_live_` key is only an **account + credits identifier** (revocable, rate-limited in `api-generate`). No Google key on the client side.
- Public `generations` Storage = shareable URLs (Instagram publishing). Add a retention policy if needed.

## License

MIT
