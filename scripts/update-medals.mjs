#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://www.olympics.com/en/milano-cortina-2026/medals";
const FALLBACK_PROXY_URL = "https://r.jina.ai/http://www.olympics.com/en/milano-cortina-2026/medals";

const COUNTRY_TO_NOC = {
  "Australia": "AUS", "Austria": "AUT", "Belarus": "BLR", "Belgium": "BEL", "Bulgaria": "BUL",
  "Canada": "CAN", "China": "CHN", "Croatia": "CRO", "Czech Republic": "CZE", "Czechia": "CZE",
  "Denmark": "DEN", "Estonia": "EST", "Finland": "FIN", "France": "FRA", "Germany": "GER",
  "Great Britain": "GBR", "United Kingdom": "GBR", "Greece": "GRE", "Hungary": "HUN",
  "Ireland": "IRL", "Italy": "ITA", "Japan": "JPN", "Kazakhstan": "KAZ", "Latvia": "LAT",
  "Lithuania": "LTU", "Netherlands": "NED", "New Zealand": "NZL", "Norway": "NOR",
  "Poland": "POL", "Romania": "ROU", "Serbia": "SRB", "Slovakia": "SVK", "Slovenia": "SLO",
  "South Korea": "KOR", "Korea": "KOR", "Spain": "ESP", "Sweden": "SWE", "Switzerland": "SUI",
  "Ukraine": "UKR", "United States": "USA", "USA": "USA"
};

const NOC_TO_COUNTRY = {
  AUS: "Australia", AUT: "Austria", BEL: "Belgium", BLR: "Belarus", BUL: "Bulgaria", CAN: "Canada",
  CHN: "China", CRO: "Croatia", CZE: "Czechia", DEN: "Denmark", EST: "Estonia", FIN: "Finland",
  FRA: "France", GBR: "Great Britain", GER: "Germany", GRE: "Greece", HUN: "Hungary", IRL: "Ireland",
  ITA: "Italy", JPN: "Japan", KAZ: "Kazakhstan", KOR: "South Korea", LAT: "Latvia", LTU: "Lithuania",
  NED: "Netherlands", NOR: "Norway", NZL: "New Zealand", POL: "Poland", ROU: "Romania",
  SRB: "Serbia", SLO: "Slovenia", SVK: "Slovakia", ESP: "Spain", SWE: "Sweden", SUI: "Switzerland",
  UKR: "Ukraine", USA: "United States"
};

const NOC_TO_ISO2 = {
  AUS: "AU", AUT: "AT", BEL: "BE", BLR: "BY", BUL: "BG", CAN: "CA", CHN: "CN", CRO: "HR",
  CZE: "CZ", DEN: "DK", EST: "EE", FIN: "FI", FRA: "FR", GBR: "GB", GER: "DE", GRE: "GR",
  HUN: "HU", IRL: "IE", ITA: "IT", JPN: "JP", KAZ: "KZ", KOR: "KR", LAT: "LV", LTU: "LT",
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

async function fetchPage(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchRows() {
  const urls = [SOURCE_URL, FALLBACK_PROXY_URL];
  let lastError = null;

  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      const rows = parseRowsFromHtml(html);
      if (rows.length >= 5) return rows;
      lastError = new Error(`Parsed no usable rows from ${url}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to fetch medals");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = path.join(root, "medals.json");
  try {
    const rows = await fetchRows();
    const data = {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      row_count: rows.length,
      rows
    };

    await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Updated medals.json with ${rows.length} countries`);
  } catch (error) {
    // Keep the existing snapshot instead of failing the workflow run.
    try {
      const existingRaw = await fs.readFile(outPath, "utf8");
      const existing = JSON.parse(existingRaw);
      if (Array.isArray(existing.rows) && existing.rows.length > 0) {
        console.warn("Live fetch failed; keeping existing medals.json snapshot.");
        console.warn(`Reason: ${error?.message || error}`);
        return;
      }
    } catch {}

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
