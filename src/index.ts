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
      "NANOBANANA_API_KEY missing or invalid. Create a key on the site (Profile → API) and enter it (format nb_live_…).",
    );
  }
  if (!API_BASE) {
    throw new Error("NANOBANANA_API_BASE missing (e.g.: https://YOUR_PROJECT.supabase.co/functions/v1).");
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
    const detail = json?.need != null ? ` (need ${json.need}, available ${json.have})` : "";
    throw new Error((json?.error || `API error ${res.status}`) + detail);
  }
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Image input loader (path | url | base64 | data-url) ──
async function loadImageBase64(input: string): Promise<{ base64: string; mime: string }> {
  const s = input.trim();
  if (s.startsWith("data:")) {
    const m = s.match(/^data:([^;]+);base64,(.*)$/s);
    if (!m) throw new Error("invalid data URL");
    return { mime: m[1], base64: m[2] };
  }
  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s);
    if (!r.ok) throw new Error(`Image download failed (${r.status})`);
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    return { mime, base64: buf.toString("base64") };
  }
  // local path
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
    // last resort: assume it is already raw base64
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 64) {
      return { mime: "image/jpeg", base64: s.replace(/\s+/g, "") };
    }
    throw new Error(`Image not found / unreadable: ${input}`);
  }
}

async function saveImage(url: string, prefix = "nb"): Promise<string> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Result download failed (${r.status})`);
  const ct = r.headers.get("content-type") || "";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const buf = Buffer.from(await r.arrayBuffer());
  const name = `${prefix}_${Date.now()}.${ext}`;
  const out = path.join(OUT_DIR, name);
  await fs.writeFile(out, buf);
  return out;
}

// ── CAPTION GENERATOR (port of nano-banana-client.js, local & free) ──
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
    title: "Credit balance",
    description: "Returns the user's credit balance and tier (nb_live_ key).",
    inputSchema: {},
  },
  async () => {
    assertConfig();
    const r = await api({ action: "credits" });
    return { content: [{ type: "text", text: `Credits: ${r.credits} · tier: ${r.tier}` }] };
  },
);

server.registerTool(
  "list_models",
  {
    title: "Available models",
    description: "Lists the available nano banana models and their credit cost per generation.",
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
    title: "Analyze an image → JSON",
    description:
      "Analyzes an image (local path, URL or base64) and returns structured JSON (character, outfit, environment, style, color_palette, prompt_tags). Consumes credits.",
    inputSchema: {
      image: z.string().describe("Local path, http(s) URL, data URL or raw base64 of the image."),
      detail: z.enum(["rapide", "standard", "détaillé"]).default("standard").describe("Level of detail of the analysis."),
    },
  },
  async ({ image, detail }) => {
    assertConfig();
    const { base64, mime } = await loadImageBase64(image);
    const r = await api({ action: "analyze", image_base64: base64, mime, detail });
    const pretty = typeof r.json === "string" ? r.json : JSON.stringify(r.json, null, 2);
    const left = r.credits_left != null ? `\n\n(credits remaining: ${r.credits_left})` : "";
    return { content: [{ type: "text", text: pretty + left }] };
  },
);

server.registerTool(
  "generate_image",
  {
    title: "Generate a nano banana image",
    description:
      "Generates a nano banana image from a prompt (or from analyzed JSON). Runs server-side via the service's Google key; consumes the user's credits. The image is downloaded locally.",
    inputSchema: {
      prompt: z.string().describe("Text prompt describing the image to generate."),
      model: z.enum(["standard", "pro", "v2"]).default("standard").describe("standard = Nano Banana, pro = Nano Banana Pro, v2 = Nano Banana 2."),
      aspect_ratio: z.string().default("9:16").describe("Ratio (e.g.: 9:16 story/reels, 4:5 feed, 1:1 square)."),
    },
  },
  async ({ prompt, model, aspect_ratio }) => {
    assertConfig();
    const sub = await api({ action: "generate", model, prompt, aspect_ratio });
    const taskId = sub.taskId;
    if (!taskId) throw new Error("No taskId received.");

    let imageUrl = "";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL);
      const d = await api({ action: "poll", taskId });
      if (d.status === "done" && d.imageUrl) { imageUrl = d.imageUrl; break; }
      if (d.status === "failed") throw new Error(d.error || "Generation failed.");
    }
    if (!imageUrl) throw new Error("Timeout: generation > 4 min.");

    const saved = await saveImage(imageUrl, "nb");
    const charged = sub.charged != null ? ` · ${sub.charged} credits charged` : "";
    const left = sub.credits_left != null ? ` · ${sub.credits_left} remaining` : "";
    return {
      content: [
        { type: "text", text: `✅ Image generated (${model}, ${aspect_ratio})${charged}${left}\nURL: ${imageUrl}\nSaved: ${saved}` },
      ],
    };
  },
);

server.registerTool(
  "generate_caption",
  {
    title: "Generate an Instagram caption",
    description: "Generates an Instagram caption + hashtags from analyzed JSON (local, free, no credits).",
    inputSchema: {
      json: z.union([z.string(), z.record(z.any())]).describe("Analyzed JSON (object or JSON string)."),
      style: z.enum(["engaging", "minimal", "story"]).default("engaging").describe("Caption style."),
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
  console.error("mcp-nano-banana ready (stdio).");
}
main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
