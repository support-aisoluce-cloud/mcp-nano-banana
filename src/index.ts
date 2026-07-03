#!/usr/bin/env node
/* =============================================
   mcp-nano-banana — MCP server
   Nano Banana image generator (Google Gemini image models)
   ---------------------------------------------
   Authenticates with the user's personal nb_live_ API key
   (credits bought on the site) and drives the site's metered
   backend (api-generate Edge Function). The user never handles
   a Google key; generation runs server-side with the service key.

   Tools:
     - get_credits      : remaining credits + tier
     - list_models      : available Nano Banana models + per-gen credit cost
     - generate_image   : prompt -> Nano Banana image (saved locally)
     - analyze_image    : image -> structured JSON (character/style/palette…)
     - generate_caption : JSON -> Instagram caption + hashtags (local, free)
   ============================================= */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── CONFIG ────────────────────────────────────────
const API_KEY = process.env.NANOBANANA_API_KEY || process.env.IMG2JSON_API_KEY || "";
const API_BASE = (process.env.NANOBANANA_API_BASE || process.env.IMG2JSON_API_BASE || "").replace(/\/+$/, "");
const OUT_DIR = process.env.NANOBANANA_OUT_DIR || process.env.IMG2JSON_OUT_DIR || path.join(process.cwd(), "nano-banana-output");
const POLL_INTERVAL = 3000;
const MAX_ATTEMPTS = 80; // 80 × 3s ≈ 4 min

function assertConfig(): void {
  if (!API_KEY || !API_KEY.startsWith("nb_live_")) {
    throw new Error(
      "NANOBANANA_API_KEY manquante ou invalide. Crée une clé sur le site (Profil → API) et renseigne-la (format nb_live_…).",
    );
  }
  if (!API_BASE) {
    throw new Error("NANOBANANA_API_BASE manquante (ex: https://YOUR_PROJECT.supabase.co/functions/v1).");
  }
}

// ── HTTP helper (api-generate) ────────────────────
async function api(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API_BASE}/api-generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const detail = json?.need != null ? ` (besoin ${json.need}, dispo ${json.have})` : "";
    throw new Error((json?.error || `Erreur API ${res.status}`) + detail);
  }
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Image input loader (path | url | base64 | data-url) ──
async function loadImageBase64(input: string): Promise<{ base64: string; mime: string }> {
  const s = input.trim();
  if (s.startsWith("data:")) {
    const m = s.match(/^data:([^;]+);base64,(.*)$/s);
    if (!m) throw new Error("data URL invalide");
    return { mime: m[1], base64: m[2] };
  }
  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s);
    if (!r.ok) throw new Error(`Téléchargement image échoué (${r.status})`);
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    return { mime, base64: buf.toString("base64") };
  }
  // chemin local
  const abs = s.startsWith("~") ? path.join(os.homedir(), s.slice(1)) : path.resolve(s);
  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" : "image/jpeg";
    return { mime, base64: buf.toString("base64") };
  } catch {
    // dernier recours : on suppose que c'est déjà du base64 brut
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 64) {
      return { mime: "image/jpeg", base64: s.replace(/\s+/g, "") };
    }
    throw new Error(`Image introuvable / illisible : ${input}`);
  }
}

async function saveImage(url: string, prefix = "nb"): Promise<string> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Téléchargement du résultat échoué (${r.status})`);
  const ct = r.headers.get("content-type") || "";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const buf = Buffer.from(await r.arrayBuffer());
  const name = `${prefix}_${Date.now()}.${ext}`;
  const out = path.join(OUT_DIR, name);
  await fs.writeFile(out, buf);
  return out;
}

// ── CAPTION GENERATOR (port de nano-banana-client.js, local & gratuit) ──
function resolveSpinSyntax(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_, group: string) => {
    const opts = group.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

function generateCaption(jsonData: any, style = "engaging"): { caption: string; hashtags: string } {
  const c = jsonData?.character || {};
  const e = jsonData?.environment || {};
  const s = jsonData?.style || {};
  const tags: string[] = jsonData?.prompt_tags || [];

  const templates: Record<string, string[]> = {
    engaging: [
      `{✨|🔥|💫} {Découvrez|Explorez|Admirez} {cette création|cet univers} {incroyable|unique|époustouflant} créé avec l'IA\n\n${c.name ? `Rencontrez ${c.name} — ` : ""}${s.mood ? `une ambiance ${s.mood}` : "une vision artistique"} ${e.setting ? `dans ${e.setting}` : ""}\n\n{💬 Dites-moi ce que vous en pensez !|💬 Qu'en pensez-vous ?|💬 Partagez votre avis !}`,
      `{🎨|🖼️|✨} L'IA a créé {une œuvre unique|un personnage unique} !\n\n${c.name || "Ce personnage"} ${c.expression ? `avec une expression ${c.expression}` : ""} ${e.setting ? `dans ${e.setting}` : ""} ${s.art_style ? `— style ${s.art_style}` : ""}\n\n{Sauvegardez ce post si vous {aimez|adorez} ce style !|Double-cliquez si vous {aimez|adorez} !}`,
    ],
    minimal: [`${c.name || "Created with AI"} ${s.art_style ? `· ${s.art_style}` : ""} ${s.mood ? `· ${s.mood}` : ""}`],
    story: [
      `Il était une fois ${c.name || "un personnage"}...\n\n${e.setting ? `Dans ${e.setting}, ` : ""}${c.expression ? `avec un regard ${c.expression}, ` : ""}${s.mood ? `une histoire de ${s.mood} commence` : "une aventure commence"}.\n\n{💭 Imaginez la suite…|💭 Quelle est son histoire selon vous ?}`,
    ],
  };

  const pool = templates[style] || templates.engaging;
  const tpl = resolveSpinSyntax(pool[Math.floor(Math.random() * pool.length)]);

  const hashtagBase = [
    "#AIArt", "#AIGenerated", "#DigitalArt", "#AIArtwork", "#NanoBanana",
    ...tags.slice(0, 5).map((t) => "#" + t.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "")),
    s.art_style ? "#" + s.art_style.replace(/\s+/g, "") : "",
    e.setting ? "#" + e.setting.replace(/\s+/g, "").substring(0, 20) : "",
  ].filter(Boolean);
  const hashtags = [...new Set(hashtagBase)].slice(0, 15).join(" ");
  return { caption: tpl, hashtags };
}

// ── MCP SERVER ────────────────────────────────────
const server = new McpServer({ name: "mcp-nano-banana", version: "0.1.0" });

server.registerTool(
  "get_credits",
  {
    title: "Solde de crédits",
    description: "Retourne le solde de crédits et le tier de l'utilisateur (clé nb_live_).",
    inputSchema: {},
  },
  async () => {
    assertConfig();
    const r = await api({ action: "credits" });
    return { content: [{ type: "text", text: `Crédits : ${r.credits} · tier : ${r.tier}` }] };
  },
);

server.registerTool(
  "list_models",
  {
    title: "Modèles disponibles",
    description: "Liste les modèles nano banana disponibles et leur coût en crédits par génération.",
    inputSchema: {},
  },
  async () => {
    assertConfig();
    const r = await api({ action: "models" });
    return { content: [{ type: "text", text: JSON.stringify(r.models, null, 2) }] };
  },
);

server.registerTool(
  "analyze_image",
  {
    title: "Analyser une image → JSON",
    description:
      "Analyse une image (chemin local, URL ou base64) et retourne un JSON structuré (character, outfit, environment, style, color_palette, prompt_tags). Consomme des crédits.",
    inputSchema: {
      image: z.string().describe("Chemin local, URL http(s), data URL ou base64 brut de l'image."),
      detail: z.enum(["rapide", "standard", "détaillé"]).default("standard").describe("Niveau de détail de l'analyse."),
    },
  },
  async ({ image, detail }) => {
    assertConfig();
    const { base64, mime } = await loadImageBase64(image);
    const r = await api({ action: "analyze", image_base64: base64, mime, detail });
    const pretty = typeof r.json === "string" ? r.json : JSON.stringify(r.json, null, 2);
    const left = r.credits_left != null ? `\n\n(crédits restants : ${r.credits_left})` : "";
    return { content: [{ type: "text", text: pretty + left }] };
  },
);

server.registerTool(
  "generate_image",
  {
    title: "Générer une image nano banana",
    description:
      "Génère une image nano banana à partir d'un prompt (ou d'un JSON analysé). Tourne côté serveur via la clé Google du service ; consomme les crédits de l'utilisateur. L'image est téléchargée localement.",
    inputSchema: {
      prompt: z.string().describe("Prompt texte décrivant l'image à générer."),
      model: z.enum(["standard", "pro", "v2"]).default("standard").describe("standard = Nano Banana, pro = Nano Banana Pro, v2 = Nano Banana 2."),
      aspect_ratio: z.string().default("9:16").describe("Ratio (ex: 9:16 story/reels, 4:5 feed, 1:1 carré)."),
    },
  },
  async ({ prompt, model, aspect_ratio }) => {
    assertConfig();
    const sub = await api({ action: "generate", model, prompt, aspect_ratio });
    const taskId = sub.taskId;
    if (!taskId) throw new Error("Pas de taskId reçu.");

    let imageUrl = "";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL);
      const d = await api({ action: "poll", taskId });
      if (d.status === "done" && d.imageUrl) { imageUrl = d.imageUrl; break; }
      if (d.status === "failed") throw new Error(d.error || "Génération échouée.");
    }
    if (!imageUrl) throw new Error("Timeout : génération > 4 min.");

    const saved = await saveImage(imageUrl, "nb");
    const charged = sub.charged != null ? ` · ${sub.charged} crédits débités` : "";
    const left = sub.credits_left != null ? ` · ${sub.credits_left} restants` : "";
    return {
      content: [
        { type: "text", text: `✅ Image générée (${model}, ${aspect_ratio})${charged}${left}\nURL : ${imageUrl}\nSauvegardée : ${saved}` },
      ],
    };
  },
);

server.registerTool(
  "generate_caption",
  {
    title: "Générer une légende Instagram",
    description: "Génère une légende Instagram + hashtags à partir d'un JSON analysé (local, gratuit, aucun crédit).",
    inputSchema: {
      json: z.union([z.string(), z.record(z.any())]).describe("JSON analysé (objet ou chaîne JSON)."),
      style: z.enum(["engaging", "minimal", "story"]).default("engaging").describe("Style de légende."),
    },
  },
  async ({ json, style }) => {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const { caption, hashtags } = generateCaption(data, style);
    return { content: [{ type: "text", text: `${caption}\n\n${hashtags}` }] };
  },
);

// ── START ─────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-nano-banana prêt (stdio).");
}
main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
