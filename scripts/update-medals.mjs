#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://www.olympics.com/en/milano-cortina-2026/medals";
const FALLBACK_PROXY_URL = "https://r.jina.ai/http://www.olympics.com/en/milano-cortina-2026/medals";
const ESPN_URL = "https://www.espn.com/olympics/winter/2026/medals/_/view/overall/sort/total";
const ESPN_FALLBACK_PROXY_URL = "https://r.jina.ai/http://www.espn.com/olympics/winter/2026/medals/_/view/overall/sort/total";
const FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const COUNTRY_TO_NOC = {
  "Australia": "AUS", "Austria": "AUT", "Belarus": "BLR", "Belgium": "BEL", "Bulgaria": "BUL",
  "Brazil": "BRA", "Canada": "CAN", "China": "CHN", "Croatia": "CRO", "Czech Republic": "CZE", "Czechia": "CZE",
  "Denmark": "DEN", "Estonia": "EST", "Finland": "FIN", "France": "FRA", "Germany": "GER",
  "Georgia": "GEO", "Great Britain": "GBR", "United Kingdom": "GBR", "Greece": "GRE", "Hungary": "HUN",
  "Ireland": "IRL", "Italy": "ITA", "Japan": "JPN", "Kazakhstan": "KAZ", "Latvia": "LAT",
  "Lithuania": "LTU", "Netherlands": "NED", "New Zealand": "NZL", "Norway": "NOR",
  "Poland": "POL", "Romania": "ROU", "Serbia": "SRB", "Slovakia": "SVK", "Slovenia": "SLO",
  "South Korea": "KOR", "Korea": "KOR", "Spain": "ESP", "Sweden": "SWE", "Switzerland": "SUI",
  "Ukraine": "UKR", "United States": "USA", "USA": "USA"
};

const NOC_TO_COUNTRY = {
  AUS: "Australia", AUT: "Austria", BEL: "Belgium", BLR: "Belarus", BUL: "Bulgaria", CAN: "Canada",
  BRA: "Brazil", CHN: "China", CRO: "Croatia", CZE: "Czechia", DEN: "Denmark", EST: "Estonia", FIN: "Finland",
  FRA: "France", GBR: "Great Britain", GER: "Germany", GRE: "Greece", HUN: "Hungary", IRL: "Ireland",
  GEO: "Georgia", ITA: "Italy", JPN: "Japan", KAZ: "Kazakhstan", KOR: "South Korea", LAT: "Latvia", LTU: "Lithuania",
  NED: "Netherlands", NOR: "Norway", NZL: "New Zealand", POL: "Poland", ROU: "Romania",
  SRB: "Serbia", SLO: "Slovenia", SVK: "Slovakia", ESP: "Spain", SWE: "Sweden", SUI: "Switzerland",
  UKR: "Ukraine", USA: "United States"
};

const NOC_TO_ISO2 = {
  AUS: "AU", AUT: "AT", BEL: "BE", BLR: "BY", BRA: "BR", BUL: "BG", CAN: "CA", CHN: "CN", CRO: "HR",
  CZE: "CZ", DEN: "DK", EST: "EE", FIN: "FI", FRA: "FR", GBR: "GB", GER: "DE", GRE: "GR",
  GEO: "GE", HUN: "HU", IRL: "IE", ITA: "IT", JPN: "JP", KAZ: "KZ", KOR: "KR", LAT: "LV", LTU: "LT",
  NED: "NL", NOR: "NO", NZL: "NZ", POL: "PL", ROU: "RO", SRB: "RS", SLO: "SI", SVK: "SK",
  ESP: "ES", SWE: "SE", SUI: "CH", UKR: "UA", USA: "US"
};

function sanitizeCountryName(raw) {
  return String(raw || "")
    .replace(/\s*\([^)]+\)\s*/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyEventName(value) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("ski") ||
    text.includes("snowboard") ||
    text.includes("biathlon") ||
    text.includes("curling") ||
    text.includes("bobsleigh") ||
    text.includes("luge") ||
    text.includes("skeleton") ||
    text.includes("hockey") ||
    text.includes("skating") ||
    text.includes("freestyle") ||
    text.includes("women") ||
    text.includes("men") ||
    text.includes("mixed") ||
    text.includes("relay") ||
    text.includes("final") ||
    text.includes("qualification") ||
    text.includes("event")
  );
}

function resolveNoc(country, noc) {
  if (/^[A-Z]{3}$/.test(noc) && NOC_TO_ISO2[noc]) return noc;
  return COUNTRY_TO_NOC[country] || "";
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const gold = Number(row.gold ?? row.g ?? row.medalsGold ?? 0);
      const silver = Number(row.silver ?? row.s ?? row.medalsSilver ?? 0);
      const bronze = Number(row.bronze ?? row.b ?? row.medalsBronze ?? 0);

      const rawCountry = row.country ?? row.name ?? row.team ?? row.nocName ?? "";
      let country = sanitizeCountryName(rawCountry);
      const nocValue = String(row.noc ?? row.code ?? row.nocCode ?? row.countryCode ?? "").trim().toUpperCase();
      const noc = resolveNoc(country, nocValue);
      if (!country && noc && NOC_TO_COUNTRY[noc]) country = NOC_TO_COUNTRY[noc];

      if (
        !country ||
        Number.isNaN(gold) ||
        Number.isNaN(silver) ||
        Number.isNaN(bronze) ||
        !noc ||
        isLikelyEventName(country)
      ) {
        return null;
      }

      return {
        country: NOC_TO_COUNTRY[noc] || country,
        noc,
        gold,
        silver,
        bronze,
        total: gold + silver + bronze
      };
    })
    .filter(Boolean)
    .filter((row) => row.total > 0);
}

function extractMedalsDeep(node, output) {
  if (!node) return;
  if (Array.isArray(node)) {
    const normalized = normalizeRows(node);
    if (normalized.length >= 5) {
      output.push(...normalized);
      return;
    }
    node.forEach((item) => extractMedalsDeep(item, output));
    return;
  }
  if (typeof node !== "object") return;

  Object.keys(node).forEach((key) => extractMedalsDeep(node[key], output));
}

function parseRowsFromHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const collected = [];

  for (const match of scripts) {
    const raw = String(match[1] || "").trim();
    if (!raw) continue;

    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        extractMedalsDeep(JSON.parse(raw), collected);
      } catch {}
    }

    const nextMatch = raw.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*\});?/);
    if (nextMatch) {
      try {
        extractMedalsDeep(JSON.parse(nextMatch[1]), collected);
      } catch {}
    }
  }

  const byCountry = new Map();
  for (const item of collected) {
    const key = `${item.country}|${item.noc}`;
    if (!byCountry.has(key) || byCountry.get(key).total < item.total) {
      byCountry.set(key, item);
    }
  }

  const valid = [...byCountry.values()].filter((row) => NOC_TO_ISO2[row.noc]);
  valid.sort((a, b) => (
    (b.total - a.total) ||
    (b.gold - a.gold) ||
    (b.silver - a.silver) ||
    (b.bronze - a.bronze) ||
    a.country.localeCompare(b.country)
  ));
  return valid;
}

function parseRowsFromText(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  const seen = new Set();
  const countryNames = Object.keys(COUNTRY_TO_NOC).sort((a, b) => b.length - a.length);

  for (const line of lines) {
    for (const country of countryNames) {
      if (!line.toLowerCase().includes(country.toLowerCase())) continue;
      const noc = COUNTRY_TO_NOC[country];
      if (!noc || !NOC_TO_ISO2[noc]) continue;
      const nums = line.match(/\d+/g) || [];
      if (nums.length < 4) continue;

      const gold = Number(nums[0]);
      const silver = Number(nums[1]);
      const bronze = Number(nums[2]);
      const total = Number(nums[3]);
      if ([gold, silver, bronze, total].some((n) => Number.isNaN(n))) continue;
      if (gold + silver + bronze !== total) continue;

      const key = `${noc}|${country}`;
      if (seen.has(key)) break;
      seen.add(key);
      rows.push({ noc, country, gold, silver, bronze, total });
      break;
    }
  }

  rows.sort((a, b) => (
    (b.total - a.total) ||
    (b.gold - a.gold) ||
    (b.silver - a.silver) ||
    (b.bronze - a.bronze) ||
    a.country.localeCompare(b.country)
  ));
  return rows;
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRowsFromEspnText(content) {
  const text = `${String(content || "")}\n${stripHtmlTags(content)}`;
  const rows = [];
  const seen = new Set();
  const re = /\b([A-Z]{3})\s+([A-Za-z][A-Za-z .'\-()&]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\b/g;
  let match = re.exec(text);

  while (match) {
    const noc = match[1];
    const country = sanitizeCountryName(match[2]);
    const gold = Number(match[3]);
    const silver = Number(match[4]);
    const bronze = Number(match[5]);
    const total = Number(match[6]);

    if (
      NOC_TO_ISO2[noc] &&
      !Number.isNaN(gold) &&
      !Number.isNaN(silver) &&
      !Number.isNaN(bronze) &&
      !Number.isNaN(total) &&
      gold + silver + bronze === total &&
      total > 0
    ) {
      const key = `${noc}|${country}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({
          noc,
          country: NOC_TO_COUNTRY[noc] || country,
          gold,
          silver,
          bronze,
          total
        });
      }
    }

    match = re.exec(text);
  }

  rows.sort((a, b) => (
    (b.total - a.total) ||
    (b.gold - a.gold) ||
    (b.silver - a.silver) ||
    (b.bronze - a.bronze) ||
    a.country.localeCompare(b.country)
  ));

  return rows;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,it;q=0.7",
      "Referer": "https://www.olympics.com/"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPageWithRetry(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await fetchPage(url);
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        console.warn(`Fetch attempt ${attempt}/${FETCH_RETRIES} failed for ${url}: ${error?.message || error}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function fetchRows() {
  const sources = [
    SOURCE_URL,
    FALLBACK_PROXY_URL,
    ESPN_URL,
    ESPN_FALLBACK_PROXY_URL
  ];
  let lastError = null;

  for (const url of sources) {
    try {
      const content = await fetchPageWithRetry(url);
      const candidates = [
        parseRowsFromHtml(content),
        parseRowsFromEspnText(content),
        parseRowsFromText(content)
      ];

      const best = candidates.sort((a, b) => b.length - a.length)[0];
      if (best.length >= 5) return { rows: best, sourceUrl: url };

      lastError = new Error(`Parsed no usable rows from ${url} (max rows: ${best.length})`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to fetch medals");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = path.join(root, "medals.json");
  const { rows, sourceUrl } = await fetchRows();
  console.log(`Fetched ${rows.length} rows from ${sourceUrl}`);
  const data = {
    source: sourceUrl,
    fetched_at: new Date().toISOString(),
    row_count: rows.length,
    rows
  };

  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Updated medals.json with ${rows.length} countries`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
