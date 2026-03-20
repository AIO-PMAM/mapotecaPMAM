import { useEffect, useMemo, useRef, useState } from "react";
import { db, storage } from "../firebase";
import AppSidebar from "../components/AppSidebar";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  ArrowLeft,
  Save,
  MapPin,
  Users,
  FileText,
  Building2,
  Clock3,
  PlusCircle,
  X,
  Upload,
  BadgeCheck,
  ExternalLink,
  Trash2,
  RotateCcw,
} from "lucide-react";
import "../styles/home.css";
import "../styles/create-event.css";

const EDIT_STORAGE_KEY = "event_edit_payload";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const EDIT_PAYLOAD_MAX_AGE_MS = 2 * 60 * 1000;

const GOOGLE_MAPS_API_KEY = String(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ""
).trim();
const GOOGLE_DEMO_MAP_ID = "DEMO_MAP_ID";

const LOCATION_AUTOCOMPLETE_MIN_CHARS = 3;
const LOCATION_AUTOCOMPLETE_LIMIT = 6;

const ALLOWED_STATUS = ["PREVISTO", "CANCELADO"];
const ALLOWED_PLANNING_CATEGORIES = [
  "PLANO",
  "ORDEM",
  "NOTA",
  "OFICIO",
  "CRONOGRAMA",
  "DOCUMENTO",
];

const MANAUS_VIEWBOX = {
  left: -60.2,
  top: -2.9,
  right: -59.9,
  bottom: -3.25,
};

const FORM_CARD_TITLE_STYLE = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.2,
  margin: 0,
};

const FORM_CARD_SUBTITLE_STYLE = {
  fontSize: 13,
  lineHeight: 1.45,
  marginTop: 4,
};

function buildDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  return new Date(`${dateStr}T${timeStr}:00`);
}

function normalizeToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInputValue(d) {
  const date = normalizeToDate(d);
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

function parseDateInputValue(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toTimeInputValue(value) {
  const date = normalizeToDate(value);
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtDateTime(value) {
  const date = normalizeToDate(value);
  if (!date) return "-";
  return date.toLocaleString("pt-BR");
}

function getUnitCode(unit) {
  return String(unit?.code || unit?.sigla || "").trim().toUpperCase();
}

function getUnitLabel(unit) {
  return String(unit?.name || unit?.sigla || unit?.code || "UNIDADE").trim();
}

function sortUnits(a, b) {
  const aLabel = `${getUnitCode(a)} ${getUnitLabel(a)}`.trim();
  const bLabel = `${getUnitCode(b)} ${getUnitLabel(b)}`.trim();
  return aLabel.localeCompare(bLabel, "pt-BR");
}

function isAllowedPlanningFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  );
}

function sanitizeFileName(name) {
  return String(name || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function normalizePlanningCategory(value) {
  const raw = String(value || "").toUpperCase().trim();

  if (raw === "PLANEJAMENTO") return "PLANO";
  if (ALLOWED_PLANNING_CATEGORIES.includes(raw)) return raw;

  return "PLANO";
}

function getPlanningCategoryLabel(value) {
  const normalized = normalizePlanningCategory(value);

  switch (normalized) {
    case "PLANO":
      return "Plano";
    case "ORDEM":
      return "Ordem";
    case "NOTA":
      return "Nota";
    case "OFICIO":
      return "Ofício";
    case "CRONOGRAMA":
      return "Cronograma";
    case "DOCUMENTO":
      return "Documento";
    default:
      return "Documento";
  }
}

function getPlanningStorageFolder(scope = "AIO") {
  const normalized = String(scope || "AIO").toUpperCase();
  return normalized === "UNIT" ? "planejamento_unidade" : "planejamento";
}

function getDocumentTypeLabel(docItem) {
  const normalizedCategory = normalizePlanningCategory(docItem?.category);
  if (normalizedCategory) {
    return getPlanningCategoryLabel(normalizedCategory);
  }

  const name = String(docItem?.fileName || "").toLowerCase();

  if (name.includes("plano")) return "Plano";
  if (name.includes("ordem")) return "Ordem";
  if (name.includes("nota")) return "Nota";
  if (name.includes("cronograma")) return "Cronograma";
  if (name.includes("oficio") || name.includes("ofício")) return "Ofício";

  return "Documento";
}

function getDocumentExtension(fileName = "") {
  const lower = String(fileName).toLowerCase();

  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "WORD";

  return "DOC";
}

function normalizeSearchText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s,./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTokens(value = "") {
  return normalizeSearchText(value)
    .split(/[\s,./-]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStatusValue(value) {
  const raw = String(value || "").toUpperCase().trim();
  if (ALLOWED_STATUS.includes(raw)) return raw;
  return "PREVISTO";
}

function buildAddressSearchVariants(search) {
  const raw = String(search || "").trim();
  if (!raw) return [];

  const normalized = normalizeSearchText(raw);
  const hasManaus = normalized.includes("manaus");
  const hasAmazonas =
    normalized.includes("amazonas") || /\bam\b/.test(normalized);
  const hasBrasil = normalized.includes("brasil") || /\bbr\b/.test(normalized);

  const variants = [raw];

  if (!hasManaus) {
    variants.push(`${raw}, Manaus, Amazonas, Brasil`);
  } else if (!hasAmazonas || !hasBrasil) {
    variants.push(`${raw}, Amazonas, Brasil`);
  }

  return Array.from(new Set(variants));
}

function extractStateShort(address = {}) {
  const iso = String(address["ISO3166-2-lvl4"] || "").trim();
  const stateCode = String(address.state_code || "").trim();
  const state = String(address.state || "").trim();

  if (iso.includes("-")) {
    const code = iso.split("-").pop();
    if (code) return code.toUpperCase();
  }

  if (stateCode) return stateCode.toUpperCase();

  const map = {
    acre: "AC",
    alagoas: "AL",
    amapa: "AP",
    amazonas: "AM",
    bahia: "BA",
    ceara: "CE",
    "distrito federal": "DF",
    "espirito santo": "ES",
    goias: "GO",
    maranhao: "MA",
    "mato grosso": "MT",
    "mato grosso do sul": "MS",
    minas: "MG",
    "minas gerais": "MG",
    para: "PA",
    paraiba: "PB",
    parana: "PR",
    pernambuco: "PE",
    piaui: "PI",
    "rio de janeiro": "RJ",
    "rio grande do norte": "RN",
    "rio grande do sul": "RS",
    rondonia: "RO",
    roraima: "RR",
    "santa catarina": "SC",
    "sao paulo": "SP",
    sergipe: "SE",
    tocantins: "TO",
  };

  const normalizedState = normalizeSearchText(state);
  return map[normalizedState] || state;
}

function getSuggestionRoad(address = {}, item = {}) {
  return (
    address.road ||
    address.pedestrian ||
    address.residential ||
    address.cycleway ||
    address.footway ||
    address.path ||
    address.highway ||
    String(item.display_name || "").split(",")[0]?.trim() ||
    "Endereço"
  );
}

function extractTypedHouseNumber(search = "") {
  const raw = String(search || "").trim();

  const match = raw.match(
    /(?:\b(?:n|nº|no|numero|número)\s*)?(\d+[a-zA-Z]?)(?:\s*[-/]\s*\w+)?/i
  );

  return match?.[1] || null;
}

function formatLocationSuggestionLabel(item, typedSearch = "") {
  const address = item?.address || {};

  const road = getSuggestionRoad(address, item);

  const typedHouseNumber = extractTypedHouseNumber(typedSearch);
  const apiHouseNumber = address.house_number || null;
  const number = apiHouseNumber || typedHouseNumber || null;

  const district =
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.quarter ||
    null;

  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    null;

  const state = extractStateShort(address);
  const country = address.country || "Brasil";

  const cityState = city && state ? `${city} ${state}` : city || state || null;

  return [road, number, district, cityState, country]
    .filter(Boolean)
    .join(", ");
}

function normalizeLocationMeta(item, searchLabel = "") {
  if (!item) return null;

  const address = item.address || {};
  const lat =
    item.lat !== undefined && item.lat !== null ? Number(item.lat) : null;
  const lng =
    item.lon !== undefined && item.lon !== null ? Number(item.lon) : null;

  return {
    placeId: item.place_id ? String(item.place_id) : null,
    displayName: item.display_name || "",
    compactLabel: formatLocationSuggestionLabel(item, searchLabel),
    searchLabel: searchLabel || "",
    lat,
    lng,
    city:
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      null,
    state: address.state || null,
    country: address.country || null,
    district:
      address.suburb || address.neighbourhood || address.city_district || null,
    road: address.road || null,
    houseNumber:
      address.house_number || extractTypedHouseNumber(searchLabel) || null,
    postcode: address.postcode || null,
    rawAddress: address,
    provider: "nominatim",
  };
}

function scoreAddressMatch(search, item) {
  const queryNorm = normalizeSearchText(search);
  const displayNorm = normalizeSearchText(item?.display_name || "");
  const formattedNorm = normalizeSearchText(
    formatLocationSuggestionLabel(item, search)
  );
  const address = item?.address || {};
  const addressNorm = normalizeSearchText(
    [
      address.road,
      address.house_number,
      address.suburb,
      address.neighbourhood,
      address.city_district,
      address.city,
      address.town,
      address.village,
      address.state,
      address.postcode,
      address.country,
    ]
      .filter(Boolean)
      .join(" ")
  );

  const tokens = getSearchTokens(search);

  let score = 0;

  if (!queryNorm) return score;

  if (displayNorm === queryNorm) score += 180;
  if (formattedNorm === queryNorm) score += 210;
  if (addressNorm === queryNorm) score += 220;

  if (formattedNorm.startsWith(queryNorm)) score += 120;
  if (displayNorm.startsWith(queryNorm)) score += 80;
  if (addressNorm.startsWith(queryNorm)) score += 120;

  if (formattedNorm.includes(queryNorm)) score += 90;
  if (displayNorm.includes(queryNorm)) score += 40;
  if (addressNorm.includes(queryNorm)) score += 70;

  for (const token of tokens) {
    if (formattedNorm.includes(token)) score += 18;
    if (displayNorm.includes(token)) score += 10;
    else score -= 2;

    if (addressNorm.includes(token)) score += 14;
  }

  const typedHouseNumber = extractTypedHouseNumber(search);
  const candidateHouseNumber = String(address.house_number || "").trim();

  if (typedHouseNumber) {
    if (
      formattedNorm.includes(typedHouseNumber.toLowerCase()) ||
      displayNorm.includes(typedHouseNumber.toLowerCase()) ||
      addressNorm.includes(typedHouseNumber.toLowerCase())
    ) {
      score += 40;
    }

    if (candidateHouseNumber && candidateHouseNumber === typedHouseNumber) {
      score += 50;
    } else if (
      candidateHouseNumber &&
      candidateHouseNumber !== typedHouseNumber
    ) {
      score -= 20;
    }
  }

  const postcodeMatch = queryNorm.match(/\b\d{5}-?\d{3}\b/);
  if (postcodeMatch) {
    const postcode = postcodeMatch[0].replace("-", "");
    const candidatePostcode = String(address.postcode || "").replace("-", "");
    if (candidatePostcode && candidatePostcode.includes(postcode)) {
      score += 28;
    }
  }

  const cityNorm = normalizeSearchText(
    address.city || address.town || address.village || address.municipality || ""
  );
  const stateNorm = normalizeSearchText(address.state || "");

  if (cityNorm === "manaus") score += 16;
  if (stateNorm === "amazonas") score += 8;

  const importance = Number(item?.importance || 0);
  if (!Number.isNaN(importance)) {
    score += importance * 10;
  }

  const placeRank = Number(item?.place_rank || 0);
  if (!Number.isNaN(placeRank) && placeRank >= 20 && placeRank <= 30) {
    score += 8;
  }

  return score;
}

async function fetchAddressSuggestions(
  search,
  signal,
  limit = LOCATION_AUTOCOMPLETE_LIMIT
) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("accept-language", "pt-BR");
  url.searchParams.set(
    "limit",
    String(Math.max(limit, LOCATION_AUTOCOMPLETE_LIMIT))
  );
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("q", search);
  url.searchParams.set(
    "viewbox",
    `${MANAUS_VIEWBOX.left},${MANAUS_VIEWBOX.top},${MANAUS_VIEWBOX.right},${MANAUS_VIEWBOX.bottom}`
  );
  url.searchParams.set("bounded", "0");

  const response = await fetch(url.toString(), {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Falha ao buscar endereços.");
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function searchAddressSuggestionsRanked(
  search,
  signal,
  limit = LOCATION_AUTOCOMPLETE_LIMIT
) {
  const variants = buildAddressSearchVariants(search);
  if (variants.length === 0) return [];

  const responses = await Promise.all(
    variants.map((variant) =>
      fetchAddressSuggestions(variant, signal, Math.max(limit, 8))
    )
  );

  const mergedMap = new Map();

  for (const list of responses) {
    for (const item of list) {
      const key =
        item.place_id ||
        `${item.display_name || ""}_${item.lat || ""}_${item.lon || ""}`;

      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    }
  }

  const merged = Array.from(mergedMap.values());

  return merged
    .map((item) => ({
      ...item,
      __score: scoreAddressMatch(search, item),
    }))
    .sort((a, b) => b.__score - a.__score)
    .slice(0, limit);
}

function DocumentFileIcon({ fileName }) {
  const extension = getDocumentExtension(fileName);
  const isPdf = extension === "PDF";

  const accent = isPdf ? "#dc2626" : "#2563eb";
  const border = isPdf
    ? "rgba(220, 38, 38, 0.18)"
    : "rgba(37, 99, 235, 0.18)";
  const background = isPdf
    ? "rgba(220, 38, 38, 0.08)"
    : "rgba(37, 99, 235, 0.08)";

  return (
    <div
      aria-label={`Arquivo ${extension}`}
      title={extension}
      style={{
        width: 46,
        minWidth: 46,
        height: 54,
        borderRadius: 14,
        border: `1px solid ${border}`,
        background,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="26"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 3.75h7.9L19.25 8.1V19a2.25 2.25 0 0 1-2.25 2.25H7A2.25 2.25 0 0 1 4.75 19V6A2.25 2.25 0 0 1 7 3.75Z"
          fill="#fff"
          stroke={accent}
          strokeWidth="1.4"
        />
        <path
          d="M14.75 3.75V7.5a1 1 0 0 0 1 1h3.5"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 12.2h8M8 15h5.5"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>

      <span
        style={{
          position: "absolute",
          bottom: 4,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: extension === "WORD" ? 8 : 9,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: "#fff",
          background: accent,
          padding: "2px 6px",
          borderRadius: 999,
          lineHeight: 1,
          boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
        }}
      >
        {extension}
      </span>
    </div>
  );
}

function consumeEditPayload() {
  try {
    const raw = sessionStorage.getItem(EDIT_STORAGE_KEY);
    sessionStorage.removeItem(EDIT_STORAGE_KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.mode !== "edit" || !parsed.eventId) return null;

    const openedAt = parsed?.openedAt ? new Date(parsed.openedAt) : null;
    if (!openedAt || Number.isNaN(openedAt.getTime())) return null;

    const age = Date.now() - openedAt.getTime();
    if (age < 0 || age > EDIT_PAYLOAD_MAX_AGE_MS) return null;

    return parsed;
  } catch (error) {
    console.error("Erro ao consumir payload de edição:", error);
    try {
      sessionStorage.removeItem(EDIT_STORAGE_KEY);
    } catch (_) {}
    return null;
  }
}

function clearEditPayload() {
  try {
    sessionStorage.removeItem(EDIT_STORAGE_KEY);
  } catch (error) {
    console.error("Erro ao limpar payload de edição:", error);
  }
}

function uniqueIds(list = []) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!raw) return false;

  return ["1", "true", "sim", "yes", "y", "enabled", "ativo"].includes(raw);
}

function getValueByPath(obj, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => acc?.[key], obj);
}

function resolveFlagFromSources(sources = [], paths = []) {
  for (const source of sources) {
    if (!source) continue;

    for (const path of paths) {
      const value = getValueByPath(source, path);

      if (value === undefined || value === null || value === "") continue;
      return isTruthyFlag(value);
    }
  }

  return null;
}

function resolveUnitEventPermissions({ claims, user, loginUnit, editingEvent }) {
  const sources = [
    claims,
    claims?.permissions,
    claims?.accessProfile,
    claims?.accessProfile?.permissions,
    user,
    user?.permissions,
    user?.accessProfile,
    user?.accessProfile?.permissions,
    loginUnit,
    loginUnit?.permissions,
    editingEvent,
    editingEvent?.permissions,
  ];

  return {
    explicitCanCreateOwnEvents: resolveFlagFromSources(sources, [
      "canCreateOwnEvents",
      "permissions.canCreateOwnEvents",
      "canCreateUnitEvents",
      "permissions.canCreateUnitEvents",
      "canCreateEvents",
      "permissions.canCreateEvents",
      "allowOwnEventCreation",
      "permissions.allowOwnEventCreation",
      "eventCreationEnabled",
      "permissions.eventCreationEnabled",
    ]),
    explicitCanAttachUnitPlanning: resolveFlagFromSources(sources, [
      "canAttachUnitPlanning",
      "permissions.canAttachUnitPlanning",
      "canManageUnitPlanning",
      "permissions.canManageUnitPlanning",
      "allowUnitPlanningUpload",
      "permissions.allowUnitPlanningUpload",
      "canUploadPlanning",
      "permissions.canUploadPlanning",
    ]),
  };
}

function isAioRole(role) {
  const raw = String(role || "").trim().toUpperCase();
  return raw === "AIO" || raw.startsWith("AIO_");
}

function getOriginTypeLabel(value) {
  switch (String(value || "").toUpperCase()) {
    case "AIO":
      return "AIO";
    case "UNIDADE_GESTORA":
      return "Unidade Gestora";
    case "UNIDADE_SUBORDINADA":
      return "Unidade Subordinada";
    default:
      return "Origem";
  }
}

function resolveLoginUnit({ claims, user, unitMap, units }) {
  const possibleUnitIds = [
    claims?.unitId,
    claims?.userUnitId,
    claims?.currentUnitId,
    claims?.createdByUnitId,
    claims?.accessUnitId,
    claims?.unit?.id,
    claims?.unit?.unitId,
    claims?.currentUnit?.id,
    claims?.currentUnit?.unitId,
    claims?.profile?.unitId,
    claims?.accessProfile?.unitId,
    user?.unitId,
    user?.userUnitId,
    user?.currentUnitId,
    user?.createdByUnitId,
    user?.unit?.id,
    user?.unit?.unitId,
    user?.currentUnit?.id,
    user?.currentUnit?.unitId,
    user?.profile?.unitId,
    user?.accessProfile?.unitId,
  ].filter(Boolean);

  for (const unitId of possibleUnitIds) {
    if (unitMap[unitId]) return unitMap[unitId];
  }

  const possibleUnitCodes = [
    claims?.unitCode,
    claims?.userUnitCode,
    claims?.currentUnitCode,
    claims?.createdByUnitCode,
    claims?.unit?.code,
    claims?.unit?.sigla,
    claims?.currentUnit?.code,
    claims?.currentUnit?.sigla,
    claims?.profile?.unitCode,
    claims?.accessProfile?.unitCode,
    user?.unitCode,
    user?.userUnitCode,
    user?.currentUnitCode,
    user?.createdByUnitCode,
    user?.unit?.code,
    user?.unit?.sigla,
    user?.currentUnit?.code,
    user?.currentUnit?.sigla,
    user?.profile?.unitCode,
    user?.accessProfile?.unitCode,
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);

  for (const unitCode of possibleUnitCodes) {
    const foundByCode = (units || []).find(
      (unit) => getUnitCode(unit) === unitCode
    );
    if (foundByCode) return foundByCode;
  }

  const possibleUnitNames = [
    claims?.unitName,
    claims?.userUnitName,
    claims?.currentUnitName,
    claims?.createdByUnitName,
    claims?.unit?.name,
    claims?.currentUnit?.name,
    claims?.profile?.unitName,
    claims?.accessProfile?.unitName,
    user?.unitName,
    user?.userUnitName,
    user?.currentUnitName,
    user?.createdByUnitName,
    user?.unit?.name,
    user?.currentUnit?.name,
    user?.profile?.unitName,
    user?.accessProfile?.unitName,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const unitName of possibleUnitNames) {
    const foundByName = (units || []).find(
      (unit) => getUnitLabel(unit).toUpperCase() === unitName.toUpperCase()
    );
    if (foundByName) return foundByName;
  }

  return null;
}

function createPlanningFileItem(file, category = "PLANO") {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    file,
    category: normalizePlanningCategory(category),
  };
}

function loadGoogleMapsApi(apiKey) {
  if (!apiKey) {
    return Promise.reject(
      new Error("Defina VITE_GOOGLE_MAPS_API_KEY no arquivo .env.")
    );
  }

  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google.maps);
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-js");

    if (existing) {
      existing.addEventListener(
        "load",
        () => resolve(window.google.maps),
        { once: true }
      );
      existing.addEventListener(
        "error",
        () => reject(new Error("Falha ao carregar Google Maps.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-js";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps não ficou disponível após o carregamento."));
      }
    };

    script.onerror = () => {
      reject(new Error("Não foi possível carregar o Google Maps."));
    };

    document.head.appendChild(script);
  });
}

function MiniGoogleMapPreview({ lat, lng, title, subtitle }) {
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);
  const infoWindowRef = useRef(null);
  const mapRef = useRef(null);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function initMap() {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      try {
        setMapError("");

        await loadGoogleMapsApi(GOOGLE_MAPS_API_KEY);

        const [{ Map, InfoWindow }, { AdvancedMarkerElement }] =
          await Promise.all([
            google.maps.importLibrary("maps"),
            google.maps.importLibrary("marker"),
          ]);

        if (!mounted || !mapContainerRef.current) return;

        const position = { lat, lng };

        const map = new Map(mapContainerRef.current, {
          center: position,
          zoom: 16,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
          mapId: GOOGLE_DEMO_MAP_ID,
        });

        mapRef.current = map;
        infoWindowRef.current = new InfoWindow();

        const marker = new AdvancedMarkerElement({
          map,
          position,
          title: title || "Local do evento",
        });

        markerRef.current = marker;

        const content = `
          <div style="min-width:220px; max-width:280px; font-family:Arial,sans-serif;">
            <div style="font-size:14px; font-weight:800; color:#111827; margin-bottom:8px;">
              ${title || "Local do evento"}
            </div>
            ${
              subtitle
                ? `<div style="font-size:12px; color:#4b5563; line-height:1.45;">${subtitle}</div>`
                : ""
            }
            <div style="font-size:12px; color:#6b7280; margin-top:8px;">
              Latitude: ${lat} • Longitude: ${lng}
            </div>
          </div>
        `;

        marker.addListener("gmp-click", () => {
          if (!infoWindowRef.current) return;

          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open({
            map,
            anchor: marker,
            shouldFocus: false,
          });
        });
      } catch (error) {
        console.error("Erro ao iniciar Google Maps:", error);
        if (mounted) {
          setMapError(
            "Não foi possível carregar o Google Maps. Verifique a chave da API."
          );
        }
      }
    }

    initMap();

    return () => {
      mounted = false;

      if (markerRef.current) {
        try {
          markerRef.current.map = null;
        } catch (_) {}
        markerRef.current = null;
      }

      infoWindowRef.current = null;
      mapRef.current = null;
    };
  }, [lat, lng, title, subtitle]);

  return (
    <div>
      {mapError && (
        <div
          style={{
            padding: "12px",
            borderBottom: "1px solid #e5e7eb",
            background: "#fff7ed",
            color: "#9a3412",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {mapError}
        </div>
      )}

      {!GOOGLE_MAPS_API_KEY && (
        <div
          style={{
            padding: "12px",
            borderBottom: "1px solid #e5e7eb",
            background: "#eff6ff",
            color: "#1d4ed8",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Defina VITE_GOOGLE_MAPS_API_KEY no arquivo .env para ativar o mapa.
        </div>
      )}

      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: 220,
          background: "#f3f4f6",
        }}
      />
    </div>
  );
}

export default function CreateEvent({
  user,
  claims,
  onBack,
  onCreated,
  onGoHome,
  onGoCreateEvent,
  onGoUnits,
  onGoAccess,
}) {
  const [editPayload, setEditPayload] = useState(() => consumeEditPayload());

  const isEditMode = !!editPayload?.eventId;
  const editingEventId = editPayload?.eventId || null;
  const editingEvent = editPayload?.event || null;

  const [titulo, setTitulo] = useState("");
  const [local, setLocal] = useState("");
  const [descricao, setDescricao] = useState("");
  const [publicoEstimado, setPublicoEstimado] = useState("");
  const [tipoOperacao, setTipoOperacao] = useState("INTEGRADO");
  const [status, setStatus] = useState("PREVISTO");

  const [responsibleUnitIds, setResponsibleUnitIds] = useState([]);
  const [responsibleUnitToAddId, setResponsibleUnitToAddId] = useState("");

  const [participantUnitIds, setParticipantUnitIds] = useState([]);
  const [unitToAddId, setUnitToAddId] = useState("");

  const [dataInicio, setDataInicio] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [horaFim, setHoraFim] = useState("");

  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locationMeta, setLocationMeta] = useState(null);
  const [resolvedLocationQuery, setResolvedLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSuggestionsOpen, setLocationSuggestionsOpen] = useState(false);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] =
    useState(false);
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const locationAutocompleteRef = useRef(null);

  const [planningCategory, setPlanningCategory] = useState("PLANO");
  const [planningFiles, setPlanningFiles] = useState([]);
  const [existingPlanningDocs, setExistingPlanningDocs] = useState([]);
  const [removedExistingDocIds, setRemovedExistingDocIds] = useState([]);
  const [replacedExistingDocs, setReplacedExistingDocs] = useState({});
  const [loadingExistingDocs, setLoadingExistingDocs] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const [units, setUnits] = useState([]);

  function resetForm() {
    setTitulo("");
    setLocal("");
    setDescricao("");
    setPublicoEstimado("");
    setTipoOperacao("INTEGRADO");
    setStatus("PREVISTO");
    setResponsibleUnitIds([]);
    setResponsibleUnitToAddId("");
    setParticipantUnitIds([]);
    setUnitToAddId("");
    setDataInicio("");
    setHoraInicio("");
    setDataFim("");
    setHoraFim("");
    setLat("");
    setLng("");
    setLocationMeta(null);
    setResolvedLocationQuery("");
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
    setLoadingLocationSuggestions(false);
    setResolvingLocation(false);
    setPlanningCategory("PLANO");
    setPlanningFiles([]);
    setExistingPlanningDocs([]);
    setRemovedExistingDocIds([]);
    setReplacedExistingDocs({});
    setErro("");
    setSucesso("");
  }

  useEffect(() => {
    async function loadUnits() {
      setLoadingUnits(true);

      try {
        const q = query(collection(db, "units"), orderBy("name", "asc"));
        const snap = await getDocs(q);

        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        rows.sort(sortUnits);
        setUnits(rows);
      } catch (error) {
        console.error(error);
        setErro("Não foi possível carregar as unidades cadastradas.");
      } finally {
        setLoadingUnits(false);
      }
    }

    loadUnits();
  }, []);

  useEffect(() => {
    if (!isEditMode || !editingEvent) {
      resetForm();
      return;
    }

    setTitulo(editingEvent.title || editingEvent.name || "");
    setLocal(editingEvent.location || "");
    setDescricao(editingEvent.description || "");
    setPublicoEstimado(
      editingEvent.estimatedPublic !== undefined &&
        editingEvent.estimatedPublic !== null
        ? String(editingEvent.estimatedPublic)
        : ""
    );
    setTipoOperacao(
      editingEvent.operationType || editingEvent.type || "INTEGRADO"
    );
    setStatus(normalizeStatusValue(editingEvent.status));
    setPlanningCategory(
      normalizePlanningCategory(editingEvent.planningCategory || "PLANO")
    );

    const responsibleIds = uniqueIds(
      editingEvent.responsibleUnitIds ||
        (editingEvent.responsibleUnits || []).map((u) => u?.unitId)
    );

    const involvedIds = uniqueIds(
      editingEvent.participantUnitIds ||
        (editingEvent.involvedUnits || []).map((u) => u?.unitId)
    );

    const filteredParticipants = involvedIds.filter(
      (id) => !responsibleIds.includes(id)
    );

    setResponsibleUnitIds(responsibleIds);
    setParticipantUnitIds(filteredParticipants);

    setDataInicio(toDateInputValue(editingEvent.startAt));
    setHoraInicio(toTimeInputValue(editingEvent.startAt));
    setDataFim(toDateInputValue(editingEvent.endAt));
    setHoraFim(toTimeInputValue(editingEvent.endAt));

    const loadedLat =
      editingEvent.lat !== undefined && editingEvent.lat !== null
        ? String(editingEvent.lat)
        : "";

    const loadedLng =
      editingEvent.lng !== undefined && editingEvent.lng !== null
        ? String(editingEvent.lng)
        : "";

    setLat(loadedLat);
    setLng(loadedLng);

    if (editingEvent.locationMeta) {
      setLocationMeta(editingEvent.locationMeta);
      setResolvedLocationQuery(
        editingEvent.locationMeta?.searchLabel || editingEvent.location || ""
      );
    } else if (editingEvent.location || loadedLat || loadedLng) {
      setLocationMeta({
        placeId: null,
        displayName:
          editingEvent.locationResolvedLabel || editingEvent.location || "",
        compactLabel:
          editingEvent.locationResolvedLabel || editingEvent.location || "",
        searchLabel: editingEvent.location || "",
        lat: loadedLat ? Number(loadedLat) : null,
        lng: loadedLng ? Number(loadedLng) : null,
        city: null,
        state: null,
        country: "Brasil",
        district: null,
        road: null,
        houseNumber: null,
        postcode: null,
        rawAddress: {},
        provider: "manual",
      });
      setResolvedLocationQuery(editingEvent.location || "");
    } else {
      setLocationMeta(null);
      setResolvedLocationQuery("");
    }

    setErro("");
    setSucesso("");
    setPlanningFiles([]);
    setRemovedExistingDocIds([]);
    setReplacedExistingDocs({});
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
  }, [isEditMode, editingEvent]);

  const visibleExistingPlanningDocs = useMemo(() => {
    return existingPlanningDocs.filter(
      (docItem) => !removedExistingDocIds.includes(docItem.id)
    );
  }, [existingPlanningDocs, removedExistingDocIds]);

  const removedExistingPlanningDocs = useMemo(() => {
    return existingPlanningDocs.filter((docItem) =>
      removedExistingDocIds.includes(docItem.id)
    );
  }, [existingPlanningDocs, removedExistingDocIds]);

  const unitMap = useMemo(() => {
    const map = {};
    for (const unit of units) {
      map[unit.id] = unit;
    }
    return map;
  }, [units]);

  const validUnitIds = useMemo(() => new Set(units.map((u) => u.id)), [units]);

  function getUnitPath(unitId) {
    const parts = [];
    const visited = new Set();
    let current = unitMap[unitId] || null;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      parts.unshift(getUnitCode(current) || getUnitLabel(current));

      if (!current.parentUnitId) break;
      current = unitMap[current.parentUnitId] || null;
    }

    return parts.join(" > ");
  }

  function getRootUnit(unitId) {
    const visited = new Set();
    let current = unitMap[unitId] || null;
    let last = current;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      last = current;

      if (!current.parentUnitId) break;
      current = unitMap[current.parentUnitId] || null;
    }

    return last || null;
  }

  function getAncestorUnitIds(startUnitId) {
    const result = [];
    const visited = new Set();

    let current = unitMap[startUnitId] || null;

    while (
      current &&
      current.parentUnitId &&
      !visited.has(current.parentUnitId)
    ) {
      visited.add(current.parentUnitId);

      const parent = unitMap[current.parentUnitId] || null;
      if (!parent) break;

      result.push(parent.id);
      current = parent;
    }

    return result;
  }

  const rootUnits = useMemo(() => {
    return units
      .filter((u) => !u.parentUnitId || !validUnitIds.has(u.parentUnitId))
      .sort(sortUnits);
  }, [units, validUnitIds]);

  const childrenMap = useMemo(() => {
    const map = {};

    for (const unit of units) {
      const parentKey = unit.parentUnitId || "__root__";
      if (!map[parentKey]) map[parentKey] = [];
      map[parentKey].push(unit);
    }

    Object.keys(map).forEach((key) => {
      map[key].sort(sortUnits);
    });

    return map;
  }, [units]);

  const unitOptions = useMemo(() => {
    const result = [];

    function walk(unit, level = 0) {
      const prefix = level > 0 ? `${"— ".repeat(level)}` : "";
      const unitCode = getUnitCode(unit);
      const labelBase = unitCode
        ? `${unitCode} - ${getUnitLabel(unit)}`.trim()
        : getUnitLabel(unit);

      result.push({
        id: unit.id,
        label: `${prefix}${labelBase}`,
      });

      const children = childrenMap[unit.id] || [];
      children.forEach((child) => walk(child, level + 1));
    }

    rootUnits.forEach((root) => walk(root, 0));
    return result;
  }, [rootUnits, childrenMap]);

  const availableResponsibleOptions = useMemo(() => {
    return unitOptions.filter(
      (opt) =>
        !responsibleUnitIds.includes(opt.id) &&
        !participantUnitIds.includes(opt.id)
    );
  }, [unitOptions, responsibleUnitIds, participantUnitIds]);

  const availableParticipantOptions = useMemo(() => {
    return unitOptions.filter(
      (opt) =>
        !participantUnitIds.includes(opt.id) &&
        !responsibleUnitIds.includes(opt.id)
    );
  }, [unitOptions, participantUnitIds, responsibleUnitIds]);

  const selectedResponsibleUnits = useMemo(() => {
    return responsibleUnitIds.map((id) => unitMap[id]).filter(Boolean);
  }, [responsibleUnitIds, unitMap]);

  const selectedParticipantUnits = useMemo(() => {
    return participantUnitIds.map((id) => unitMap[id]).filter(Boolean);
  }, [participantUnitIds, unitMap]);

  const loginUnit = useMemo(() => {
    return resolveLoginUnit({ claims, user, unitMap, units });
  }, [claims, user, unitMap, units]);

  const savedOrigin = useMemo(() => {
    if (!editingEvent) return null;

    const savedUnitId = editingEvent.createdByUnitId || null;
    const savedPath =
      editingEvent.unitPath ||
      (savedUnitId ? getUnitPath(savedUnitId) : null) ||
      (String(editingEvent.originType || "").toUpperCase() === "AIO"
        ? "AIO"
        : null);

    return {
      type: editingEvent.originType || "AIO",
      id: editingEvent.createdByUnitId || null,
      code: editingEvent.createdByUnitCode || "",
      name:
        editingEvent.createdByUnitName ||
        (String(editingEvent.originType || "").toUpperCase() === "AIO"
          ? "Assessoria de Integração Operacional"
          : "Unidade geradora não identificada"),
      path: savedPath,
    };
  }, [editingEvent]);

  const automaticOrigin = useMemo(() => {
    if (isEditMode && savedOrigin) {
      return savedOrigin;
    }

    if (!loginUnit) {
      if (isAioRole(claims?.role)) {
        return {
          type: "AIO",
          id: null,
          code: "AIO",
          name: "Assessoria de Integração Operacional",
          path: "AIO",
        };
      }

      return {
        type: "UNIDADE_SUBORDINADA",
        id: null,
        code: "",
        name: "Unidade do login não identificada",
        path: null,
      };
    }

    const loginUnitCode = getUnitCode(loginUnit);
    const loginUnitName = getUnitLabel(loginUnit);

    const isAioUnit =
      loginUnitCode === "AIO" ||
      loginUnitName
        .toUpperCase()
        .includes("ASSESSORIA DE INTEGRAÇÃO OPERACIONAL") ||
      isAioRole(claims?.role);

    if (isAioUnit) {
      return {
        type: "AIO",
        id: loginUnit.id || null,
        code: loginUnitCode || "AIO",
        name: loginUnitName || "Assessoria de Integração Operacional",
        path: loginUnit.id ? getUnitPath(loginUnit.id) : "AIO",
      };
    }

    const hasValidParent =
      !!loginUnit.parentUnitId && !!unitMap[loginUnit.parentUnitId];

    const isManagerUnit = !!loginUnit.isManager;

    const originType =
      !hasValidParent || isManagerUnit
        ? "UNIDADE_GESTORA"
        : "UNIDADE_SUBORDINADA";

    return {
      type: originType,
      id: loginUnit.id || null,
      code: loginUnitCode,
      name: loginUnitName,
      path: loginUnit.id ? getUnitPath(loginUnit.id) : null,
    };
  }, [isEditMode, savedOrigin, claims?.role, loginUnit, unitMap]);

  const origem = automaticOrigin.type;

  const currentUserIsAio = useMemo(() => {
    if (isAioRole(claims?.role)) return true;
    if (!loginUnit) return false;

    const code = getUnitCode(loginUnit);
    const label = getUnitLabel(loginUnit).toUpperCase();

    return (
      code === "AIO" ||
      label.includes("ASSESSORIA DE INTEGRAÇÃO OPERACIONAL")
    );
  }, [claims?.role, loginUnit]);

  const unitEventPermissions = useMemo(() => {
    return resolveUnitEventPermissions({
      claims,
      user,
      loginUnit,
      editingEvent,
    });
  }, [claims, user, loginUnit, editingEvent]);

  const canCreateOwnEvents =
    unitEventPermissions.explicitCanCreateOwnEvents !== null
      ? unitEventPermissions.explicitCanCreateOwnEvents
      : origem !== "AIO";

  const canAttachUnitPlanning =
    unitEventPermissions.explicitCanAttachUnitPlanning !== null
      ? unitEventPermissions.explicitCanAttachUnitPlanning
      : canCreateOwnEvents;

  const planningOwnerScope = origem === "AIO" ? "AIO" : "UNIT";

  const canManagePlanningDocuments =
    planningOwnerScope === "AIO"
      ? currentUserIsAio
      : canCreateOwnEvents && canAttachUnitPlanning;

  const isPlanningRequired = planningOwnerScope === "AIO";

  const planningDocsFilterConfig = useMemo(() => {
    const eventOriginType = String(
      editingEvent?.originType || automaticOrigin.type || ""
    ).toUpperCase();

    if (eventOriginType === "AIO") {
      return {
        scope: "AIO",
        unitId: null,
      };
    }

    return {
      scope: "UNIT",
      unitId: editingEvent?.createdByUnitId || automaticOrigin.id || null,
    };
  }, [editingEvent, automaticOrigin]);

  const planningOwnerLabel =
    planningOwnerScope === "AIO"
      ? "Assessoria de Integração Operacional (AIO)"
      : automaticOrigin.code
      ? `${automaticOrigin.code} — ${automaticOrigin.name}`
      : automaticOrigin.name || "Unidade geradora";

  const planningSectionTitle =
    planningOwnerScope === "AIO"
      ? isEditMode
        ? "Documentos do planejamento principal"
        : "Planejamento principal"
      : "Planejamento da unidade";

  const planningSectionSubtitle =
    planningOwnerScope === "AIO"
      ? isEditMode
        ? "Os documentos já anexados aparecem abaixo. Você pode remover, substituir ou adicionar novos arquivos."
        : "Anexe um ou mais arquivos principais do evento."
      : isEditMode
      ? "Os documentos abaixo pertencem ao planejamento da unidade geradora. Você pode remover, substituir ou adicionar novos arquivos."
      : "Anexe o planejamento da unidade que está gerando este evento próprio.";

  useEffect(() => {
    if (canManagePlanningDocuments) return;

    setPlanningFiles([]);
    setPlanningCategory("PLANO");
    setRemovedExistingDocIds([]);
    setReplacedExistingDocs({});
  }, [canManagePlanningDocuments]);

  useEffect(() => {
    async function loadExistingDocs() {
      if (!isEditMode || !editingEventId) {
        setExistingPlanningDocs([]);
        return;
      }

      setLoadingExistingDocs(true);

      try {
        const docsRef = collection(db, "events", editingEventId, "documents");
        const snap = await getDocs(docsRef);

        const rows = snap.docs
          .map((d) => ({
            id: d.id,
            ...d.data(),
          }))
          .filter((docItem) => {
            if (docItem.isDeleted) return false;

            const documentGroup = String(
              docItem.documentGroup || ""
            ).toUpperCase();

            if (documentGroup && documentGroup !== "PLANNING") {
              return false;
            }

            if (planningDocsFilterConfig.scope === "AIO") {
              const scope = String(
                docItem.documentScope ||
                  docItem.origin ||
                  docItem.originType ||
                  ""
              ).toUpperCase();

              return scope === "AIO";
            }

            const scope = String(docItem.documentScope || "").toUpperCase();
            const origin = String(
              docItem.origin || docItem.originType || ""
            ).toUpperCase();

            const sameUnit =
              !planningDocsFilterConfig.unitId ||
              docItem.originUnitId === planningDocsFilterConfig.unitId ||
              docItem.unitId === planningDocsFilterConfig.unitId ||
              docItem.createdByUnitId === planningDocsFilterConfig.unitId;

            if (scope === "UNIT") return sameUnit;

            return origin !== "AIO" && sameUnit;
          })
          .sort((a, b) => {
            const da = normalizeToDate(a.uploadedAt);
            const db = normalizeToDate(b.uploadedAt);
            return (db?.getTime() || 0) - (da?.getTime() || 0);
          });

        setExistingPlanningDocs(rows);
      } catch (error) {
        console.error("Erro ao carregar documentos existentes:", error);
        setExistingPlanningDocs([]);
      } finally {
        setLoadingExistingDocs(false);
      }
    }

    loadExistingDocs();
  }, [isEditMode, editingEventId, planningDocsFilterConfig]);

  useEffect(() => {
    const typedValue = local.trim();
    const normalizedTypedValue = normalizeSearchText(typedValue);
    const normalizedResolvedQuery = normalizeSearchText(resolvedLocationQuery);

    if (
      !typedValue ||
      typedValue.length < LOCATION_AUTOCOMPLETE_MIN_CHARS ||
      (normalizedResolvedQuery &&
        normalizedTypedValue === normalizedResolvedQuery)
    ) {
      setLocationSuggestions([]);
      setLocationSuggestionsOpen(false);
      setLoadingLocationSuggestions(false);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        setLoadingLocationSuggestions(true);
        const results = await searchAddressSuggestionsRanked(
          typedValue,
          controller.signal,
          LOCATION_AUTOCOMPLETE_LIMIT
        );
        setLocationSuggestions(results);
        setLocationSuggestionsOpen(results.length > 0);
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Erro ao buscar sugestões de endereço:", error);
          setLocationSuggestions([]);
          setLocationSuggestionsOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingLocationSuggestions(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [local, resolvedLocationQuery]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        locationAutocompleteRef.current &&
        !locationAutocompleteRef.current.contains(event.target)
      ) {
        setLocationSuggestionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const hasResolvedLocation = lat !== "" && lng !== "";

  function limparMensagens() {
    if (erro) setErro("");
    if (sucesso) setSucesso("");
  }

  function addResponsibleUnit() {
    limparMensagens();

    if (!responsibleUnitToAddId) return;
    if (!unitMap[responsibleUnitToAddId]) return;
    if (responsibleUnitIds.includes(responsibleUnitToAddId)) return;

    setResponsibleUnitIds((prev) => [...prev, responsibleUnitToAddId]);
    setParticipantUnitIds((prev) =>
      prev.filter((id) => id !== responsibleUnitToAddId)
    );
    setResponsibleUnitToAddId("");
  }

  function removeResponsibleUnit(unitIdToRemove) {
    setResponsibleUnitIds((prev) =>
      prev.filter((id) => id !== unitIdToRemove)
    );
  }

  function addParticipantUnit() {
    limparMensagens();

    if (!unitToAddId) return;
    if (!unitMap[unitToAddId]) return;
    if (participantUnitIds.includes(unitToAddId)) return;
    if (responsibleUnitIds.includes(unitToAddId)) return;

    setParticipantUnitIds((prev) => [...prev, unitToAddId]);
    setUnitToAddId("");
  }

  function removeParticipantUnit(unitIdToRemove) {
    setParticipantUnitIds((prev) =>
      prev.filter((id) => id !== unitIdToRemove)
    );
  }

  function removePlanningFile(fileIdToRemove) {
    if (!canManagePlanningDocuments) return;
    setPlanningFiles((prev) =>
      prev.filter((item) => item.id !== fileIdToRemove)
    );
  }

  function clearPlanningFiles() {
    if (!canManagePlanningDocuments) return;
    setPlanningFiles([]);
  }

  function updatePlanningFileCategory(fileId, nextCategory) {
    if (!canManagePlanningDocuments) return;
    limparMensagens();

    setPlanningFiles((prev) =>
      prev.map((item) =>
        item.id === fileId
          ? {
              ...item,
              category: normalizePlanningCategory(nextCategory),
            }
          : item
      )
    );
  }

  function markExistingDocForRemoval(docId) {
    if (!canManagePlanningDocuments) return;
    limparMensagens();

    setRemovedExistingDocIds((prev) =>
      prev.includes(docId) ? prev : [...prev, docId]
    );

    setReplacedExistingDocs((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  }

  function undoRemoveExistingDoc(docId) {
    if (!canManagePlanningDocuments) return;
    limparMensagens();
    setRemovedExistingDocIds((prev) => prev.filter((id) => id !== docId));
  }

  function replaceExistingDoc(docId, file) {
    if (!canManagePlanningDocuments) return;
    limparMensagens();

    if (!file) return;

    if (!isAllowedPlanningFile(file)) {
      setErro(`O arquivo "${file.name}" deve ser PDF, DOC ou DOCX.`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErro(`O arquivo "${file.name}" deve ter no máximo 20 MB.`);
      return;
    }

    setRemovedExistingDocIds((prev) => prev.filter((id) => id !== docId));
    setReplacedExistingDocs((prev) => ({
      ...prev,
      [docId]: file,
    }));
  }

  function undoReplaceExistingDoc(docId) {
    if (!canManagePlanningDocuments) return;
    limparMensagens();
    setReplacedExistingDocs((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  }

  function handlePlanningFilesChange(e) {
    if (!canManagePlanningDocuments) {
      e.target.value = "";
      return;
    }

    limparMensagens();

    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;

    setPlanningFiles((prev) => {
      const merged = [...prev];

      for (const file of newFiles) {
        const alreadyExists = merged.some(
          (existing) =>
            existing.file?.name === file.name &&
            existing.file?.size === file.size &&
            existing.file?.lastModified === file.lastModified
        );

        if (!alreadyExists) {
          merged.push(createPlanningFileItem(file, "PLANO"));
        }
      }

      return merged;
    });

    e.target.value = "";
  }

  function validatePlanningFiles() {
    if (!canManagePlanningDocuments) return true;

    const totalExisting = visibleExistingPlanningDocs.length;
    const totalNew = planningFiles.length;

    if (isPlanningRequired && !isEditMode && totalNew === 0) {
      setErro("Anexe ao menos um arquivo de planejamento.");
      return false;
    }

    if (
      isPlanningRequired &&
      isEditMode &&
      totalExisting === 0 &&
      totalNew === 0
    ) {
      setErro("Anexe ao menos um arquivo de planejamento.");
      return false;
    }

    for (const item of planningFiles) {
      const file = item?.file;
      const category = normalizePlanningCategory(item?.category);

      if (!file) {
        setErro("Há um arquivo inválido na lista de planejamento.");
        return false;
      }

      if (!category) {
        setErro(`Informe o tipo do documento para "${file.name}".`);
        return false;
      }

      if (!isAllowedPlanningFile(file)) {
        setErro(`O arquivo "${file.name}" deve ser PDF, DOC ou DOCX.`);
        return false;
      }

      if (file.size > MAX_FILE_SIZE) {
        setErro(`O arquivo "${file.name}" deve ter no máximo 20 MB.`);
        return false;
      }
    }

    const replacementEntries = Object.entries(replacedExistingDocs);
    for (const [, file] of replacementEntries) {
      if (!isAllowedPlanningFile(file)) {
        setErro(`O arquivo "${file.name}" deve ser PDF, DOC ou DOCX.`);
        return false;
      }

      if (file.size > MAX_FILE_SIZE) {
        setErro(`O arquivo "${file.name}" deve ter no máximo 20 MB.`);
        return false;
      }
    }

    return true;
  }

  function validarFormulario() {
    if (!titulo.trim()) {
      setErro("Informe o título da operação/evento.");
      return false;
    }

    if (!local.trim()) {
      setErro("Informe o endereço da operação/evento.");
      return false;
    }

    if (!dataInicio || !horaInicio) {
      setErro("Informe a data e a hora de início.");
      return false;
    }

    if (!dataFim || !horaFim) {
      setErro("Informe a data e a hora de término.");
      return false;
    }

    const inicio = buildDateTime(dataInicio, horaInicio);
    const fim = buildDateTime(dataFim, horaFim);

    if (!inicio || !fim) {
      setErro("Não foi possível montar a data/hora da operação.");
      return false;
    }

    if (fim < inicio) {
      setErro("A data/hora final não pode ser menor que a inicial.");
      return false;
    }

    if (responsibleUnitIds.length === 0) {
      setErro("Selecione ao menos uma unidade principal responsável.");
      return false;
    }

    const invalidResponsible = responsibleUnitIds.some((id) => !unitMap[id]);
    if (invalidResponsible) {
      setErro("Uma das unidades responsáveis selecionadas é inválida.");
      return false;
    }

    if (!validatePlanningFiles()) {
      return false;
    }

    return true;
  }

  function handleLocationInputChange(value) {
    limparMensagens();

    const normalizedValue = normalizeSearchText(value);
    const normalizedResolvedQuery = normalizeSearchText(resolvedLocationQuery);

    setLocal(value);

    if (normalizedResolvedQuery && normalizedValue !== normalizedResolvedQuery) {
      setLat("");
      setLng("");
      setLocationMeta(null);
      setResolvedLocationQuery("");
    }

    if (value.trim().length >= LOCATION_AUTOCOMPLETE_MIN_CHARS) {
      setLocationSuggestionsOpen(true);
    } else {
      setLocationSuggestions([]);
      setLocationSuggestionsOpen(false);
    }
  }

  function applyLocationSuggestion(item, sourceQuery = "") {
    const queryLabel = String(
      sourceQuery || local || item.display_name || ""
    ).trim();
    const meta = normalizeLocationMeta(item, queryLabel);

    setLat(item.lat !== undefined && item.lat !== null ? String(item.lat) : "");
    setLng(item.lon !== undefined && item.lon !== null ? String(item.lon) : "");
    setLocationMeta(meta);
    setResolvedLocationQuery(queryLabel);
    setLocationSuggestions([]);
    setLocationSuggestionsOpen(false);
    limparMensagens();
  }

  async function ensureResolvedLocation() {
    const typedLocation = local.trim();

    if (!typedLocation) {
      setErro("Informe o endereço da operação/evento.");
      return null;
    }

    if (lat !== "" && lng !== "") {
      return {
        lat: Number(lat),
        lng: Number(lng),
        displayName:
          locationMeta?.displayName ||
          locationMeta?.compactLabel ||
          typedLocation,
        meta:
          locationMeta || {
            placeId: null,
            displayName: typedLocation,
            compactLabel: typedLocation,
            searchLabel: typedLocation,
            lat: Number(lat),
            lng: Number(lng),
            city: null,
            state: null,
            country: "Brasil",
            district: null,
            road: null,
            houseNumber: null,
            postcode: null,
            rawAddress: {},
            provider: "manual",
          },
      };
    }

    setResolvingLocation(true);

    try {
      const results = await searchAddressSuggestionsRanked(
        typedLocation,
        undefined,
        1
      );
      const first = results[0];

      if (!first) {
        setErro(
          "Não foi possível localizar esse endereço automaticamente. Digite o endereço com mais detalhes, como rua, número e bairro."
        );
        return null;
      }

      applyLocationSuggestion(first, typedLocation);

      const meta = normalizeLocationMeta(first, typedLocation);

      return {
        lat: Number(first.lat),
        lng: Number(first.lon),
        displayName: first.display_name || formatLocationSuggestionLabel(first),
        meta,
      };
    } catch (error) {
      console.error("Erro ao resolver localização:", error);
      setErro(
        "Não foi possível localizar esse endereço automaticamente. Tente novamente em instantes."
      );
      return null;
    } finally {
      setResolvingLocation(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    limparMensagens();

    if (!validarFormulario()) return;

    setLoading(true);

    try {
      const resolvedLocation = await ensureResolvedLocation();
      if (!resolvedLocation) return;

      const startAt = buildDateTime(dataInicio, horaInicio);
      const endAt = buildDateTime(dataFim, horaFim);

      const primaryResponsibleId = responsibleUnitIds[0];
      const primaryRootUnit = getRootUnit(primaryResponsibleId);
      const originUnitPayload = automaticOrigin;

      const planningOwnerUnit =
        originUnitPayload?.id ? unitMap[originUnitPayload.id] : loginUnit;

      const planningOriginMeta =
        planningOwnerScope === "AIO"
          ? {
              documentGroup: "PLANNING",
              documentScope: "AIO",
              origin: "AIO",
              originType: "AIO",
              originUnitId: null,
              originUnitCode: "AIO",
              originUnitName: "Assessoria de Integração Operacional",
              unitId: null,
              unitCode: "AIO",
              unitName: "Assessoria de Integração Operacional",
              unitPath: "AIO",
            }
          : {
              documentGroup: "PLANNING",
              documentScope: "UNIT",
              origin: originUnitPayload.type || "UNIDADE_SUBORDINADA",
              originType: originUnitPayload.type || "UNIDADE_SUBORDINADA",
              originUnitId:
                originUnitPayload.id || planningOwnerUnit?.id || null,
              originUnitCode:
                originUnitPayload.code || getUnitCode(planningOwnerUnit) || null,
              originUnitName:
                originUnitPayload.name ||
                getUnitLabel(planningOwnerUnit) ||
                null,
              unitId: originUnitPayload.id || planningOwnerUnit?.id || null,
              unitCode:
                originUnitPayload.code || getUnitCode(planningOwnerUnit) || null,
              unitName:
                originUnitPayload.name ||
                getUnitLabel(planningOwnerUnit) ||
                null,
              unitPath:
                originUnitPayload.path ||
                (planningOwnerUnit?.id
                  ? getUnitPath(planningOwnerUnit.id)
                  : null),
            };

      const responsibleUnits = responsibleUnitIds
        .map((id) => {
          const unit = unitMap[id];
          if (!unit) return null;

          const root = getRootUnit(id);

          return {
            unitId: unit.id,
            code: getUnitCode(unit),
            name: getUnitLabel(unit),
            category: unit.category || "",
            parentUnitId: unit.parentUnitId || null,
            isManager: !!unit.isManager,
            unitPath: getUnitPath(unit.id),
            command: getUnitCode(root) || getUnitLabel(root),
          };
        })
        .filter(Boolean);

      const directUnitIds = Array.from(
        new Set([...responsibleUnitIds, ...participantUnitIds].filter(Boolean))
      );

      const visibleToUnitIdsSet = new Set(directUnitIds);

      for (const currentUnitId of directUnitIds) {
        const ancestors = getAncestorUnitIds(currentUnitId);
        ancestors.forEach((ancestorId) => visibleToUnitIdsSet.add(ancestorId));
      }

      const visibleToUnitIds = Array.from(visibleToUnitIdsSet);

      const visibleToUnitCodes = Array.from(
        new Set(
          visibleToUnitIds
            .map((id) => getUnitCode(unitMap[id]))
            .filter(Boolean)
        )
      );

      const visibleToUnitPaths = Array.from(
        new Set(visibleToUnitIds.map((id) => getUnitPath(id)).filter(Boolean))
      );

      const involvedUnits = directUnitIds
        .map((id) => {
          const unit = unitMap[id];
          if (!unit) return null;

          return {
            unitId: unit.id,
            code: getUnitCode(unit),
            name: getUnitLabel(unit),
            category: unit.category || "",
            parentUnitId: unit.parentUnitId || null,
            isManager: !!unit.isManager,
            unitPath: getUnitPath(unit.id),
          };
        })
        .filter(Boolean);

      const commands = Array.from(
        new Set(
          responsibleUnitIds
            .map((id) => getRootUnit(id))
            .filter(Boolean)
            .map((unit) => getUnitCode(unit) || getUnitLabel(unit))
            .filter(Boolean)
        )
      );

      const eventRef = isEditMode
        ? doc(db, "events", editingEventId)
        : doc(collection(db, "events"));

      if (!isEditMode) {
        await setDoc(
          eventRef,
          {
            title: titulo.trim() || "Evento em criação",
            name: titulo.trim() || "Evento em criação",
            originType: origem,
            createdByUnitId: originUnitPayload.id || null,
            createdByUnitCode: originUnitPayload.code || null,
            createdByUnitName: originUnitPayload.name || null,
            createdByUid: user?.uid || null,
            createdByEmail: user?.email || null,
            createdByRole: claims?.role || null,
            draftStage: "UPLOADING_DOCUMENTS",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      const batch = writeBatch(db);
      const planningDocumentsPayload = [];

      if (canManagePlanningDocuments && planningFiles.length > 0) {
        for (const item of planningFiles) {
          const file = item.file;
          const fileCategory = normalizePlanningCategory(item.category);
          const folder = getPlanningStorageFolder(planningOwnerScope);

          const safeName = sanitizeFileName(file.name);
          const storagePath = `events/${eventRef.id}/documents/${folder}/${Date.now()}_${safeName}`;
          const storageRef = ref(storage, storagePath);

          await uploadBytes(storageRef, file);
          const downloadURL = await getDownloadURL(storageRef);

          planningDocumentsPayload.push({
            ...planningOriginMeta,
            fileName: file.name,
            fileType: file.type || "",
            category: fileCategory,
            storagePath,
            downloadURL,
            uploadedByUid: user?.uid || null,
            uploadedByEmail: user?.email || null,
            uploadedAt: serverTimestamp(),
          });
        }
      }

      const replacementEntries = Object.entries(replacedExistingDocs);
      for (const [docId, file] of replacementEntries) {
        const currentDoc = existingPlanningDocs.find((item) => item.id === docId);
        if (!currentDoc || !file) continue;

        const folder = getPlanningStorageFolder(
          currentDoc.documentScope || planningDocsFilterConfig.scope
        );
        const safeName = sanitizeFileName(file.name);
        const storagePath = `events/${eventRef.id}/documents/${folder}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, storagePath);

        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);

        const existingDocRef = doc(
          db,
          "events",
          eventRef.id,
          "documents",
          docId
        );

        batch.set(
          existingDocRef,
          {
            documentGroup: currentDoc.documentGroup || "PLANNING",
            documentScope:
              currentDoc.documentScope || planningDocsFilterConfig.scope,
            origin:
              currentDoc.origin ||
              currentDoc.originType ||
              planningOriginMeta.origin,
            originType: currentDoc.originType || planningOriginMeta.originType,
            originUnitId:
              currentDoc.originUnitId ??
              currentDoc.unitId ??
              planningOriginMeta.originUnitId ??
              null,
            originUnitCode:
              currentDoc.originUnitCode ||
              currentDoc.unitCode ||
              planningOriginMeta.originUnitCode ||
              null,
            originUnitName:
              currentDoc.originUnitName ||
              currentDoc.unitName ||
              planningOriginMeta.originUnitName ||
              null,
            unitId: currentDoc.unitId ?? planningOriginMeta.unitId ?? null,
            unitCode: currentDoc.unitCode || planningOriginMeta.unitCode || null,
            unitName: currentDoc.unitName || planningOriginMeta.unitName || null,
            unitPath: currentDoc.unitPath || planningOriginMeta.unitPath || null,

            fileName: file.name,
            fileType: file.type || "",
            category: normalizePlanningCategory(currentDoc.category),
            storagePath,
            downloadURL,

            isDeleted: false,
            deletedAt: null,
            deletedByUid: null,
            deletedByEmail: null,
            deletedByActorType: null,

            replacedAt: serverTimestamp(),
            replacedByUid: user?.uid || null,
            replacedByEmail: user?.email || null,

            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
            updatedByEmail: user?.email || null,

            uploadedAt: serverTimestamp(),
            uploadedByUid: user?.uid || null,
            uploadedByEmail: user?.email || null,
          },
          { merge: true }
        );
      }

      const totalPlanningDocuments = canManagePlanningDocuments
        ? visibleExistingPlanningDocs.length + planningDocumentsPayload.length
        : 0;

      const hasPlanningDocuments = totalPlanningDocuments > 0;

      const eventPayload = {
        title: titulo.trim(),
        name: titulo.trim(),
        location: local.trim(),
        locationResolvedLabel:
          resolvedLocation.meta?.compactLabel ||
          resolvedLocation.displayName ||
          local.trim(),
        locationMeta: resolvedLocation.meta || null,
        description: descricao.trim(),
        estimatedPublic: publicoEstimado ? Number(publicoEstimado) : 0,
        operationType: tipoOperacao,
        type: tipoOperacao,
        status,
        originType: origem,

        command: getUnitCode(primaryRootUnit) || getUnitLabel(primaryRootUnit),
        commands,

        createdByUnitId: originUnitPayload.id,
        createdByUnitCode: originUnitPayload.code || null,
        createdByUnitName: originUnitPayload.name || null,
        unitPath: originUnitPayload.path || null,

        responsibleUnitIds,
        responsibleUnits,
        responsibleUnitPaths: responsibleUnits.map((u) => u.unitPath),

        participantUnitIds,
        involvedUnits,
        involvedUnitsCount: involvedUnits.length,

        visibleToUnitIds,
        visibleToUnitCodes,
        visibleToUnitPaths,

        hasPlanningDocument: hasPlanningDocuments,
        planningCategory: hasPlanningDocuments
          ? normalizePlanningCategory(planningCategory)
          : null,
        planningDocumentsCount: hasPlanningDocuments
          ? totalPlanningDocuments
          : 0,
        planningDocumentScope: hasPlanningDocuments ? planningOwnerScope : null,
        planningOwnerUnitId:
          hasPlanningDocuments && planningOwnerScope === "UNIT"
            ? planningOriginMeta.originUnitId
            : null,
        planningOwnerUnitCode:
          hasPlanningDocuments && planningOwnerScope === "UNIT"
            ? planningOriginMeta.originUnitCode
            : null,
        planningOwnerUnitName:
          hasPlanningDocuments && planningOwnerScope === "UNIT"
            ? planningOriginMeta.originUnitName
            : null,

        startAt,
        endAt,

        lat: resolvedLocation.lat,
        lng: resolvedLocation.lng,

        draftStage: "READY",
      };

      if (isEditMode) {
        batch.set(
          eventRef,
          {
            ...eventPayload,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
            updatedByEmail: user?.email || null,
            updatedByRole: claims?.role || null,

            retifiedAt: serverTimestamp(),
            retifiedByUid: user?.uid || null,
            retifiedByEmail: user?.email || null,

            revision: Number(editingEvent?.revision || 1) + 1,
            distributionVersion:
              Number(editingEvent?.distributionVersion || 1) + 1,
            distributionTriggerAt: serverTimestamp(),
            distributionStatus: "PENDING_RETIFICATION",
            distributionType: "RETIFICACAO",
          },
          { merge: true }
        );
      } else {
        batch.set(eventRef, {
          ...eventPayload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || null,
          createdByEmail: user?.email || null,
          createdByRole: claims?.role || null,

          revision: 1,
          distributionVersion: 1,
          distributionTriggerAt: serverTimestamp(),
          distributionStatus: "PENDING",
          distributionType: "NOVO_EVENTO",
        });
      }

      if (isEditMode) {
        const existingParticipantsSnap = await getDocs(
          collection(eventRef, "participants")
        );

        existingParticipantsSnap.docs.forEach((participantDoc) => {
          if (!directUnitIds.includes(participantDoc.id)) {
            batch.delete(participantDoc.ref);
          }
        });
      }

      for (const unit of involvedUnits) {
        const participantRef = doc(
          collection(eventRef, "participants"),
          unit.unitId
        );

        const participantPayload = {
          unitId: unit.unitId,
          unitCode: getUnitCode(unit),
          unitName: getUnitLabel(unit),
          unitPath: unit.unitPath,
          category: unit.category,
          isManager: unit.isManager,
          roleInEvent: responsibleUnitIds.includes(unit.unitId)
            ? "RESPONSIBLE"
            : "INVOLVED",
          canUploadDesdobramento: true,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid || null,
          distributionVersion: isEditMode
            ? Number(editingEvent?.distributionVersion || 1) + 1
            : 1,
          distributionTriggerAt: serverTimestamp(),
          distributionType: isEditMode ? "RETIFICACAO" : "NOVO_EVENTO",
          isRetification: isEditMode,
        };

        if (!isEditMode) {
          participantPayload.addedAt = serverTimestamp();
          participantPayload.addedBy = user?.uid || null;
        }

        batch.set(participantRef, participantPayload, { merge: true });
      }

      for (const removedDocId of removedExistingDocIds) {
        const removedDocRef = doc(
          db,
          "events",
          eventRef.id,
          "documents",
          removedDocId
        );

        batch.set(
          removedDocRef,
          {
            isDeleted: true,
            deletedAt: serverTimestamp(),
            deletedByUid: user?.uid || null,
            deletedByEmail: user?.email || null,
            deletedByActorType:
              planningOwnerScope === "AIO" ? "AIO" : "UNIDADE",
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
            updatedByEmail: user?.email || null,
          },
          { merge: true }
        );
      }

      for (const planningDoc of planningDocumentsPayload) {
        const planningDocRef = doc(collection(eventRef, "documents"));
        batch.set(planningDocRef, planningDoc);
      }

      await batch.commit();

      setSucesso(
        isEditMode
          ? "Evento/operação atualizado com sucesso."
          : "Evento/operação criado com sucesso."
      );

      clearEditPayload();
      setEditPayload(null);
      resetForm();

      if (onCreated) {
        onCreated(eventRef.id, { mode: isEditMode ? "edit" : "create" });
      }
    } catch (error) {
      console.error(error);
      setErro(
        isEditMode
          ? "Não foi possível atualizar o evento/operação."
          : "Não foi possível salvar o evento/operação."
      );
    } finally {
      setLoading(false);
    }
  }

  const showPlanningSection =
    canManagePlanningDocuments ||
    visibleExistingPlanningDocs.length > 0 ||
    planningFiles.length > 0 ||
    removedExistingPlanningDocs.length > 0;

  function handleCreateNewClick() {
    clearEditPayload();
    setEditPayload(null);
    resetForm();

    if (typeof onGoCreateEvent === "function") {
      onGoCreateEvent();
    }
  }

  return (
    <div className="dashboardShell">
      <AppSidebar
        user={user}
        claims={claims}
        active="create-event"
        onGoHome={onGoHome}
        onGoCreateEvent={handleCreateNewClick}
        onGoUnits={onGoUnits}
        onGoAccess={onGoAccess}
      />

      <main className="dashboardMain">
        <div className="createTopbar">
          <div>
            <div className="createWelcome">
              {isEditMode ? "Retificação operacional" : "Cadastro operacional"}
            </div>
            <h1 className="createTitle">
              {isEditMode
                ? "Editar / Retificar Evento"
                : "Criar Evento / Operação"}
            </h1>
            <div className="createSubline">
              {isEditMode
                ? "As informações abaixo já foram carregadas para edição, incluindo os documentos já anexados."
                : "Registre uma nova operação com informações de planejamento, unidade responsável e localização."}
            </div>

            {isEditMode && (
              <div
                style={{
                  marginTop: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "#eef2ff",
                  color: "#1d4ed8",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <BadgeCheck size={14} />
                <span>
                  Modo edição ativo — os dados foram preenchidos
                  automaticamente.
                </span>
              </div>
            )}
          </div>

          {onBack && (
            <button className="backBtn" onClick={onBack} type="button">
              <ArrowLeft size={16} />
              <span>Voltar</span>
            </button>
          )}
        </div>

        <form className="createForm" onSubmit={handleSubmit}>
          <section className="formCard">
            <div className="formCardHeader">
              <div className="formCardIcon">
                <FileText size={18} />
              </div>
              <div>
                <h2 style={FORM_CARD_TITLE_STYLE}>Informações gerais</h2>
                <p style={FORM_CARD_SUBTITLE_STYLE}>
                  Dados principais do evento ou operação.
                </p>
              </div>
            </div>

            <div className="formGrid">
              <div className="field fieldSpan2">
                <label>Título da operação/evento</label>
                <input
                  type="text"
                  value={titulo}
                  onChange={(e) => {
                    setTitulo(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: Operação Impacto Centro"
                />
              </div>

              <div className="field fieldSpan2">
                <label>Data e horário do evento</label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 12,
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#6b7280",
                      }}
                    >
                      Data inicial
                    </label>
                    <input
                      type="date"
                      value={dataInicio}
                      onChange={(e) => {
                        setDataInicio(e.target.value);
                        limparMensagens();
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#6b7280",
                      }}
                    >
                      Hora inicial
                    </label>
                    <div className="inputWithIcon">
                      <Clock3 size={16} />
                      <input
                        type="time"
                        value={horaInicio}
                        onChange={(e) => {
                          setHoraInicio(e.target.value);
                          limparMensagens();
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#6b7280",
                      }}
                    >
                      Data final
                    </label>
                    <input
                      type="date"
                      value={dataFim}
                      onChange={(e) => {
                        setDataFim(e.target.value);
                        limparMensagens();
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#6b7280",
                      }}
                    >
                      Hora final
                    </label>
                    <div className="inputWithIcon">
                      <Clock3 size={16} />
                      <input
                        type="time"
                        value={horaFim}
                        onChange={(e) => {
                          setHoraFim(e.target.value);
                          limparMensagens();
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Tipo</label>
                <select
                  value={tipoOperacao}
                  onChange={(e) => setTipoOperacao(e.target.value)}
                >
                  <option value="INTEGRADO">Integrado</option>
                  <option value="CENTRALIZADO">Centralizado</option>
                </select>
              </div>

              <div className="field">
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="PREVISTO">Previsto</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>

              <div className="field fieldSpan2">
                <label>Endereço</label>

                <div
                  ref={locationAutocompleteRef}
                  style={{
                    position: "relative",
                  }}
                >
                  <div className="inputWithIcon">
                    <MapPin size={16} />
                    <input
                      type="text"
                      value={local}
                      onChange={(e) =>
                        handleLocationInputChange(e.target.value)
                      }
                      onFocus={() => {
                        if (locationSuggestions.length > 0) {
                          setLocationSuggestionsOpen(true);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && locationSuggestionsOpen) {
                          e.preventDefault();
                        }
                      }}
                      placeholder="Ex.: Rua..., número, bairro, Manaus/AM"
                    />
                  </div>

                  {(loadingLocationSuggestions || locationSuggestionsOpen) && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        boxShadow: "0 16px 32px rgba(15, 23, 42, 0.12)",
                        overflow: "hidden",
                      }}
                    >
                      {loadingLocationSuggestions ? (
                        <div
                          style={{
                            padding: "12px 14px",
                            fontSize: 13,
                            color: "#6b7280",
                          }}
                        >
                          Buscando endereço mais compatível...
                        </div>
                      ) : locationSuggestions.length === 0 ? (
                        <div
                          style={{
                            padding: "12px 14px",
                            fontSize: 13,
                            color: "#6b7280",
                          }}
                        >
                          Nenhum endereço encontrado.
                        </div>
                      ) : (
                        locationSuggestions.map((item) => {
                          const compactLabel = formatLocationSuggestionLabel(
                            item,
                            local.trim()
                          );

                          return (
                            <button
                              key={`${item.place_id}-${item.lat}-${item.lon}`}
                              type="button"
                              onClick={() =>
                                applyLocationSuggestion(item, local.trim())
                              }
                              style={{
                                width: "100%",
                                textAlign: "left",
                                border: "none",
                                background: "#fff",
                                padding: "12px 14px",
                                cursor: "pointer",
                                borderBottom: "1px solid #f3f4f6",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: "#111827",
                                  fontSize: 13,
                                  lineHeight: 1.35,
                                }}
                              >
                                {compactLabel}
                              </span>

                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#6b7280",
                                  lineHeight: 1.35,
                                }}
                              >
                                {item.display_name}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  As sugestões aparecem no formato: Rua, Número, Bairro, Cidade
                  Estado, País.
                </div>

                {hasResolvedLocation && (
                  <div
                    style={{
                      marginTop: 14,
                      border: "1px solid #e5e7eb",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: "#fff",
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 800,
                        color: "#111827",
                        background: "#f9fafb",
                      }}
                    >
                      <MapPin size={14} />
                      <span>Pré-visualização da marcação do evento</span>
                    </div>

                    <MiniGoogleMapPreview
                      lat={Number(lat)}
                      lng={Number(lng)}
                      title={local || "Local do evento"}
                      subtitle={
                        locationMeta?.compactLabel ||
                        locationMeta?.displayName ||
                        local ||
                        ""
                      }
                    />

                    <div
                      style={{
                        padding: "12px",
                        fontSize: 12,
                        color: "#374151",
                        borderTop: "1px solid #e5e7eb",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 800, color: "#111827" }}>
                          Endereço informado:
                        </span>{" "}
                        {local || "-"}
                      </div>

                      <div>
                        <span style={{ fontWeight: 800, color: "#111827" }}>
                          Endereço localizado:
                        </span>{" "}
                        {locationMeta?.compactLabel ||
                          locationMeta?.displayName ||
                          "-"}
                      </div>

                      <div style={{ color: "#6b7280" }}>
                        Latitude: {lat} • Longitude: {lng}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Público estimado</label>
                <div className="inputWithIcon">
                  <Users size={16} />
                  <input
                    type="number"
                    min="0"
                    value={publicoEstimado}
                    onChange={(e) => setPublicoEstimado(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="field">
                <label>Origem / unidade geradora</label>

                <div
                  style={{
                    minHeight: 48,
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: "12px 14px",
                    background: "#f9fafb",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#1d4ed8",
                      textTransform: "uppercase",
                    }}
                  >
                    {getOriginTypeLabel(origem)}
                  </span>

                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#111827",
                    }}
                  >
                    {automaticOrigin.code
                      ? `${automaticOrigin.code} — ${automaticOrigin.name}`
                      : automaticOrigin.name}
                  </span>

                  {automaticOrigin.path && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#6b7280",
                      }}
                    >
                      {automaticOrigin.path}
                    </span>
                  )}
                </div>
              </div>

              <div className="field fieldSpan2">
                <label>Descrição / Observações</label>
                <textarea
                  rows="4"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descreva a finalidade, contexto ou observações relevantes."
                />
              </div>
            </div>
          </section>

          {showPlanningSection && (
            <section className="formCard">
              <div className="formCardHeader">
                <div className="formCardIcon">
                  <Upload size={18} />
                </div>
                <div>
                  <h2 style={FORM_CARD_TITLE_STYLE}>{planningSectionTitle}</h2>
                  <p style={FORM_CARD_SUBTITLE_STYLE}>
                    {planningSectionSubtitle}
                  </p>
                </div>
              </div>

              <div className="formGrid">
                <div className="field">
                  <label>Escopo do planejamento</label>
                  <div
                    style={{
                      minHeight: 48,
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: "12px 14px",
                      background: "#f9fafb",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#111827",
                    }}
                  >
                    {planningOwnerScope === "AIO"
                      ? "Planejamento principal da AIO"
                      : "Planejamento da unidade geradora"}
                  </div>
                </div>

                <div className="field">
                  <label>Vinculado a</label>
                  <div
                    style={{
                      minHeight: 48,
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: "12px 14px",
                      background: "#f9fafb",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#111827",
                    }}
                  >
                    {planningOwnerLabel}
                  </div>
                </div>

                <div className="field fieldSpan2">
                  <label>
                    {planningOwnerScope === "AIO"
                      ? "Arquivos do planejamento principal"
                      : "Arquivos do planejamento da unidade"}
                  </label>

                  <input
                    type="file"
                    multiple
                    disabled={!canManagePlanningDocuments}
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onClick={(e) => {
                      e.target.value = "";
                    }}
                    onChange={handlePlanningFilesChange}
                  />

                  {isEditMode && (
                    <div style={{ marginTop: 16 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 700,
                        }}
                      >
                        Documentos já anexados
                      </label>

                      {loadingExistingDocs ? (
                        <div className="emptySelectedUnits">
                          Carregando documentos...
                        </div>
                      ) : visibleExistingPlanningDocs.length === 0 ? (
                        <div className="emptySelectedUnits">
                          Nenhum documento já anexado.
                        </div>
                      ) : (
                        <div className="selectedUnitsList">
                          {visibleExistingPlanningDocs.map((docItem) => {
                            const replacementFile =
                              replacedExistingDocs[docItem.id];

                            return (
                              <div
                                key={docItem.id}
                                className="selectedUnitTag"
                                style={{
                                  alignItems: "flex-start",
                                  gap: 12,
                                }}
                              >
                                <DocumentFileIcon
                                  fileName={
                                    replacementFile?.name || docItem.fileName
                                  }
                                />

                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 4,
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  <span>
                                    <b>{getDocumentTypeLabel(docItem)}</b>
                                  </span>

                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "#6b7280",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {docItem.fileName || "Documento sem nome"}
                                  </span>

                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "#6b7280",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {docItem.uploadedByEmail || "-"} •{" "}
                                    {fmtDateTime(docItem.uploadedAt)}
                                  </span>

                                  {docItem.downloadURL && !replacementFile && (
                                    <a
                                      href={docItem.downloadURL}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        marginTop: 2,
                                        textDecoration: "none",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: "#1d4ed8",
                                      }}
                                    >
                                      <ExternalLink size={13} />
                                      <span>Visualizar documento</span>
                                    </a>
                                  )}

                                  {replacementFile && (
                                    <div
                                      style={{
                                        marginTop: 6,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 4,
                                        padding: "8px 10px",
                                        borderRadius: 12,
                                        background: "#eff6ff",
                                        border: "1px solid #bfdbfe",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 800,
                                          color: "#1d4ed8",
                                        }}
                                      >
                                        Novo arquivo selecionado para substituição
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 12,
                                          color: "#1e3a8a",
                                          wordBreak: "break-word",
                                        }}
                                      >
                                        {replacementFile.name}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                  }}
                                >
                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: 6,
                                      minHeight: 34,
                                      padding: "0 12px",
                                      borderRadius: 10,
                                      border: "1px solid #bfdbfe",
                                      background: canManagePlanningDocuments
                                        ? "#eff6ff"
                                        : "#f3f4f6",
                                      color: canManagePlanningDocuments
                                        ? "#1d4ed8"
                                        : "#9ca3af",
                                      cursor: canManagePlanningDocuments
                                        ? "pointer"
                                        : "not-allowed",
                                      fontSize: 12,
                                      fontWeight: 700,
                                    }}
                                  >
                                    <Upload size={13} />
                                    <span>Substituir</span>
                                    <input
                                      type="file"
                                      hidden
                                      disabled={!canManagePlanningDocuments}
                                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          replaceExistingDoc(docItem.id, file);
                                        }
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>

                                  {replacementFile && (
                                    <button
                                      type="button"
                                      className="unitsSecondaryBtn"
                                      disabled={!canManagePlanningDocuments}
                                      onClick={() =>
                                        undoReplaceExistingDoc(docItem.id)
                                      }
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        justifyContent: "center",
                                      }}
                                    >
                                      <RotateCcw size={13} />
                                      <span>Desfazer</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    disabled={!canManagePlanningDocuments}
                                    onClick={() =>
                                      markExistingDocForRemoval(docItem.id)
                                    }
                                    title="Marcar para remover"
                                    style={{
                                      minHeight: 34,
                                      padding: "0 12px",
                                      borderRadius: 10,
                                      border: "1px solid #fecaca",
                                      background: canManagePlanningDocuments
                                        ? "#fee2e2"
                                        : "#f3f4f6",
                                      color: canManagePlanningDocuments
                                        ? "#991b1b"
                                        : "#9ca3af",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: 6,
                                      cursor: canManagePlanningDocuments
                                        ? "pointer"
                                        : "not-allowed",
                                      fontSize: 12,
                                      fontWeight: 700,
                                    }}
                                  >
                                    <Trash2 size={13} />
                                    <span>Remover</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {removedExistingPlanningDocs.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 700,
                          color: "#991b1b",
                        }}
                      >
                        Documentos marcados para remoção
                      </label>

                      <div className="selectedUnitsList">
                        {removedExistingPlanningDocs.map((docItem) => (
                          <div
                            key={`removed-${docItem.id}`}
                            className="selectedUnitTag"
                            style={{
                              alignItems: "flex-start",
                              gap: 12,
                              background: "#fff7f7",
                              border: "1px solid #fecaca",
                            }}
                          >
                            <DocumentFileIcon fileName={docItem.fileName} />

                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              <span style={{ color: "#991b1b" }}>
                                <b>{getDocumentTypeLabel(docItem)}</b>
                              </span>

                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#7f1d1d",
                                  wordBreak: "break-word",
                                }}
                              >
                                {docItem.fileName || "Documento sem nome"}
                              </span>

                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#7f1d1d",
                                }}
                              >
                                Será removido ao salvar as alterações.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="unitsSecondaryBtn"
                              disabled={!canManagePlanningDocuments}
                              onClick={() => undoRemoveExistingDoc(docItem.id)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <RotateCcw size={13} />
                              <span>Desfazer</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {planningFiles.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 700,
                        }}
                      >
                        Novos arquivos para anexar
                      </label>

                      <div className="selectedUnitsList">
                        {planningFiles.map((item) => (
                          <div
                            key={item.id}
                            className="selectedUnitTag"
                            style={{
                              alignItems: "flex-start",
                              gap: 12,
                            }}
                          >
                            <DocumentFileIcon fileName={item.file?.name} />

                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              <span style={{ wordBreak: "break-word" }}>
                                <b>{item.file?.name}</b>
                              </span>

                              <div
                                style={{
                                  display: "grid",
                                  gap: 6,
                                  maxWidth: 240,
                                }}
                              >
                                <label
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: "#374151",
                                  }}
                                >
                                  Tipo do documento
                                </label>

                                <select
                                  value={item.category}
                                  disabled={!canManagePlanningDocuments}
                                  onChange={(e) =>
                                    updatePlanningFileCategory(
                                      item.id,
                                      e.target.value
                                    )
                                  }
                                >
                                  <option value="PLANO">Plano</option>
                                  <option value="ORDEM">Ordem</option>
                                  <option value="NOTA">Nota</option>
                                  <option value="OFICIO">Ofício</option>
                                  <option value="CRONOGRAMA">Cronograma</option>
                                  <option value="DOCUMENTO">Documento</option>
                                </select>
                              </div>

                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#6b7280",
                                }}
                              >
                                Tipo atual:{" "}
                                {getPlanningCategoryLabel(item.category)}
                              </span>
                            </div>

                            <button
                              type="button"
                              className="removeUnitBtn"
                              disabled={!canManagePlanningDocuments}
                              onClick={() => removePlanningFile(item.id)}
                              title="Remover arquivo"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="unitsSecondaryBtn"
                          disabled={!canManagePlanningDocuments}
                          onClick={clearPlanningFiles}
                        >
                          Limpar arquivos novos
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="formCard">
            <div className="formCardHeader">
              <div className="formCardIcon">
                <Building2 size={18} />
              </div>
              <div>
                <h2 style={FORM_CARD_TITLE_STYLE}>
                  Responsabilidade operacional
                </h2>
                <p style={FORM_CARD_SUBTITLE_STYLE}>
                  Defina as unidades principais responsáveis e adicione as demais
                  unidades envolvidas na operação.
                </p>
              </div>
            </div>

            <div className="formGrid">
              <div className="field fieldSpan2">
                <label>Unidades principais responsáveis</label>
                <div className="multiAddRow">
                  <select
                    value={responsibleUnitToAddId}
                    onChange={(e) => setResponsibleUnitToAddId(e.target.value)}
                    disabled={loadingUnits}
                  >
                    <option value="">
                      {loadingUnits
                        ? "Carregando unidades..."
                        : "Selecione uma unidade"}
                    </option>

                    {availableResponsibleOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="addUnitBtn"
                    onClick={addResponsibleUnit}
                    disabled={!responsibleUnitToAddId}
                  >
                    <PlusCircle size={16} />
                    <span>Adicionar</span>
                  </button>
                </div>
              </div>

              <div className="field fieldSpan2">
                <label>Responsáveis selecionadas</label>

                {selectedResponsibleUnits.length === 0 ? (
                  <div className="emptySelectedUnits">
                    Nenhuma unidade responsável selecionada.
                  </div>
                ) : (
                  <div className="selectedUnitsList">
                    {selectedResponsibleUnits.map((unit) => (
                      <div key={unit.id} className="selectedUnitTag">
                        <span>
                          <b>{getUnitCode(unit) || "UNIDADE"}</b> —{" "}
                          {getUnitLabel(unit)}
                        </span>

                        <button
                          type="button"
                          className="removeUnitBtn"
                          onClick={() => removeResponsibleUnit(unit.id)}
                          title="Remover unidade responsável"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="field fieldSpan2">
                <label>Adicionar unidades envolvidas</label>
                <div className="multiAddRow">
                  <select
                    value={unitToAddId}
                    onChange={(e) => setUnitToAddId(e.target.value)}
                    disabled={loadingUnits}
                  >
                    <option value="">
                      {loadingUnits
                        ? "Carregando unidades..."
                        : "Selecione uma unidade"}
                    </option>

                    {availableParticipantOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="addUnitBtn"
                    onClick={addParticipantUnit}
                    disabled={!unitToAddId}
                  >
                    <PlusCircle size={16} />
                    <span>Adicionar</span>
                  </button>
                </div>
              </div>

              <div className="field fieldSpan2">
                <label>Unidades envolvidas selecionadas</label>

                {selectedParticipantUnits.length === 0 ? (
                  <div className="emptySelectedUnits">
                    Nenhuma unidade adicional selecionada.
                  </div>
                ) : (
                  <div className="selectedUnitsList">
                    {selectedParticipantUnits.map((unit) => (
                      <div key={unit.id} className="selectedUnitTag">
                        <span>
                          <b>{getUnitCode(unit) || "UNIDADE"}</b> —{" "}
                          {getUnitLabel(unit)}
                        </span>

                        <button
                          type="button"
                          className="removeUnitBtn"
                          onClick={() => removeParticipantUnit(unit.id)}
                          title="Remover unidade"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {(erro || sucesso) && (
            <div className={erro ? "messageBox error" : "messageBox success"}>
              {erro || sucesso}
            </div>
          )}

          <div className="formActions">
            <button
              className="saveBtn"
              type="submit"
              disabled={loading || loadingUnits || resolvingLocation}
            >
              <Save size={16} />
              <span>
                {loading || resolvingLocation
                  ? isEditMode
                    ? "Atualizando..."
                    : "Salvando..."
                  : isEditMode
                  ? "Salvar alterações"
                  : "Salvar evento/operação"}
              </span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}