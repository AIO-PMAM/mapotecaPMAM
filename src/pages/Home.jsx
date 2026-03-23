import { useEffect, useMemo, useState } from "react";
import { db, storage } from "../firebase";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import AppSidebar from "../components/AppSidebar";

import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  Map as MapIcon,
  List,
  Shield,
  Activity,
  Clock3,
  CheckCircle2,
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  X,
  Download,
  ExternalLink,
  BadgeInfo,
  Pencil,
  Trash2,
  Loader2,
  BadgeCheck,
  Upload,
  CalendarDays,
  UserRound,
  Phone,
  Users,
  FileText,
  FolderOpen,
  Plus,
  Minus,
} from "lucide-react";

import "leaflet/dist/leaflet.css";
import "../styles/home.css";

const EDIT_STORAGE_KEY = "event_edit_payload";
const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

/* CORREÇÃO DO ÍCONE DO LEAFLET */
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

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

function normalizeToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fmtDate(d) {
  const date = normalizeToDate(d);
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR");
}

function fmtHour(d) {
  const date = normalizeToDate(d);
  if (!date) return "--:--";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(d) {
  const date = normalizeToDate(d);
  if (!date) return "-";
  return date.toLocaleString("pt-BR");
}

function fmtProtocolDate(d) {
  const date = normalizeToDate(d);
  if (!date) return "-";

  const months = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];

  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()] || "";
  const year = date.getFullYear();

  return `${day}${month}.${year}`;
}

function formatEstimatedPublic(value) {
  if (value === null || value === undefined || value === "") {
    return "Não informado";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "Não informado";
  }

  return numericValue.toLocaleString("pt-BR");
}

function fmtEventDateRange(start, end) {
  const startDate = normalizeToDate(start);
  const endDate = normalizeToDate(end);

  if (!startDate && !endDate) return "-";
  if (startDate && !endDate) return fmtDate(startDate);
  if (!startDate && endDate) return fmtDate(endDate);

  const sameDay =
    startDate.getDate() === endDate.getDate() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();

  if (sameDay) return fmtDate(startDate);

  return `${fmtDate(startDate)} a ${fmtDate(endDate)}`;
}

function fmtEventTimeRange(start, end) {
  const startDate = normalizeToDate(start);
  const endDate = normalizeToDate(end);

  if (!startDate && !endDate) return "-";
  if (startDate && !endDate) return fmtHour(startDate);
  if (!startDate && endDate) return fmtHour(endDate);

  return `${fmtHour(startDate)} - ${fmtHour(endDate)}`;
}

function statusLabel(s) {
  const map = {
    ENCERRADO: "Encerrado",
    EM_ANDAMENTO: "Em andamento",
    PREVISTO: "Previsto",
    CANCELADO: "Cancelado",
    SUSPENSO: "Suspenso",
  };
  return map[normalizeStatusKey(s)] || "-";
}

function typeLabel(t) {
  const map = {
    INTEGRADO: "Integrado",
    CENTRALIZADO: "Centralizado",
  };
  return map[String(t || "").toUpperCase()] || "-";
}

function getDocumentExtension(fileName = "") {
  const lower = String(fileName).toLowerCase();

  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "WORD";

  return "DOC";
}

function getDocumentTypeLabel(docItem) {
  const explicitType = normalizeDocumentType(docItem?.documentType, "");

  if (explicitType) {
    return documentTypeLabel(explicitType);
  }

  const name = String(docItem?.fileName || "").toLowerCase();
  const category = String(docItem?.category || "").toLowerCase();
  const type = String(docItem?.type || docItem?.documentType || "").toLowerCase();

  const source = `${name} ${category} ${type}`;

  if (source.includes("plano") || source.includes("planejamento")) {
    return "Plano";
  }

  if (
    source.includes("ordem") ||
    source.includes("operacao") ||
    source.includes("operação") ||
    source.includes("operacoes") ||
    source.includes("operações")
  ) {
    return "Ordem";
  }

  if (source.includes("cronograma")) {
    return "Cronograma";
  }

  if (source.includes("oficio") || source.includes("ofício")) {
    return "Ofício";
  }

  if (source.includes("desdobramento")) {
    return "Desdobramento";
  }

  return "Documento";
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: "DESDOBRAMENTO", label: "Desdobramento" },
  { value: "PLANO", label: "Plano" },
  { value: "ORDEM", label: "Ordem" },
  { value: "CRONOGRAMA", label: "Cronograma" },
  { value: "OFICIO", label: "Ofício" },
  { value: "DOCUMENTO", label: "Documento" },
];

function normalizeDocumentType(value, fallback = "DOCUMENTO") {
  const raw = String(value || "").trim().toUpperCase();

  if (
    raw === "DESDOBRAMENTO" ||
    raw === "PLANO" ||
    raw === "ORDEM" ||
    raw === "CRONOGRAMA" ||
    raw === "OFICIO" ||
    raw === "DOCUMENTO"
  ) {
    return raw;
  }

  return fallback;
}

function getDocumentTypeOptions(origin) {
  const normalizedOrigin = String(origin || "").toUpperCase();

  if (normalizedOrigin === "UNIT") {
    return DOCUMENT_TYPE_OPTIONS;
  }

  return DOCUMENT_TYPE_OPTIONS.filter(
    (item) => item.value !== "DESDOBRAMENTO"
  );
}

function getEffectiveDocumentType(docItem) {
  const origin = String(docItem?.origin || "").toUpperCase();

  if (docItem?.documentType) {
    return normalizeDocumentType(
      docItem.documentType,
      origin === "UNIT" ? "DESDOBRAMENTO" : "DOCUMENTO"
    );
  }

  if (origin === "UNIT") {
    return "DESDOBRAMENTO";
  }

  return normalizeDocumentType(docItem?.category, "DOCUMENTO");
}

function documentTypeLabel(value) {
  const map = {
    DESDOBRAMENTO: "Desdobramento",
    PLANO: "Plano",
    ORDEM: "Ordem",
    CRONOGRAMA: "Cronograma",
    OFICIO: "Ofício",
    DOCUMENTO: "Documento",
  };

  return map[normalizeDocumentType(value, "")] || "Documento";
}



function getEventStartDate(ev) {
  return normalizeToDate(ev.startAt || ev.createdAt);
}

function getEventEndDate(ev) {
  return normalizeToDate(ev.endAt || ev.startAt || ev.createdAt);
}

function getEventRange(ev) {
  let start = getEventStartDate(ev);
  let end = getEventEndDate(ev);

  if (start && end && end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  return { start, end };
}

function getComputedEventStatus(ev, now = new Date()) {
  const rawStatus = normalizeStatusKey(ev?.status);

  if (rawStatus === "CANCELADO") return "CANCELADO";
  if (rawStatus === "SUSPENSO") return "SUSPENSO";

  const { start, end } = getEventRange(ev);
  const eventStart = start || end;
  const eventEnd = end || start;

  if (!eventStart && !eventEnd) {
    return rawStatus === "ENCERRADO" ? "ENCERRADO" : "PREVISTO";
  }

  if (eventStart && now < eventStart) return "PREVISTO";
  if (eventStart && eventEnd && now >= eventStart && now <= eventEnd) {
    return "EM_ANDAMENTO";
  }
  if (eventEnd && now > eventEnd) return "ENCERRADO";

  return rawStatus || "PREVISTO";
}

function getStatusPalette(status) {
  const s = String(status || "").toUpperCase();

  if (s === "EM_ANDAMENTO") {
    return {
      bg: "#dcfce7",
      text: "#166534",
      border: "#86efac",
      dot: "#22c55e",
      marker: "#22c55e",
    };
  }

  if (s === "PREVISTO") {
    return {
      bg: "#dbeafe",
      text: "#1d4ed8",
      border: "#93c5fd",
      dot: "#3b82f6",
      marker: "#3b82f6",
    };
  }

  if (s === "ENCERRADO") {
    return {
      bg: "#fef3c7",
      text: "#92400e",
      border: "#fcd34d",
      dot: "#f59e0b",
      marker: "#f59e0b",
    };
  }

  if (s === "CANCELADO" || s === "SUSPENSO") {
    return {
      bg: "#fee2e2",
      text: "#991b1b",
      border: "#fca5a5",
      dot: "#ef4444",
      marker: "#ef4444",
    };
  }

  return {
    bg: "#f3f4f6",
    text: "#374151",
    border: "#d1d5db",
    dot: "#9ca3af",
    marker: "#9ca3af",
  };
}

function buildCalendarDays(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startWeekDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];

  for (let i = 0; i < startWeekDay; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function sortUnits(a, b) {
  const aLabel = `${getUnitCode(a)} ${getUnitLabel(a)}`.trim();
  const bLabel = `${getUnitCode(b)} ${getUnitLabel(b)}`.trim();
  return aLabel.localeCompare(bLabel, "pt-BR");
}

function sortEventsByPeriodDesc(a, b) {
  const aDate = getEventStartDate(a) || normalizeToDate(a.createdAt);
  const bDate = getEventStartDate(b) || normalizeToDate(b.createdAt);
  return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
}

function collectDescendantIds(unitId, childrenMap, result = new Set()) {
  const children = childrenMap[unitId] || [];

  for (const child of children) {
    if (!result.has(child.id)) {
      result.add(child.id);
      collectDescendantIds(child.id, childrenMap, result);
    }
  }

  return result;
}

function getEventUnitIds(ev) {
  const ids = new Set();

  if (ev.createdByUnitId) ids.add(ev.createdByUnitId);
  if (ev.responsibleUnitId) ids.add(ev.responsibleUnitId);

  if (Array.isArray(ev.responsibleUnitIds)) {
    ev.responsibleUnitIds.forEach((id) => {
      if (id) ids.add(id);
    });
  }

  if (Array.isArray(ev.participantUnitIds)) {
    ev.participantUnitIds.forEach((id) => {
      if (id) ids.add(id);
    });
  }

  if (Array.isArray(ev.involvedUnits)) {
    ev.involvedUnits.forEach((unit) => {
      if (unit?.unitId) ids.add(unit.unitId);
    });
  }

  return ids;
}

function getRootCodeFromPath(path) {
  if (!path) return "";
  return (
    String(path)
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean)[0] || ""
  );
}

function getLeafCodeFromPath(path) {
  if (!path) return "";
  const parts = String(path)
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts[parts.length - 1] || "";
}

function serializeForSession(value) {
  if (value == null) return value;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForSession(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeForSession(item)])
    );
  }

  return value;
}

function serializeEventForEdit(ev) {
  return serializeForSession(ev);
}

function hasRetification(ev) {
  return !!normalizeToDate(ev?.retifiedAt);
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function getUnitCode(unit) {
  return normalizeCode(unit?.code || unit?.sigla || "");
}

function getUnitLabel(unit) {
  return String(unit?.name || unit?.sigla || unit?.code || "UNIDADE").trim();
}

function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function chunkArray(arr = [], size = 10) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function getCurrentUserPermissions(user, claims) {
  const orderedUnitIds = [
    ...toArray(claims?.unitId),
    ...toArray(claims?.currentUnitId),
    ...toArray(claims?.unitIds),
    ...toArray(claims?.accessScopeUnitIds),

    ...toArray(user?.unitId),
    ...toArray(user?.currentUnitId),
    ...toArray(user?.unitIds),
    ...toArray(user?.accessScopeUnitIds),
    ...toArray(user?.ancestorUnitIds),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const orderedUnitCodes = [
    ...toArray(claims?.unitCode),
    ...toArray(claims?.command),
    ...toArray(claims?.unitCodes),
    ...toArray(claims?.commands),
    ...toArray(claims?.accessScopeUnitCodes),

    ...toArray(user?.unitCode),
    ...toArray(user?.sigla),
    ...toArray(user?.unitCodes),
    ...toArray(user?.accessScopeUnitCodes),
  ]
    .map((item) => normalizeCode(item))
    .filter(Boolean);

  const unitIds = new Set(orderedUnitIds);
  const unitCodes = new Set(orderedUnitCodes);

  const roleTexts = [
    ...toArray(claims?.role),
    ...toArray(claims?.roles),
    ...toArray(claims?.profile),
    ...toArray(claims?.accessProfile),
    ...toArray(claims?.systemRole),

    ...toArray(user?.role),
    ...toArray(user?.roles),
    ...toArray(user?.profile),
    ...toArray(user?.accessProfile),
    ...toArray(user?.systemRole),
    ...toArray(user?.funcao),
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const primaryRole = normalizeText(claims?.role || user?.role || "");
  const primarySystemRole = normalizeText(
    claims?.systemRole || user?.systemRole || ""
  );
  const primaryAccessProfile = normalizeText(
    claims?.accessProfile ||
      user?.accessProfile ||
      claims?.profile ||
      user?.profile ||
      ""
  );

  const isAdminUser =
    roleTexts.includes("ADMIN") ||
    roleTexts.includes("AIO_ADMIN") ||
    roleTexts.includes("SUPER_ADMIN");

  const isAIOUser =
    roleTexts.includes("AIO") ||
    roleTexts.includes("AIO_ADMIN") ||
    roleTexts.some(
      (role) =>
        role.includes("ASSESSORIA DE INTEGRACAO OPERACIONAL") ||
        role.includes("ASSESSORIA DE INTEGRACAO") ||
        role === "AIO"
    ) ||
    unitCodes.has("AIO");

  const isOperationalProfile =
    primaryRole === "UNIDADE_OPERACIONAL" ||
    primarySystemRole === "UNIDADE_OPERACIONAL" ||
    primaryAccessProfile === "UNIDADE_OPERACIONAL";

  const isGestoraProfile =
    !isOperationalProfile &&
    (
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("UNIDADE_GESTORA") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("COMANDO") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("COMANDO_GERAL") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("UNIT_MANAGER") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("P3") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("P-3") ||
      [
        primaryRole,
        primarySystemRole,
        primaryAccessProfile,
      ].includes("AUXILIAR_P3")
    );

  const canReadAll =
    claims?.canViewAll === true ||
    user?.permissions?.canViewAll === true ||
    isAdminUser ||
    isAIOUser;

  const canManageAll =
    claims?.canEditAll === true ||
    user?.permissions?.canEditAll === true ||
    isAdminUser ||
    isAIOUser;

  return {
    unitIds,
    unitCodes,
    activeUnitId: orderedUnitIds[0] || "",
    activeUnitCode: orderedUnitCodes[0] || "",
    isAIOUser,
    isAdminUser,
    isGestoraProfile,
    isOperationalProfile,
    usesScopeVisibility: canReadAll || isGestoraProfile,
    canReadAll,
    canManageAll,
    isGlobalReader: canReadAll,
  };
}

function canManageEvent(ev, permissions, user) {
  if (!ev) return false;
  if (permissions.canManageAll) return true;

  if (user?.uid && ev.createdByUid && ev.createdByUid === user.uid) {
    return true;
  }

  if (
    user?.email &&
    ev.createdByEmail &&
    String(ev.createdByEmail).toLowerCase() === String(user.email).toLowerCase()
  ) {
    return true;
  }

  if (ev.createdByUnitId && permissions.unitIds.has(ev.createdByUnitId)) {
    return true;
  }

  if (
    normalizeCode(ev.createdByUnitCode) &&
    permissions.unitCodes.has(normalizeCode(ev.createdByUnitCode))
  ) {
    return true;
  }

  return false;
}

function canShowTopEventActionsForEvent(ev, permissions, user, directUnitIdentity = {}) {
  if (!ev) return false;
  if (permissions.canManageAll || permissions.isAIOUser) return true;

  const creatorUnitId = String(ev?.createdByUnitId || "").trim();
  const creatorUnitCode = normalizeCode(ev?.createdByUnitCode);
  const directUnitId = String(
    directUnitIdentity?.unitId || permissions.activeUnitId || ""
  ).trim();
  const directUnitCode = normalizeCode(
    directUnitIdentity?.unitCode || permissions.activeUnitCode || ""
  );

  if (directUnitId && creatorUnitId && directUnitId === creatorUnitId) {
    return true;
  }

  if (directUnitCode && creatorUnitCode && directUnitCode === creatorUnitCode) {
    return true;
  }

  if (user?.uid && ev?.createdByUid && String(ev.createdByUid) === String(user.uid)) {
    return true;
  }

  if (
    user?.email &&
    ev?.createdByEmail &&
    String(ev.createdByEmail).toLowerCase() === String(user.email).toLowerCase()
  ) {
    return true;
  }

  return false;
}

function canManageDocument(docItem, permissions, user, directUnitIdentity = {}) {
  if (!docItem) return false;
  if (permissions.canManageAll) return true;

  const origin = String(docItem.origin || "").toUpperCase();
  if (origin !== "UNIT") return false;

  const uploaderUid = String(docItem.uploadedByUid || "").trim();
  const uploaderEmail = String(docItem.uploadedByEmail || "").trim().toLowerCase();
  const currentUid = String(user?.uid || "").trim();
  const currentEmail = String(user?.email || "").trim().toLowerCase();

  const directUnitId = String(
    directUnitIdentity?.unitId || permissions.activeUnitId || ""
  ).trim();
  const directUnitCode = normalizeCode(
    directUnitIdentity?.unitCode || permissions.activeUnitCode || ""
  );

  const documentUnitId = String(docItem.unitId || "").trim();
  const documentUnitCode = normalizeCode(docItem.unitCode);

  const isOwnUpload =
    (currentUid && uploaderUid && uploaderUid === currentUid) ||
    (currentEmail && uploaderEmail && uploaderEmail === currentEmail);

  const isOwnUnitDocument =
    (directUnitId && documentUnitId && documentUnitId === directUnitId) ||
    (directUnitCode && documentUnitCode && documentUnitCode === directUnitCode);

  // A unidade operacional só gerencia arquivos da própria unidade.
  if (isOwnUpload || isOwnUnitDocument) {
    return true;
  }

  // Somente a gestora (ou AIO/ADM via canManageAll acima) pode gerenciar
  // arquivos das subordinadas dentro do seu escopo.
  if (!permissions.isGestoraProfile) {
    return false;
  }

  if (documentUnitId && permissions.unitIds.has(documentUnitId)) {
    return true;
  }

  if (documentUnitCode && permissions.unitCodes.has(documentUnitCode)) {
    return true;
  }

  return false;
}

function shouldKeepDeletedDocumentVisible() {
  return false;
}

function canOpenDocument(docItem, permissions) {
  if (!docItem?.isDeleted) return true;
  return permissions.isGlobalReader;
}

function isAllowedDocumentFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx");
}

function sanitizeFileName(name) {
  return String(name || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}


function sanitizeStorageToken(value) {
  return normalizeCode(value)
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9._-]/g, "");
}

function isStorageUnauthorizedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    code.includes("storage/unauthorized") ||
    code.includes("permission-denied") ||
    message.includes("storage/unauthorized") ||
    message.includes("missing or insufficient permissions") ||
    message.includes("does not have permission")
  );
}

function buildStorageUploadCandidatePaths({
  eventId,
  fileName,
  category = "DOCUMENTO",
  documentType = "",
  unitKey = "",
}) {
  const safeName = sanitizeFileName(fileName);
  const timestamp = Date.now();
  const safeCategory = sanitizeStorageToken(category) || "DOCUMENTO";
  const safeType = sanitizeStorageToken(documentType);
  const safeUnit = sanitizeStorageToken(unitKey);

  if (safeCategory === "DESDOBRAMENTO") {
    const targetUnitFolder = safeUnit || "UNIDADE";
    return [
      `events/${eventId}/documents/desdobramentos/${targetUnitFolder}/${timestamp}_${safeName}`,
    ];
  }

  const typePrefix = safeType || safeCategory;
  const candidates = [
    `events/${eventId}/documents/planejamento/${timestamp}_${safeName}`,
    `events/${eventId}/documents/${typePrefix}_${timestamp}_${safeName}`,
    `events/${eventId}/${typePrefix}_${timestamp}_${safeName}`,
  ];

  return Array.from(new Set(candidates.filter(Boolean)));
}

async function uploadDocumentToStorageWithFallback(file, candidates) {
  let lastError = null;
  const attemptedPaths = [];

  for (const candidatePath of toArray(candidates)) {
    try {
      const storageRef = ref(storage, candidatePath);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      return {
        storagePath: candidatePath,
        downloadURL,
        attemptedPaths: [...attemptedPaths, candidatePath],
      };
    } catch (error) {
      lastError = error;
      attemptedPaths.push(candidatePath);

      if (!isStorageUnauthorizedError(error)) {
        error.attemptedStoragePaths = attemptedPaths;
        throw error;
      }
    }
  }

  if (lastError) {
    lastError.attemptedStoragePaths = attemptedPaths;
  }

  throw lastError || new Error("Não foi possível enviar o arquivo para o Storage.");
}

function upsertEmbeddedDesdobramentoEntry(entries, nextEntry) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const nextUnitId = String(nextEntry?.unitId || "").trim();
  const nextUnitCode = normalizeCode(nextEntry?.unitCode);

  const filteredEntries = safeEntries.filter((entry) => {
    const isDesdobramento =
      String(entry?.category || "").toUpperCase() === "DESDOBRAMENTO" ||
      String(entry?.origin || "").toUpperCase() === "UNIT";

    if (!isDesdobramento) return true;

    const sameUnitById =
      nextUnitId && String(entry?.unitId || "").trim() === nextUnitId;
    const sameUnitByCode =
      nextUnitCode && normalizeCode(entry?.unitCode) === nextUnitCode;

    return !(sameUnitById || sameUnitByCode);
  });

  return [nextEntry, ...filteredEntries].sort((a, b) => {
    const dateA = normalizeToDate(a?.uploadedAt || a?.updatedAt || a?.createdAt);
    const dateB = normalizeToDate(b?.uploadedAt || b?.updatedAt || b?.createdAt);
    return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
  });
}

function hasDocumentRetification(docItem) {
  const type = String(docItem?.lastRetificationType || "").toUpperCase();

  return (
    type === "UPDATED_FILE" ||
    type === "NEW_FILE" ||
    type === "DELETED_FILE" ||
    !!docItem?.addedInRetification ||
    !!normalizeToDate(docItem?.retifiedAt) ||
    !!normalizeToDate(docItem?.replacedAt) ||
    !!normalizeToDate(docItem?.deletedAt)
  );
}

function getDocumentRetificationDate(docItem) {
  return (
    normalizeToDate(docItem?.retifiedAt) ||
    normalizeToDate(docItem?.replacedAt) ||
    normalizeToDate(docItem?.addedInRetificationAt) ||
    normalizeToDate(docItem?.deletedAt)
  );
}

function eventMatchesSelectedRange(ev, from, to) {
  const { start, end } = getEventRange(ev);
  const eventStart = start || end;
  const eventEnd = end || start;

  if (!eventStart || !eventEnd) return false;

  if (from) {
    const parsedFrom = parseDateInputValue(from);
    if (parsedFrom) {
      const fromDate = startOfDay(parsedFrom);
      if (eventEnd < fromDate) return false;
    }
  }

  if (to) {
    const parsedTo = parseDateInputValue(to);
    if (parsedTo) {
      const toDate = endOfDay(parsedTo);
      if (eventStart > toDate) return false;
    }
  }

  return true;
}

function eventOccursOnDay(ev, day) {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const { start, end } = getEventRange(ev);
  const eventStart = start || end;
  const eventEnd = end || start;

  if (!eventStart || !eventEnd) return false;

  return eventStart <= dayEnd && eventEnd >= dayStart;
}

function isSameDay(a, b) {
  const da = normalizeToDate(a);
  const db = normalizeToDate(b);
  if (!da || !db) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isDayInsideRange(day, from, to) {
  const current = normalizeToDate(day);
  const start = parseDateInputValue(from);
  const end = parseDateInputValue(to);

  if (!current || !start || !end) return false;

  const currentTime = startOfDay(current).getTime();
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();

  const min = Math.min(startTime, endTime);
  const max = Math.max(startTime, endTime);

  return currentTime >= min && currentTime <= max;
}

function buildOrderedDateRange(a, b) {
  const da = startOfDay(a);
  const db = startOfDay(b);

  if (da.getTime() <= db.getTime()) return [a, b];
  return [b, a];
}

function getEventCoordinates(ev) {
  const rawLat = ev?.lat ?? ev?.locationMeta?.lat ?? null;
  const rawLng = ev?.lng ?? ev?.locationMeta?.lng ?? null;

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return [lat, lng];
}

function hexToRgba(hex, alpha = 1) {
  const clean = String(hex || "").replace("#", "");
  const normalized =
    clean.length === 3
      ? clean
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : clean;

  const int = Number.parseInt(normalized, 16);
  if (Number.isNaN(int)) return `rgba(0,0,0,${alpha})`;

  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getPinMarkerIcon(status, selected = false) {
  const palette = getStatusPalette(status);
  const isPulsing = status === "EM_ANDAMENTO";

  const pinWidth = selected ? 42 : 36;
  const pinHeight = selected ? 56 : 48;
  const pulseSize = selected ? 42 : 36;
  const pulseTop = selected ? 17 : 15;

  return L.divIcon({
    className: "eventPinMarkerIcon",
    html: `
      <div
        class="eventPinMarker ${selected ? "isSelected" : ""} ${
      isPulsing ? "isPulsing" : ""
    }"
        style="
          --pin-color: ${palette.marker};
          --pulse-color: ${hexToRgba(palette.marker, 0.26)};
          --pin-width: ${pinWidth}px;
          --pin-height: ${pinHeight}px;
          --pulse-size: ${pulseSize}px;
          --pulse-top: ${pulseTop}px;
        "
      >
        ${
          isPulsing
            ? `
          <span class="eventPinPulse"></span>
          <span class="eventPinPulse eventPinPulseDelayed"></span>
        `
            : ""
        }

        <span class="eventPinSvgWrap">
          <svg
            viewBox="0 0 64 84"
            width="${pinWidth}"
            height="${pinHeight}"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M32 2C15.431 2 2 15.431 2 32c0 9.882 4.625 19.202 11.241 28.196C19.857 69.189 27.985 78.949 32 82c4.015-3.051 12.143-12.811 18.759-21.804C57.375 51.202 62 41.882 62 32 62 15.431 48.569 2 32 2z"
              fill="var(--pin-color)"
            />
            <circle cx="32" cy="31" r="12.5" fill="#ffffff" />
            <path
              d="M51.5 13.5c-5.2-5.7-11.8-8.5-19.8-8.5-6.8 0-12.8 2.3-18 6.9 5.7-3.2 11.2-4.8 16.5-4.8 9.7 0 17.8 3.4 24.1 10.2 0-1.6-1-2.9-2.8-3.8z"
              fill="rgba(255,255,255,0.18)"
            />
            <path
              d="M46.5 50.5L31.9 81.4c3.8-3 11.5-12.1 17.7-20.5 1.1-1.4 2-2.8 2.9-4.2z"
              fill="rgba(0,0,0,0.08)"
            />
          </svg>
        </span>
      </div>
    `,
    iconSize: [pinWidth, pinHeight],
    iconAnchor: [pinWidth / 2, pinHeight],
    tooltipAnchor: [0, -pinHeight + 10],
  });
}

function isGenericUnitDescriptor(value) {
  const normalized = normalizeText(value);
  return (
    normalized === "UNIDADE" ||
    normalized === "ORIGEM" ||
    normalized === "UNIDADE GESTORA" ||
    normalized === "UNIDADE GERADORA" ||
    normalized === "UNIDADE DE ORIGEM"
  );
}

function getEventOriginUnit(ev, unitMap = {}) {
  if (!ev) return null;

  const createdUnitById = ev?.createdByUnitId ? unitMap?.[ev.createdByUnitId] || null : null;
  const pathCode = normalizeCode(getLeafCodeFromPath(ev?.unitPath));
  const rawCreatedCode = normalizeCode(ev?.createdByUnitCode);
  const resolvedUnitByCode =
    createdUnitById ||
    Object.values(unitMap || {}).find((unit) => {
      const unitCode = getUnitCode(unit);
      return unitCode && (unitCode === rawCreatedCode || unitCode === pathCode);
    }) ||
    null;

  const code =
    rawCreatedCode ||
    getUnitCode(createdUnitById) ||
    getUnitCode(resolvedUnitByCode) ||
    (String(ev.originType || "").toUpperCase() === "AIO" ? "AIO" : "") ||
    pathCode;

  const explicitName = String(ev.createdByUnitName || "").trim();
  const resolvedName =
    getUnitLabel(createdUnitById) ||
    getUnitLabel(resolvedUnitByCode) ||
    "";

  const name =
    (explicitName && !isGenericUnitDescriptor(explicitName) ? explicitName : "") ||
    resolvedName ||
    (code === "AIO" ? "Assessoria de Integração Operacional" : "");

  if (!code && !name) return null;

  return {
    key: `origin:${ev.createdByUnitId || code || name}`,
    unitId: ev.createdByUnitId || createdUnitById?.id || resolvedUnitByCode?.id || null,
    code,
    name,
    isOrigin: true,
    label: code ? `Origem • ${code}` : `Origem • ${name}`,
  };
}

function getEventInvolvedUnits(ev) {
  const map = new Map();

  function pushUnit(unit) {
    const unitId = String(unit?.unitId || unit?.id || "").trim() || null;
    const code = normalizeCode(
      unit?.code || unit?.unitCode || unit?.sigla || getLeafCodeFromPath(unit?.unitPath)
    );
    const name = String(unit?.name || unit?.unitName || "").trim();

    const key = unitId || code || name;
    if (!key) return;

    if (!map.has(key)) {
      map.set(key, {
        key,
        unitId,
        code,
        name,
        isOrigin: false,
        label: code || name || "UNIDADE",
      });
    }
  }

  if (Array.isArray(ev?.involvedUnits) && ev.involvedUnits.length > 0) {
    ev.involvedUnits.forEach(pushUnit);
  } else {
    if (Array.isArray(ev?.responsibleUnits)) {
      ev.responsibleUnits.forEach(pushUnit);
    }
  }

  return Array.from(map.values());
}

function buildEventUnitBadges(ev, unitMap = {}) {
  if (!ev) return [];

  const result = [];
  const seen = new Set();

  const origin = getEventOriginUnit(ev, unitMap);
  if (origin) {
    const originKey = origin.unitId || origin.code || origin.name;
    seen.add(originKey);
    result.push(origin);
  }

  const involved = getEventInvolvedUnits(ev);
  involved.forEach((unit) => {
    const key = unit.unitId || unit.code || unit.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(unit);
  });

  return result;
}

function getDesdobramentoUnitCodes(documents) {
  const codes = new Set();

  for (const docItem of documents || []) {
    if (String(docItem.origin || "").toUpperCase() !== "UNIT") continue;
    if (docItem.isDeleted) continue;

    const code = normalizeCode(
      docItem.unitCode || getLeafCodeFromPath(docItem.unitPath)
    );

    if (code) codes.add(code);
  }

  return codes;
}

function getDesdobramentoUnitState(documents) {
  const unitIds = new Set();
  const unitCodes = new Set();

  for (const docItem of documents || []) {
    if (!shouldCountDocumentAsUnitDelivery(docItem)) continue;

    const unitId = getDocumentLinkedUnitId(docItem);
    const unitCode = getDocumentLinkedUnitCode(docItem);

    if (unitId) unitIds.add(unitId);
    if (unitCode) unitCodes.add(unitCode);
  }

  return { unitIds, unitCodes };
}

function getRequestedSubordinateUnitsFromSources(eventData, documents = []) {
  const unitIds = new Set();
  const unitCodes = new Set();
  const unitNames = new Map();

  const sourceDocs = [
    ...toArray(documents),
    ...toArray(eventData?.desdobramentos),
  ];

  sourceDocs.forEach((docItem) => {
    if (!docItem) return;

    const origin = getDocumentOriginValue(
      docItem,
      String(docItem?.category || "").toUpperCase() === "DESDOBRAMENTO"
        ? "UNIT"
        : ""
    );

    if (origin !== "UNIT") return;

    toArray(docItem?.requestedSubordinateUnitIds).forEach((id) => {
      const value = String(id || "").trim();
      if (value) unitIds.add(value);
    });

    toArray(docItem?.requestedSubordinateUnitCodes).forEach((code) => {
      const value = normalizeCode(code);
      if (value) unitCodes.add(value);
    });

    if (Array.isArray(docItem?.requestedSubordinateUnits)) {
      docItem.requestedSubordinateUnits.forEach((unit) => {
        const unitId = String(unit?.unitId || unit?.id || "").trim();
        const unitCode = normalizeCode(
          unit?.unitCode || unit?.code || unit?.sigla || ""
        );
        const unitName = String(unit?.unitName || unit?.name || "").trim();

        if (unitId) unitIds.add(unitId);
        if (unitCode) unitCodes.add(unitCode);
        if (unitId || unitCode) {
          unitNames.set(unitId || unitCode, unitName || unitCode || "UNIDADE");
        }
      });
    }
  });

  return {
    unitIds: Array.from(unitIds),
    unitCodes: Array.from(unitCodes),
    unitNames,
  };
}

function buildRequestedSubordinateUnitsPayload(units = []) {
  const safeUnits = Array.isArray(units) ? units.filter(Boolean) : [];
  const unitIds = [];
  const unitCodes = [];
  const unitNames = [];
  const detailedUnits = [];

  safeUnits.forEach((unit) => {
    const unitId = String(unit?.id || unit?.unitId || "").trim();
    const unitCode = getUnitCode(unit);
    const unitName = getUnitLabel(unit);

    if (unitId) unitIds.push(unitId);
    if (unitCode) unitCodes.push(unitCode);
    if (unitName) unitNames.push(unitName);

    detailedUnits.push({
      id: unitId || null,
      unitId: unitId || null,
      unitCode: unitCode || null,
      code: unitCode || null,
      sigla: unitCode || null,
      unitName: unitName || null,
      name: unitName || null,
      parentUnitId: unit?.parentUnitId || null,
    });
  });

  return {
    requestedSubordinateUnitIds: Array.from(new Set(unitIds)),
    requestedSubordinateUnitCodes: Array.from(new Set(unitCodes)),
    requestedSubordinateUnitNames: Array.from(new Set(unitNames)),
    requestedSubordinateUnits: detailedUnits,
  };
}

function getRequestedSubordinateBadges(docItem, unitMap = {}) {
  const map = new Map();

  const pushUnit = (unitLike = {}) => {
    const unitId = String(unitLike?.unitId || unitLike?.id || "").trim();
    const unitCode = normalizeCode(
      unitLike?.unitCode || unitLike?.code || unitLike?.sigla || ""
    );

    const resolvedUnit =
      (unitId && unitMap?.[unitId]) ||
      Object.values(unitMap || {}).find((unit) => getUnitCode(unit) === unitCode) ||
      null;

    const finalId = unitId || resolvedUnit?.id || "";
    const finalCode = unitCode || getUnitCode(resolvedUnit);
    const finalName =
      String(
        unitLike?.unitName ||
          unitLike?.name ||
          resolvedUnit?.name ||
          resolvedUnit?.sigla ||
          finalCode ||
          "UNIDADE"
      ).trim() || "UNIDADE";

    const key = finalId || finalCode || finalName;
    if (!key) return;

    map.set(key, {
      key,
      unitId: finalId || null,
      code: finalCode || null,
      name: finalName,
    });
  };

  toArray(docItem?.requestedSubordinateUnits).forEach(pushUnit);

  toArray(docItem?.requestedSubordinateUnitIds).forEach((unitId) => {
    pushUnit(unitMap?.[String(unitId || "").trim()] || { id: unitId });
  });

  toArray(docItem?.requestedSubordinateUnitCodes).forEach((unitCode) => {
    const normalizedCode = normalizeCode(unitCode);
    const resolvedUnit = Object.values(unitMap || {}).find(
      (unit) => getUnitCode(unit) === normalizedCode
    );

    pushUnit(resolvedUnit || { code: normalizedCode });
  });

  toArray(docItem?.requestedSubordinateUnitNames).forEach((unitName) => {
    const normalizedName = String(unitName || "").trim();
    if (!normalizedName) return;

    const resolvedUnit = Object.values(unitMap || {}).find(
      (unit) => getUnitLabel(unit) === normalizedName
    );

    pushUnit(resolvedUnit || { name: normalizedName });
  });

  return Array.from(map.values()).sort((a, b) => {
    const aLabel = `${a.code || ""} ${a.name || ""}`.trim();
    const bLabel = `${b.code || ""} ${b.name || ""}`.trim();
    return aLabel.localeCompare(bLabel, "pt-BR");
  });
}

function documentMatchesRequestedSubordinate(docItem, subordinateBadge = {}) {
  if (!docItem || docItem?.isDeleted) return false;

  const docUnitId = getDocumentLinkedUnitId(docItem);
  const docUnitCode = getDocumentLinkedUnitCode(docItem);

  const badgeUnitId = String(subordinateBadge?.unitId || "").trim();
  const badgeUnitCode = normalizeCode(subordinateBadge?.code);

  return (
    (badgeUnitId && docUnitId === badgeUnitId) ||
    (badgeUnitCode && docUnitCode === badgeUnitCode)
  );
}

function buildRequestedSubordinateTree(docItem, documents = [], unitMap = {}) {
  const requestedBadges = getRequestedSubordinateBadges(docItem, unitMap);

  return requestedBadges.map((badge) => {
    const childDocument =
      toArray(documents).find(
        (candidate) =>
          candidate &&
          candidate.id !== docItem?.id &&
          !candidate?.isDeleted &&
          documentMatchesRequestedSubordinate(candidate, badge)
      ) || null;

    return {
      key: `${docItem?.id || "doc"}-${badge.key}`,
      badge,
      document: childDocument,
      hasDocument: !!childDocument,
    };
  });
}



function getEventDirectTargetUnitIds(ev, documents = []) {
  const ids = new Set();

  toArray(ev?.responsibleUnitIds).forEach((id) => {
    if (id) ids.add(String(id).trim());
  });

  toArray(ev?.participantUnitIds).forEach((id) => {
    if (id) ids.add(String(id).trim());
  });

  if (ev?.responsibleUnitId) {
    ids.add(String(ev.responsibleUnitId).trim());
  }

  if (Array.isArray(ev?.involvedUnits)) {
    ev.involvedUnits.forEach((unit) => {
      if (unit?.unitId) ids.add(String(unit.unitId).trim());
    });
  }

  if (!ids.size && Array.isArray(ev?.responsibleUnits)) {
    ev.responsibleUnits.forEach((unit) => {
      if (unit?.unitId) ids.add(String(unit.unitId).trim());
    });
  }

  getRequestedSubordinateUnitsFromSources(ev, documents).unitIds.forEach((id) => {
    if (id) ids.add(String(id).trim());
  });

  return ids;
}

function getEventDirectTargetUnitCodes(ev, documents = []) {
  const codes = new Set();

  const pushCode = (value) => {
    const code = normalizeCode(value);
    if (code) codes.add(code);
  };

  pushCode(ev?.responsibleUnitCode);
  pushCode(ev?.participantUnitCode);

  toArray(ev?.responsibleUnitCodes).forEach(pushCode);
  toArray(ev?.participantUnitCodes).forEach(pushCode);

  if (Array.isArray(ev?.involvedUnits)) {
    ev.involvedUnits.forEach((unit) => {
      pushCode(unit?.code || unit?.unitCode || unit?.sigla || getLeafCodeFromPath(unit?.unitPath));
    });
  }

  if (!codes.size && Array.isArray(ev?.responsibleUnits)) {
    ev.responsibleUnits.forEach((unit) => {
      pushCode(unit?.code || unit?.unitCode || unit?.sigla || getLeafCodeFromPath(unit?.unitPath));
    });
  }

  getRequestedSubordinateUnitsFromSources(ev, documents).unitCodes.forEach(pushCode);

  return codes;
}


function getProfileScopeUnitIds(user, claims, permissions) {
  return Array.from(
    new Set(
      [
        String(user?.unitId || "").trim(),
        String(user?.currentUnitId || "").trim(),
        String(claims?.unitId || "").trim(),
        String(claims?.currentUnitId || "").trim(),
        String(permissions?.activeUnitId || "").trim(),
        ...toArray(user?.unitIds).map((id) => String(id || "").trim()),
        ...toArray(user?.accessScopeUnitIds).map((id) => String(id || "").trim()),
        ...toArray(claims?.unitIds).map((id) => String(id || "").trim()),
        ...toArray(claims?.accessScopeUnitIds).map((id) => String(id || "").trim()),
        ...Array.from(permissions?.unitIds || []).map((id) => String(id || "").trim()),
      ].filter(Boolean)
    )
  );
}

function getProfileScopeUnitCodes(user, claims, permissions, unitMap) {
  const codes = new Set(
    [
      user?.unitCode,
      user?.sigla,
      claims?.unitCode,
      claims?.command,
      permissions?.activeUnitCode,
      ...toArray(user?.unitCodes),
      ...toArray(user?.accessScopeUnitCodes),
      ...toArray(claims?.unitCodes),
      ...toArray(claims?.accessScopeUnitCodes),
      ...Array.from(permissions?.unitCodes || []),
    ]
      .map((value) => normalizeCode(value))
      .filter(Boolean)
  );

  getProfileScopeUnitIds(user, claims, permissions).forEach((unitId) => {
    const unit = unitMap?.[unitId];
    const code = getUnitCode(unit);
    if (code) codes.add(code);
  });

  return Array.from(codes);
}

function getEventDirectTargetUnits(ev, units, unitMap) {
  const rows = [];
  const seen = new Set();
  const unitList = Array.isArray(units) ? units : [];

  const pushUnit = (unitLike) => {
    const unitId = String(unitLike?.unitId || unitLike?.id || "").trim();
    const unitCode = normalizeCode(
      unitLike?.code ||
        unitLike?.unitCode ||
        unitLike?.sigla ||
        getLeafCodeFromPath(unitLike?.unitPath)
    );

    let resolvedUnit = null;

    if (unitId && unitMap?.[unitId]) {
      resolvedUnit = unitMap[unitId];
    }

    if (!resolvedUnit && unitCode) {
      resolvedUnit =
        unitList.find((unit) => getUnitCode(unit) === unitCode) || null;
    }

    const finalUnit =
      resolvedUnit ||
      {
        id: unitId || unitCode,
        code: unitCode,
        name:
          String(
            unitLike?.name ||
              unitLike?.unitName ||
              unitLike?.label ||
              unitCode ||
              "UNIDADE"
          ).trim() || "UNIDADE",
        parentUnitId: unitLike?.parentUnitId || null,
      };

    const key = String(finalUnit?.id || unitId || unitCode || "").trim();
    if (!key || seen.has(key)) return;

    seen.add(key);
    rows.push(finalUnit);
  };

  toArray(ev?.responsibleUnits).forEach(pushUnit);
  toArray(ev?.participantUnits).forEach(pushUnit);
  toArray(ev?.involvedUnits).forEach(pushUnit);
  toArray(ev?.targetUnits).forEach(pushUnit);

  Array.from(getEventDirectTargetUnitIds(ev)).forEach((unitId) => {
    pushUnit({ id: unitId });
  });

  [
    ...toArray(ev?.targetUnitIds),
    ...toArray(ev?.involvedUnitIds),
  ].forEach((unitId) => {
    pushUnit({ id: unitId });
  });

  Array.from(getEventDirectTargetUnitCodes(ev)).forEach((unitCode) => {
    pushUnit({ code: unitCode });
  });

  [
    ...toArray(ev?.targetUnitCodes),
    ...toArray(ev?.involvedUnitCodes),
  ].forEach((unitCode) => {
    pushUnit({ code: unitCode });
  });

  return rows.sort(sortUnits);
}

function buildEventUnitsInvolvementPatch(eventData, unitsToInclude = []) {
  const safeUnits = Array.isArray(unitsToInclude) ? unitsToInclude.filter(Boolean) : [];

  const existingInvolvedUnits = Array.isArray(eventData?.involvedUnits)
    ? [...eventData.involvedUnits]
    : [];

  const involvedUnitIds = new Set(
    toArray(eventData?.involvedUnitIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  const involvedUnitCodes = new Set(
    toArray(eventData?.involvedUnitCodes)
      .map((code) => normalizeCode(code))
      .filter(Boolean)
  );

  const visibleToUnitIds = new Set(
    toArray(eventData?.visibleToUnitIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  const visibleToUnitCodes = new Set(
    toArray(eventData?.visibleToUnitCodes)
      .map((code) => normalizeCode(code))
      .filter(Boolean)
  );

  const addedUnits = [];

  safeUnits.forEach((unit) => {
    const unitId = String(unit?.id || unit?.unitId || "").trim();
    const unitCode = getUnitCode(unit);
    const unitName = getUnitLabel(unit);

    const alreadyIncluded =
      (unitId && involvedUnitIds.has(unitId)) ||
      (unitCode && involvedUnitCodes.has(unitCode)) ||
      existingInvolvedUnits.some((existing) => {
        const existingId = String(existing?.unitId || existing?.id || "").trim();
        const existingCode = normalizeCode(existing?.code || existing?.unitCode || existing?.sigla);
        return (unitId && existingId === unitId) || (unitCode && existingCode === unitCode);
      });

    if (!alreadyIncluded) {
      existingInvolvedUnits.push({
        unitId: unitId || null,
        code: unitCode || null,
        unitCode: unitCode || null,
        sigla: unitCode || null,
        name: unitName || null,
        unitName: unitName || null,
        parentUnitId: unit?.parentUnitId || null,
      });
      addedUnits.push(unit);
    }

    if (unitId) {
      involvedUnitIds.add(unitId);
      visibleToUnitIds.add(unitId);
    }

    if (unitCode) {
      involvedUnitCodes.add(unitCode);
      visibleToUnitCodes.add(unitCode);
    }
  });

  return {
    patch: {
      involvedUnits: existingInvolvedUnits,
      involvedUnitIds: Array.from(involvedUnitIds),
      involvedUnitCodes: Array.from(involvedUnitCodes),
      visibleToUnitIds: Array.from(visibleToUnitIds),
      visibleToUnitCodes: Array.from(visibleToUnitCodes),
    },
    addedUnits,
  };
}

function eventMatchesProfileScope(ev, unitIds = [], unitCodes = []) {
  if (!ev) return false;

  const scopedIds = new Set(
    toArray(unitIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  const scopedCodes = new Set(
    toArray(unitCodes)
      .map((code) => normalizeCode(code))
      .filter(Boolean)
  );

  const eventUnitIds = new Set([
    ...Array.from(getEventUnitIds(ev) || []),
    ...Array.from(getEventDirectTargetUnitIds(ev) || []),
    ...toArray(ev?.visibleToUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.targetUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.involvedUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.responsibleUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.participantUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.accessScopeUnitIds).map((id) => String(id || "").trim()),
  ]);

  const eventUnitCodes = new Set(
    [
      normalizeCode(ev?.createdByUnitCode),
      normalizeCode(ev?.responsibleUnitCode),
      normalizeCode(ev?.participantUnitCode),
      ...Array.from(getEventDirectTargetUnitCodes(ev) || []),
      ...toArray(ev?.visibleToUnitCodes),
      ...toArray(ev?.targetUnitCodes),
      ...toArray(ev?.involvedUnitCodes),
      ...toArray(ev?.responsibleUnitCodes),
      ...toArray(ev?.participantUnitCodes),
      ...toArray(ev?.accessScopeUnitCodes),
    ]
      .map((code) => normalizeCode(code))
      .filter(Boolean)
  );

  for (const id of scopedIds) {
    if (eventUnitIds.has(id)) return true;
  }

  for (const code of scopedCodes) {
    if (eventUnitCodes.has(code)) return true;
  }

  const unitPath = String(ev?.unitPath || "");
  for (const code of scopedCodes) {
    if (code && unitPath.includes(code)) return true;
  }

  return false;
}

function eventMatchesDirectLinkedUnit(ev, unitId = "", unitCode = "") {
  if (!ev) return false;

  const normalizedUnitId = String(unitId || "").trim();
  const normalizedUnitCode = normalizeCode(unitCode);

  const eventUnitIds = new Set([
    ...Array.from(getEventUnitIds(ev) || []),
    ...Array.from(getEventDirectTargetUnitIds(ev) || []),
    ...toArray(ev?.visibleToUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.targetUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.involvedUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.responsibleUnitIds).map((id) => String(id || "").trim()),
    ...toArray(ev?.participantUnitIds).map((id) => String(id || "").trim()),
  ]);

  const eventUnitCodes = new Set(
    [
      normalizeCode(ev?.createdByUnitCode),
      normalizeCode(ev?.responsibleUnitCode),
      normalizeCode(ev?.participantUnitCode),
      ...Array.from(getEventDirectTargetUnitCodes(ev) || []),
      ...toArray(ev?.visibleToUnitCodes),
      ...toArray(ev?.targetUnitCodes),
      ...toArray(ev?.involvedUnitCodes),
      ...toArray(ev?.responsibleUnitCodes),
      ...toArray(ev?.participantUnitCodes),
    ]
      .map((code) => normalizeCode(code))
      .filter(Boolean)
  );

  if (normalizedUnitId && eventUnitIds.has(normalizedUnitId)) return true;
  if (normalizedUnitCode && eventUnitCodes.has(normalizedUnitCode)) return true;

  return false;
}

function getDirectProfileUnitIdentity(user, claims) {
  const unitId = [
    String(user?.currentUnitId || "").trim(),
    String(user?.unitId || "").trim(),
    String(claims?.currentUnitId || "").trim(),
    String(claims?.unitId || "").trim(),
  ].find(Boolean) || "";

  const unitCode = [
    normalizeCode(user?.unitCode),
    normalizeCode(user?.sigla),
    normalizeCode(claims?.unitCode),
    normalizeCode(claims?.command),
  ].find(Boolean) || "";

  return { unitId, unitCode };
}

function getPendingDesdobramentoUnits(ev, documents, unitMap) {
  const directTargetIds = Array.from(getEventDirectTargetUnitIds(ev, documents));
  if (!directTargetIds.length) return [];

  const activeUnitDocumentIds = new Set();
  const activeUnitDocumentCodes = new Set();

  for (const docItem of documents || []) {
    if (!shouldCountDocumentAsUnitDelivery(docItem)) continue;

    const linkedUnitId = getDocumentLinkedUnitId(docItem);
    const linkedUnitCode = getDocumentLinkedUnitCode(docItem);

    if (linkedUnitId) {
      activeUnitDocumentIds.add(String(linkedUnitId).trim());
    }

    if (linkedUnitCode) {
      activeUnitDocumentCodes.add(normalizeCode(linkedUnitCode));
    }
  }

  return directTargetIds
    .map((unitId) => unitMap[unitId] || { id: unitId, code: "", name: "UNIDADE" })
    .filter((unit) => {
      const code = normalizeCode(getUnitCode(unit));
      const id = String(unit.id || "").trim();

      return !activeUnitDocumentIds.has(id) && (!code || !activeUnitDocumentCodes.has(code));
    })
    .sort(sortUnits);
}


function findActiveDesdobramentoForUnit(documents, unit) {
  if (!unit) return null;

  const targetUnitId = String(unit?.id || unit?.unitId || "").trim();
  const targetUnitCode = normalizeCode(getUnitCode(unit));

  return (
    (documents || []).find((docItem) => {
      const origin = getDocumentOriginValue(
        docItem,
        String(docItem?.category || "").toUpperCase() === "DESDOBRAMENTO"
          ? "UNIT"
          : ""
      );

      if (origin !== "UNIT") return false;
      if (docItem?.isDeleted) return false;

      return (
        (targetUnitId && String(docItem?.unitId || "").trim() === targetUnitId) ||
        (targetUnitCode && normalizeCode(docItem?.unitCode) === targetUnitCode)
      );
    }) || null
  );
}


function MapViewportController({ events, selectedEventId }) {
  const map = useMap();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => cancelAnimationFrame(frame);
  }, [map, events.length]);

  useEffect(() => {
    const coords = events
      .map((ev) => getEventCoordinates(ev))
      .filter(Boolean);

    if (coords.length === 0) return;

    if (coords.length === 1) {
      map.setView(coords[0], 14, { animate: false });
      return;
    }

    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, events]);

  useEffect(() => {
    if (!selectedEventId) return;

    const selected = events.find((ev) => ev.id === selectedEventId);
    const coords = getEventCoordinates(selected);

    if (!coords) return;

    map.flyTo(coords, Math.max(map.getZoom(), 15), {
      animate: true,
      duration: 0.5,
    });
  }, [map, events, selectedEventId]);

  return null;
}

function StatusPill({ status, small = false }) {
  const palette = getStatusPalette(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: small ? "5px 10px" : "6px 12px",
        borderRadius: 999,
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        fontSize: small ? 11 : 12,
        fontWeight: 800,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: small ? 8 : 9,
          height: small ? 8 : 9,
          borderRadius: 999,
          background: palette.dot,
          flexShrink: 0,
        }}
      />
      <span>{statusLabel(status)}</span>
    </span>
  );
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
        width: 38,
        minWidth: 38,
        height: 44,
        borderRadius: 12,
        border: `1px solid ${border}`,
        background,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width="22"
        height="26"
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
          fontSize: extension === "WORD" ? 7 : 8,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: "#fff",
          background: accent,
          padding: "2px 5px",
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

function RetifiedTag({ date, light = false, text }) {
  const label = text || (date ? `Retificado em ${fmtDateTime(date)}` : "Retificado");

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        width: "fit-content",
        marginTop: 6,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: light ? "rgba(244, 114, 182, 0.18)" : "#fce7f3",
        color: light ? "#fff" : "#be185d",
        border: light ? "1px solid rgba(249, 168, 212, 0.32)" : "1px solid #f9a8d4",
      }}
    >
      <BadgeCheck size={12} />
      <span>{label}</span>
    </div>
  );
}

function DeletedDocumentNotice({ docItem }) {
  if (!docItem?.isDeleted) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 2,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          padding: "5px 10px",
          borderRadius: 999,
          background: "#fee2e2",
          color: "#991b1b",
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        <Trash2 size={12} />
        <span>Arquivo removido</span>
      </span>

      <span
        style={{
          fontSize: 12,
          color: "#6b7280",
          fontWeight: 600,
        }}
      >
        {docItem.deletedByActorType === "UNIT"
          ? `Removido pela unidade em ${fmtDateTime(docItem.deletedAt)}`
          : `Removido em ${fmtDateTime(docItem.deletedAt)}`}
      </span>
    </div>
  );
}

const today = new Date();

function PendingPulseStyle() {
  useEffect(() => {
    const styleId = "pending-desdobramento-pulse-style";

    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      @keyframes pendingDesdobramentoPulse {
        0% {
          transform: scale(1);
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35);
        }
        50% {
          transform: scale(1.04);
          box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.10);
        }
        100% {
          transform: scale(1);
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return null;
}

function MissingDesdobramentoTag({
  text = "Desdobramento pendente",
  small = false,
}) {
  return (
    <>
      <PendingPulseStyle />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: small ? "5px 10px" : "6px 12px",
          borderRadius: 999,
          background: "#fef2f2",
          color: "#b91c1c",
          border: "1px solid #fecaca",
          fontSize: small ? 11 : 12,
          fontWeight: 800,
          lineHeight: 1,
          whiteSpace: "nowrap",
          animation: "pendingDesdobramentoPulse 1.4s ease-in-out infinite",
          transformOrigin: "center",
        }}
      >
        <span
          style={{
            width: small ? 8 : 9,
            height: small ? 8 : 9,
            borderRadius: 999,
            background: "#ef4444",
            flexShrink: 0,
          }}
        />
        <span>{text}</span>
      </span>
    </>
  );
}

function CompactDocumentUiStyle() {
  useEffect(() => {
    const styleId = "compact-document-ui-style";

    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      .compactDocCard {
        border-radius: 16px !important;
      }

      .compactDocCard .documentLeftAccent {
        width: 5px !important;
      }

      .compactDocCard .documentItemMain {
        padding: 6px 8px !important;
        position: relative !important;
      }

      .compactDocCard .documentItemTitle {
        gap: 10px !important;
        align-items: flex-start !important;
      }

      .compactDocCard .documentTitleBlock strong {
        font-size: 13px !important;
        line-height: 1.1 !important;
      }

      .compactDocCard .documentTypeLabel {
        font-size: 12px !important;
      }

      .compactDocCard .documentPills {
        margin-top: 3px !important;
        gap: 5px !important;
      }

      .compactDocCard .documentPill {
        padding: 4px 8px !important;
        font-size: 11px !important;
      }

      .compactDocCard .documentItemActions {
        gap: 6px !important;
        flex-wrap: wrap !important;
        align-items: center !important;
      }

      .documentActionBtn.iconOnlyActionBtn,
      .documentActionBtn.dangerSoft.iconOnlyActionBtn {
        width: 34px !important;
        min-width: 34px !important;
        height: 34px !important;
        padding: 0 !important;
        justify-content: center !important;
        border-radius: 10px !important;
      }

      .documentActionBtn.iconOnlyActionBtn span,
      .documentActionBtn.dangerSoft.iconOnlyActionBtn span {
        display: none !important;
      }

      .documentActionBtn.iconOnlyActionBtn svg,
      .documentActionBtn.dangerSoft.iconOnlyActionBtn svg {
        margin: 0 !important;
        width: 15px !important;
        height: 15px !important;
      }

      .compactUploadAction.iconOnlyActionBtn {
        width: 36px !important;
        min-width: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        justify-content: center !important;
        border-radius: 10px !important;
      }

      .compactUploadAction.iconOnlyActionBtn span {
        display: none !important;
      }

      .compactUploadAction.iconOnlyActionBtn svg {
        margin: 0 !important;
        width: 15px !important;
        height: 15px !important;
      }

      .compactTreeNodeCard {
        border-radius: 12px !important;
        padding: 8px 10px !important;
      }
    `;

    document.head.appendChild(style);
  }, []);

  return null;
}

function getDocumentOriginValue(docItem, fallback = "") {
  const raw = String(
    docItem?.origin ||
      docItem?.originType ||
      docItem?.documentScope ||
      fallback ||
      ""
  )
    .trim()
    .toUpperCase();

  if (
    raw === "UNIT" ||
    raw === "UNIDADE" ||
    raw === "DESDOBRAMENTO"
  ) {
    return "UNIT";
  }

  if (raw === "AIO") {
    return "AIO";
  }

  return String(fallback || "").trim().toUpperCase();
}

function getPlanningDocumentScope(docItem) {
  const explicitScope = String(docItem?.documentScope || "")
    .trim()
    .toUpperCase();

  if (explicitScope === "AIO" || explicitScope === "UNIT") {
    return explicitScope;
  }

  const origin = String(docItem?.origin || docItem?.originType || "")
    .trim()
    .toUpperCase();

  if (origin === "AIO") return "AIO";
  if (origin.startsWith("UNIDADE")) return "UNIT";

  return "AIO";
}

function isPlanningDocument(docItem) {
  const category = String(docItem?.category || "")
    .trim()
    .toUpperCase();

  if (category === "DESDOBRAMENTO") return false;

  const eventRootField = String(docItem?.eventRootField || "").trim();
  const documentGroup = String(docItem?.documentGroup || "")
    .trim()
    .toUpperCase();
  const documentScope = String(docItem?.documentScope || "")
    .trim()
    .toUpperCase();
  const origin = String(docItem?.origin || docItem?.originType || "")
    .trim()
    .toUpperCase();

  if (eventRootField === "planningDocuments") return true;
  if (documentGroup === "PLANNING") return true;
  if (documentScope === "AIO") return true;
  if (documentScope === "UNIT") return true;
  if (origin === "AIO") return true;
  if (origin.startsWith("UNIDADE")) return true;

  return false;
}

function getPlanningDocumentSecondaryLabel(docItem) {
  const scope = getPlanningDocumentScope(docItem);

  if (scope === "AIO") return "AIO";

  if (docItem?.unitCode && docItem?.unitName) {
    return `${docItem.unitCode} - ${docItem.unitName}`;
  }

  return (
    docItem?.unitCode ||
    docItem?.unitName ||
    docItem?.originUnitCode ||
    docItem?.originUnitName ||
    "UNIDADE"
  );
}

function getDocumentLinkedUnitId(docItem) {
  return String(
    docItem?.unitId || docItem?.originUnitId || docItem?.uploadedByUnitId || ""
  ).trim();
}

function getDocumentLinkedUnitCode(docItem) {
  return normalizeCode(
    docItem?.unitCode ||
      docItem?.originUnitCode ||
      docItem?.uploadedByUnitCode ||
      getLeafCodeFromPath(docItem?.unitPath)
  );
}

function shouldCountDocumentAsUnitDelivery(docItem) {
  if (!docItem || docItem?.isDeleted) return false;

  const origin = getDocumentOriginValue(
    docItem,
    String(docItem?.category || "").toUpperCase() === "DESDOBRAMENTO"
      ? "UNIT"
      : ""
  );

  if (origin === "UNIT") return true;

  return isPlanningDocument(docItem) && getPlanningDocumentScope(docItem) === "UNIT";
}


function buildEmbeddedDesdobramentoDoc(eventId, rawDoc = {}, index = 0) {
  const nowIso = new Date().toISOString();

  return {
    id:
      String(rawDoc?.id || "").trim() ||
      `embedded_desdobramento_${String(eventId || "evento")}_${index}`,

    eventId: String(eventId || "").trim(),
    eventRootField: "desdobramentos",

    origin: "UNIT",
    originType: "UNIT",
    documentScope: "UNIT",
    documentGroup: "UNIT",

    category: "DESDOBRAMENTO",
    documentType: normalizeDocumentType(
      rawDoc?.documentType || rawDoc?.category,
      "DESDOBRAMENTO"
    ),

    fileName: String(
      rawDoc?.fileName || rawDoc?.originalFileName || "Documento"
    ).trim(),

    fileType: String(rawDoc?.fileType || rawDoc?.mimeType || "").trim(),
    mimeType: String(rawDoc?.mimeType || rawDoc?.fileType || "").trim(),
    size: Number(rawDoc?.size || 0),

    storagePath: String(rawDoc?.storagePath || "").trim(),
    downloadURL: String(rawDoc?.downloadURL || rawDoc?.fileUrl || "").trim(),

    unitId: String(rawDoc?.unitId || rawDoc?.targetUnitId || "").trim() || null,
    unitCode: String(
      rawDoc?.unitCode || rawDoc?.targetUnitCode || ""
    )
      .trim()
      .toUpperCase() || null,
    unitName: String(
      rawDoc?.unitName || rawDoc?.targetUnitName || "UNIDADE"
    ).trim(),

    unitPath: String(rawDoc?.unitPath || "").trim() || null,

    uploadedByUid: String(rawDoc?.uploadedByUid || "").trim() || null,
    uploadedByEmail: String(rawDoc?.uploadedByEmail || "").trim() || null,
    uploadedByName: String(rawDoc?.uploadedByName || "").trim() || null,

    uploadedAt: rawDoc?.uploadedAt || nowIso,
    createdAt: rawDoc?.createdAt || rawDoc?.uploadedAt || nowIso,
    updatedAt: rawDoc?.updatedAt || rawDoc?.uploadedAt || nowIso,

    isDeleted: rawDoc?.isDeleted === true,
    deletedAt: rawDoc?.deletedAt || null,
    deletedByEmail: rawDoc?.deletedByEmail || null,
    deletedByUid: rawDoc?.deletedByUid || null,
    deletedByActorType: rawDoc?.deletedByActorType || null,

    replacedAt: rawDoc?.replacedAt || null,
    replacedByEmail: rawDoc?.replacedByEmail || null,
    replacedByUid: rawDoc?.replacedByUid || null,

    lastRetificationType: rawDoc?.lastRetificationType || null,
    retifiedAt: rawDoc?.retifiedAt || null,
    retifiedByEmail: rawDoc?.retifiedByEmail || null,
    retifiedByUid: rawDoc?.retifiedByUid || null,

    addedInRetification: rawDoc?.addedInRetification === true,
    addedInRetificationAt: rawDoc?.addedInRetificationAt || null,

    requestedSubordinateUnitIds: Array.isArray(rawDoc?.requestedSubordinateUnitIds)
      ? rawDoc.requestedSubordinateUnitIds.filter(Boolean)
      : [],
    requestedSubordinateUnitCodes: Array.isArray(rawDoc?.requestedSubordinateUnitCodes)
      ? rawDoc.requestedSubordinateUnitCodes.filter(Boolean)
      : [],
    requestedSubordinateUnitNames: Array.isArray(rawDoc?.requestedSubordinateUnitNames)
      ? rawDoc.requestedSubordinateUnitNames.filter(Boolean)
      : [],
    requestedSubordinateUnits: Array.isArray(rawDoc?.requestedSubordinateUnits)
      ? rawDoc.requestedSubordinateUnits.filter(Boolean)
      : [],
  };
}

function normalizeEmbeddedEventDocument(eventId, rawDoc = {}, source = "documents", index = 0) {
  const rawScope = String(rawDoc?.documentScope || "").trim().toUpperCase();
  const rawGroup = String(rawDoc?.documentGroup || "").trim().toUpperCase();
  const rawOrigin = String(rawDoc?.origin || rawDoc?.originType || "")
    .trim()
    .toUpperCase();

  const isDesdobramentoSource = source === "desdobramentos";
  const isPlanningSource = source === "planningDocuments";

  const inferredPlanningScope =
    rawScope === "UNIT" || rawOrigin.startsWith("UNIDADE") ? "UNIT" : "AIO";

  const origin = isDesdobramentoSource
    ? "UNIT"
    : rawOrigin ||
      (isPlanningSource
        ? inferredPlanningScope === "UNIT"
          ? "UNIDADE_GESTORA"
          : "AIO"
        : "AIO");

  const nowIso = new Date().toISOString();
  const eventRootField =
    source === "planningDocuments"
      ? "planningDocuments"
      : source === "desdobramentos"
      ? "desdobramentos"
      : "documents";

  const documentScope = isDesdobramentoSource
    ? "UNIT"
    : isPlanningSource
    ? inferredPlanningScope
    : rawScope === "UNIT"
    ? "UNIT"
    : "AIO";

  const documentGroup = isDesdobramentoSource
    ? "UNIT"
    : isPlanningSource
    ? "PLANNING"
    : rawGroup || (documentScope === "UNIT" ? "UNIT" : "AIO");

  return {
    id:
      String(rawDoc?.id || "").trim() ||
      `embedded_${source}_${String(eventId || "evento")}_${index}`,

    eventId: String(eventId || "").trim(),
    eventRootField,

    origin,
    originType: origin,
    documentScope,
    documentGroup,

    category: isDesdobramentoSource
      ? "DESDOBRAMENTO"
      : String(rawDoc?.category || "DOCUMENTO").trim().toUpperCase(),

    documentType: isDesdobramentoSource
      ? normalizeDocumentType(rawDoc?.documentType, "DESDOBRAMENTO")
      : normalizeDocumentType(rawDoc?.documentType || rawDoc?.category, "DOCUMENTO"),

    fileName: String(
      rawDoc?.fileName || rawDoc?.originalFileName || "Documento"
    ).trim(),

    fileType: String(rawDoc?.fileType || rawDoc?.mimeType || "").trim(),
    mimeType: String(rawDoc?.mimeType || rawDoc?.fileType || "").trim(),
    size: Number(rawDoc?.size || 0),

    storagePath: String(rawDoc?.storagePath || "").trim(),
    downloadURL: String(rawDoc?.downloadURL || rawDoc?.fileUrl || "").trim(),

    unitId: String(rawDoc?.unitId || rawDoc?.targetUnitId || "").trim() || null,
    unitCode: String(
      rawDoc?.unitCode || rawDoc?.targetUnitCode || ""
    )
      .trim()
      .toUpperCase() || null,
    unitName: String(
      rawDoc?.unitName || rawDoc?.targetUnitName || ""
    ).trim() || null,

    unitPath: String(rawDoc?.unitPath || "").trim() || null,

    uploadedByUid: String(rawDoc?.uploadedByUid || "").trim() || null,
    uploadedByEmail: String(rawDoc?.uploadedByEmail || "").trim() || null,
    uploadedByName: String(rawDoc?.uploadedByName || "").trim() || null,

    uploadedAt: rawDoc?.uploadedAt || nowIso,
    createdAt: rawDoc?.createdAt || rawDoc?.uploadedAt || nowIso,
    updatedAt: rawDoc?.updatedAt || rawDoc?.uploadedAt || nowIso,

    isDeleted: rawDoc?.isDeleted === true,
    deletedAt: rawDoc?.deletedAt || null,
    deletedByEmail: rawDoc?.deletedByEmail || null,
    deletedByUid: rawDoc?.deletedByUid || null,
    deletedByActorType: rawDoc?.deletedByActorType || null,

    replacedAt: rawDoc?.replacedAt || null,
    replacedByEmail: rawDoc?.replacedByEmail || null,
    replacedByUid: rawDoc?.replacedByUid || null,

    lastRetificationType: rawDoc?.lastRetificationType || null,
    retifiedAt: rawDoc?.retifiedAt || null,
    retifiedByEmail: rawDoc?.retifiedByEmail || null,
    retifiedByUid: rawDoc?.retifiedByUid || null,

    addedInRetification: rawDoc?.addedInRetification === true,
    addedInRetificationAt: rawDoc?.addedInRetificationAt || null,

    requestedSubordinateUnitIds: Array.isArray(rawDoc?.requestedSubordinateUnitIds)
      ? rawDoc.requestedSubordinateUnitIds.filter(Boolean)
      : [],
    requestedSubordinateUnitCodes: Array.isArray(rawDoc?.requestedSubordinateUnitCodes)
      ? rawDoc.requestedSubordinateUnitCodes.filter(Boolean)
      : [],
    requestedSubordinateUnitNames: Array.isArray(rawDoc?.requestedSubordinateUnitNames)
      ? rawDoc.requestedSubordinateUnitNames.filter(Boolean)
      : [],
    requestedSubordinateUnits: Array.isArray(rawDoc?.requestedSubordinateUnits)
      ? rawDoc.requestedSubordinateUnits.filter(Boolean)
      : [],
  };
}

function getEmbeddedEventDocuments(ev) {
  if (!ev) return [];

  const eventId = String(ev?.id || "").trim();

  const rootDocuments = toArray(ev?.documents).map((docItem, index) =>
    normalizeEmbeddedEventDocument(eventId, docItem, "documents", index)
  );

  const rootPlanningDocuments = toArray(ev?.planningDocuments).map((docItem, index) =>
    normalizeEmbeddedEventDocument(eventId, docItem, "planningDocuments", index)
  );

  const rootDesdobramentos = toArray(ev?.desdobramentos).map((docItem, index) =>
    buildEmbeddedDesdobramentoDoc(eventId, docItem, index)
  );

  return [...rootDocuments, ...rootPlanningDocuments, ...rootDesdobramentos];
}

function mergeEventDocuments(primaryDocs = [], embeddedDocs = []) {
  const map = new Map();

  [...embeddedDocs, ...primaryDocs].forEach((docItem, index) => {
    if (!docItem) return;

    const key =
      String(docItem?.id || "").trim() ||
      String(docItem?.storagePath || "").trim() ||
      String(docItem?.downloadURL || "").trim() ||
      `doc_${index}`;

    map.set(key, docItem);
  });

  return Array.from(map.values()).sort((a, b) => {
    const da = normalizeToDate(a?.uploadedAt);
    const db = normalizeToDate(b?.uploadedAt);
    return (db?.getTime() || 0) - (da?.getTime() || 0);
  });
}

function getEventEmbeddedDocuments(ev) {
  return getEmbeddedEventDocuments(ev);
}

function mergeDisplayedDocuments(primaryDocs = [], embeddedDocs = []) {
  const map = new Map();

  [...embeddedDocs, ...primaryDocs].forEach((docItem, index) => {
    if (!docItem) return;

    const key =
      String(docItem?.id || "").trim() ||
      String(docItem?.storagePath || "").trim() ||
      String(docItem?.downloadURL || "").trim() ||
      `doc_${index}`;

    map.set(key, docItem);
  });

  return Array.from(map.values()).sort((a, b) => {
    const dateA = normalizeToDate(a?.uploadedAt);
    const dateB = normalizeToDate(b?.uploadedAt);
    return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
  });
}

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    code.includes("permission-denied") ||
    code.includes("unauthorized") ||
    message.includes("missing or insufficient permissions") ||
    message.includes("does not have permission")
  );
}

function getDocumentRootField(docItem) {
  const explicitField = String(docItem?.eventRootField || "").trim();

  // Só trate como documento embutido quando o próprio item vier marcado
  // com o campo raiz do evento. Documentos da subcoleção
  // events/{eventId}/documents/{docId} podem ser UNIT ou PLANNING também,
  // mas precisam ser atualizados pela subcoleção, não pelo array do evento.
  return explicitField || "";
}

function isSameEmbeddedRootDocument(rawDoc = {}, targetDoc = {}) {
  const rawId = String(rawDoc?.id || "").trim();
  const targetId = String(targetDoc?.id || "").trim();

  if (rawId && targetId && rawId === targetId) return true;

  const rawStoragePath = String(rawDoc?.storagePath || "").trim();
  const targetStoragePath = String(targetDoc?.storagePath || "").trim();

  if (rawStoragePath && targetStoragePath && rawStoragePath === targetStoragePath) {
    return true;
  }

  const rawDownloadURL = String(rawDoc?.downloadURL || rawDoc?.fileUrl || "").trim();
  const targetDownloadURL = String(
    targetDoc?.downloadURL || targetDoc?.fileUrl || ""
  ).trim();

  if (rawDownloadURL && targetDownloadURL && rawDownloadURL === targetDownloadURL) {
    return true;
  }

  const rawName = String(rawDoc?.fileName || rawDoc?.originalFileName || "").trim();
  const targetName = String(
    targetDoc?.fileName || targetDoc?.originalFileName || ""
  ).trim();

  const rawUnitId = String(rawDoc?.unitId || rawDoc?.targetUnitId || "").trim();
  const targetUnitId = String(
    targetDoc?.unitId || targetDoc?.targetUnitId || ""
  ).trim();

  const rawUnitCode = normalizeCode(rawDoc?.unitCode || rawDoc?.targetUnitCode);
  const targetUnitCode = normalizeCode(
    targetDoc?.unitCode || targetDoc?.targetUnitCode
  );

  if (!rawName || !targetName || rawName !== targetName) return false;

  if (rawUnitId && targetUnitId && rawUnitId === targetUnitId) return true;
  if (rawUnitCode && targetUnitCode && rawUnitCode === targetUnitCode) return true;

  return false;
}

function patchEmbeddedRootDocumentList(currentList = [], targetDoc, patch) {
  const list = Array.isArray(currentList) ? currentList : [];
  let matched = false;

  const nextList = list.map((item) => {
    if (!isSameEmbeddedRootDocument(item, targetDoc)) {
      return item;
    }

    matched = true;
    const computedPatch =
      typeof patch === "function" ? patch(item) : patch || {};

    return {
      ...item,
      ...computedPatch,
    };
  });

  return { nextList, matched };
}
export default function Home({
  user,
  claims,
  onCreateEvent,
  onOpenUnits,
  onGoHome,
  onGoAccess,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState(null);

  const [eventDocumentsMap, setEventDocumentsMap] = useState({});
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [documentActionLoading, setDocumentActionLoading] = useState("");

  const [viewMode, setViewMode] = useState("list");
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const [units, setUnits] = useState([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [unitFilterId, setUnitFilterId] = useState("");

  const [calendarMonth, setCalendarMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [isCalendarDragging, setIsCalendarDragging] = useState(false);
  const [calendarDragStart, setCalendarDragStart] = useState(null);

  const [desdobramentoUnitId, setDesdobramentoUnitId] = useState("");
  const [desdobramentoSelectedUnitIds, setDesdobramentoSelectedUnitIds] = useState([]);
  const [desdobramentoFile, setDesdobramentoFile] = useState(null);
  const [showGestoraSubordinateSelectorStep, setShowGestoraSubordinateSelectorStep] = useState(false);
  const [showGestoraSubordinateSelectorInUpload, setShowGestoraSubordinateSelectorInUpload] = useState(false);
  const [savingRequestedSubordinates, setSavingRequestedSubordinates] = useState(false);


  const [desdobramentoDocumentType, setDesdobramentoDocumentType] =
    useState("DESDOBRAMENTO");
  const [replaceDocumentTypes, setReplaceDocumentTypes] = useState({});
  const [replacePickerDocId, setReplacePickerDocId] = useState("");
  const permissions = useMemo(
    () => getCurrentUserPermissions(user, claims),
    [user, claims]
  );

  
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
        setUnits([]);
      } finally {
        setLoadingUnits(false);
      }
    }

    loadUnits();
  }, []);
  const unitMap = useMemo(() => {
    const map = {};
    for (const unit of units) {
      map[unit.id] = unit;
    }
    return map;
  }, [units]);

  const codeToUnitIdMap = useMemo(() => {
    const map = {};
    for (const unit of units) {
      const code = getUnitCode(unit);
      if (code) {
        map[code] = unit.id;
      }
    }
    return map;
  }, [units]);

  const directProfileUnitIdentity = useMemo(() => {
    const identity = getDirectProfileUnitIdentity(user, claims);
    const resolvedUnitId =
      identity.unitId ||
      (identity.unitCode ? codeToUnitIdMap[normalizeCode(identity.unitCode)] || "" : "");

    return {
      unitId: resolvedUnitId,
      unitCode: identity.unitCode,
    };
  }, [
    user?.currentUnitId,
    user?.unitId,
    user?.unitCode,
    user?.sigla,
    claims?.currentUnitId,
    claims?.unitId,
    claims?.unitCode,
    claims?.command,
    codeToUnitIdMap,
  ]);

  const resolvedPermissionUnitIds = useMemo(() => {
    const ids = new Set();

    permissions.unitIds.forEach((id) => {
      const value = String(id || "").trim();
      if (value) ids.add(value);
    });

    permissions.unitCodes.forEach((code) => {
      const resolvedId = codeToUnitIdMap[normalizeCode(code)];
      if (resolvedId) ids.add(resolvedId);
    });

    if (permissions.activeUnitId) {
      ids.add(String(permissions.activeUnitId).trim());
    }

    if (permissions.activeUnitCode) {
      const resolvedId = codeToUnitIdMap[normalizeCode(permissions.activeUnitCode)];
      if (resolvedId) ids.add(resolvedId);
    }

    if (directProfileUnitIdentity.unitId) {
      ids.add(String(directProfileUnitIdentity.unitId).trim());
    }

    if (directProfileUnitIdentity.unitCode) {
      const resolvedId = codeToUnitIdMap[normalizeCode(directProfileUnitIdentity.unitCode)];
      if (resolvedId) ids.add(resolvedId);
    }

    getProfileScopeUnitIds(user, claims, permissions).forEach((id) => {
      const value = String(id || "").trim();
      if (value) ids.add(value);
    });

    return Array.from(ids).filter(Boolean);
  }, [
    permissions.unitIds,
    permissions.unitCodes,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    codeToUnitIdMap,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    user,
    claims,
    permissions,
  ]);

  const resolvedPermissionUnitCodes = useMemo(() => {
    return getProfileScopeUnitCodes(user, claims, permissions, unitMap);
  }, [user, claims, permissions, unitMap]);

  useEffect(() => {
    console.log("USER HOME:", user);
    console.log("CLAIMS HOME:", claims);
    console.log("PERMISSIONS:", {
      unitIds: Array.from(permissions.unitIds || []),
      unitCodes: Array.from(permissions.unitCodes || []),
      activeUnitId: permissions.activeUnitId,
      activeUnitCode: permissions.activeUnitCode,
      isGlobalReader: permissions.isGlobalReader,
      isAIOUser: permissions.isAIOUser,
      isAdminUser: permissions.isAdminUser,
      isGestoraProfile: permissions.isGestoraProfile,
      usesScopeVisibility: permissions.usesScopeVisibility,
    });
    console.log("directProfileUnitIdentity:", directProfileUnitIdentity);
    console.log("resolvedPermissionUnitIds:", resolvedPermissionUnitIds);
    console.log("resolvedPermissionUnitCodes:", resolvedPermissionUnitCodes);
  }, [user, claims, permissions, directProfileUnitIdentity, resolvedPermissionUnitIds, resolvedPermissionUnitCodes]);

  async function loadEvents() {
    setLoading(true);
    console.log("=== LOAD EVENTS ===");
    console.log("permissions.isGlobalReader:", permissions.isGlobalReader);
    console.log("directProfileUnitIdentity:", directProfileUnitIdentity);
    console.log("resolvedPermissionUnitIds:", resolvedPermissionUnitIds);

    try {
      const refCollection = collection(db, "events");
      const baseQuery = query(refCollection, orderBy("createdAt", "desc"), limit(500));
      const snap = await getDocs(baseQuery);

      let rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.isDeleted);

      if (!permissions.isGlobalReader) {
        rows = rows.filter((row) =>
          permissions.usesScopeVisibility
            ? eventMatchesProfileScope(
                row,
                resolvedPermissionUnitIds,
                resolvedPermissionUnitCodes
              )
            : eventMatchesDirectLinkedUnit(
                row,
                directProfileUnitIdentity.unitId || permissions.activeUnitId,
                directProfileUnitIdentity.unitCode || permissions.activeUnitCode
              )
        );
      }

      rows = rows.sort(sortEventsByPeriodDesc);
      setEvents(rows);
      console.log("EVENTOS CARREGADOS:", rows);
    } catch (e) {
      console.error("Erro ao carregar eventos:", e);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      loadEvents();
    }, 300);

    return () => clearTimeout(t);
  }, [
    permissions.isGlobalReader,
    permissions.usesScopeVisibility,
    resolvedPermissionUnitIds.join("|"),
    resolvedPermissionUnitCodes.join("|"),
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadAllDocuments() {
      if (!events.length) {
        setEventDocumentsMap({});
        return;
      }

      setLoadingDocuments(true);

      try {
        const results = await Promise.all(
          events.map(async (ev) => {
            try {
              const docsRef = collection(db, "events", ev.id, "documents");
              const snap = await getDocs(docsRef);

              const rows = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }));

              rows.sort((a, b) => {
                const da = normalizeToDate(a.uploadedAt);
                const dbd = normalizeToDate(b.uploadedAt);
                return (dbd?.getTime() || 0) - (da?.getTime() || 0);
              });

              return [ev.id, rows];
            } catch (error) {
              if (!isPermissionDeniedError(error)) {
                console.error(
                  `Erro ao carregar documentos do evento ${ev.id}:`,
                  error
                );
              }
              return [ev.id, []];
            }
          })
        );

        if (!cancelled) {
          setEventDocumentsMap(Object.fromEntries(results));
        }
      } finally {
        if (!cancelled) {
          setLoadingDocuments(false);
        }
      }
    }

    loadAllDocuments();

    return () => {
      cancelled = true;
    };
  }, [events]);

  useEffect(() => {
    function handleMouseUp() {
      setIsCalendarDragging(false);
      setCalendarDragStart(null);
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    if (viewMode !== "map") {
      setIsMapExpanded(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!isMapExpanded) {
      document.body.style.overflow = "";
      return;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMapExpanded]);

  const validUnitIds = useMemo(() => new Set(units.map((u) => u.id)), [units]);

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

  const lockedProfileUnitId = useMemo(() => {
    const directId = String(directProfileUnitIdentity.unitId || "").trim();
    if (directId) return directId;

    const activeId = String(permissions.activeUnitId || "").trim();
    if (activeId) return activeId;

    const directCode = normalizeCode(
      directProfileUnitIdentity.unitCode || permissions.activeUnitCode || ""
    );

    if (directCode && codeToUnitIdMap[directCode]) {
      return codeToUnitIdMap[directCode];
    }

    return "";
  }, [
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    codeToUnitIdMap,
  ]);

  const lockedProfileUnitCode = useMemo(() => {
    const unitFromMap = lockedProfileUnitId ? unitMap[lockedProfileUnitId] : null;
    return normalizeCode(
      getUnitCode(unitFromMap) ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );
  }, [
    lockedProfileUnitId,
    unitMap,
    directProfileUnitIdentity.unitCode,
    permissions.activeUnitCode,
  ]);

  const profileHasSubordinates = useMemo(() => {
    if (!lockedProfileUnitId) return false;
    return Array.isArray(childrenMap[lockedProfileUnitId]) && childrenMap[lockedProfileUnitId].length > 0;
  }, [lockedProfileUnitId, childrenMap]);

  const isHierarchyRestrictedViewer = useMemo(() => {
    return !permissions.isAIOUser && !permissions.isGlobalReader && !profileHasSubordinates;
  }, [
    permissions.isAIOUser,
    permissions.isGlobalReader,
    profileHasSubordinates,
  ]);


  const visibleUnitOptions = useMemo(() => {
    if (!lockedProfileUnitId) return [];

    if (permissions.isGlobalReader || permissions.usesScopeVisibility) {
      const allowedIds = new Set([lockedProfileUnitId]);
      collectDescendantIds(lockedProfileUnitId, childrenMap, allowedIds);

      const scopedOptions = unitOptions.filter((unit) =>
        allowedIds.has(String(unit.id || "").trim())
      );

      if (scopedOptions.length > 0) return scopedOptions;
    }

    const directOption = unitOptions.find(
      (unit) => String(unit.id || "").trim() === lockedProfileUnitId
    );

    if (directOption) return [directOption];

    const unit = unitMap[lockedProfileUnitId];
    if (!unit) return [];

    const unitCode = getUnitCode(unit);
    const labelBase = unitCode
      ? `${unitCode} - ${getUnitLabel(unit)}`.trim()
      : getUnitLabel(unit);

    return [
      {
        id: lockedProfileUnitId,
        label: labelBase,
      },
    ];
  }, [
    lockedProfileUnitId,
    permissions.isGlobalReader,
    permissions.usesScopeVisibility,
    unitOptions,
    unitMap,
    childrenMap,
  ]);

  useEffect(() => {
    setUnitFilterId((current) => {
      const validIds = new Set(visibleUnitOptions.map((item) => String(item.id || "").trim()));

      if (current && validIds.has(String(current || "").trim())) {
        return current;
      }

      if (permissions.isGlobalReader || permissions.usesScopeVisibility) {
        return lockedProfileUnitId || visibleUnitOptions[0]?.id || "";
      }

      return lockedProfileUnitId || "";
    });
  }, [
    lockedProfileUnitId,
    visibleUnitOptions,
    permissions.isGlobalReader,
    permissions.usesScopeVisibility,
  ]);

  const selectedUnitScopeIds = useMemo(() => {
    if (!unitFilterId || !unitMap[unitFilterId]) return new Set();

    if (!permissions.isGlobalReader && !permissions.usesScopeVisibility) {
      return new Set([unitFilterId]);
    }

    const ids = new Set([unitFilterId]);
    collectDescendantIds(unitFilterId, childrenMap, ids);

    return ids;
  }, [
    unitFilterId,
    unitMap,
    childrenMap,
    permissions.isGlobalReader,
    permissions.usesScopeVisibility,
  ]);

  const selectedUnitScopeCodes = useMemo(() => {
    const codes = new Set();

    Array.from(selectedUnitScopeIds).forEach((id) => {
      const unit = unitMap[id];
      const code = getUnitCode(unit);
      if (code) codes.add(code);
    });

    return Array.from(codes);
  }, [selectedUnitScopeIds, unitMap]);

  const filteredEvents = useMemo(() => {
    let list = [...events];

    if (from || to) {
      list = list.filter((ev) => eventMatchesSelectedRange(ev, from, to));
    }

    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (ev) =>
          String(ev.title || ev.name || "").toLowerCase().includes(s) ||
          String(ev.location || "").toLowerCase().includes(s)
      );
    }

    if (unitFilterId && selectedUnitScopeIds.size > 0) {
      const selectedUnit = unitMap[unitFilterId];

      list = list.filter((ev) => {
        if (!permissions.isGlobalReader) {
          if (permissions.usesScopeVisibility) {
            return eventMatchesProfileScope(
              ev,
              Array.from(selectedUnitScopeIds),
              selectedUnitScopeCodes
            );
          }

          return eventMatchesDirectLinkedUnit(
            ev,
            directProfileUnitIdentity.unitId || selectedUnit?.id || unitFilterId,
            directProfileUnitIdentity.unitCode || getUnitCode(selectedUnit)
          );
        }

        const eventUnitIds = getEventUnitIds(ev);

        for (const id of selectedUnitScopeIds) {
          if (eventUnitIds.has(id)) return true;
        }

        if (Array.isArray(ev.visibleToUnitIds)) {
          for (const id of selectedUnitScopeIds) {
            if (ev.visibleToUnitIds.includes(id)) return true;
          }
        }

        const path = String(ev.unitPath || "");
        const selectedUnitCode = getUnitCode(selectedUnit);
        const selectedUnitName = getUnitLabel(selectedUnit);

        if (selectedUnitCode && path.includes(selectedUnitCode)) return true;
        if (selectedUnitName && path.includes(selectedUnitName)) return true;

        return false;
      });
    }

    return list.sort(sortEventsByPeriodDesc);
  }, [
    events,
    from,
    to,
    search,
    unitFilterId,
    selectedUnitScopeIds,
    unitMap,
    permissions.isGlobalReader,
    permissions.usesScopeVisibility,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    selectedUnitScopeCodes,
  ]);

  const mapEvents = useMemo(() => {
    return filteredEvents.filter((ev) => !!getEventCoordinates(ev));
  }, [filteredEvents]);

  const selectedEvent = useMemo(() => {
    return events.find((ev) => ev.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  useEffect(() => {
    if (selectedEventId && !events.some((ev) => ev.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    const modalOpen = !!selectedEvent;

    if (!modalOpen) {
      document.body.style.overflow = isMapExpanded ? "hidden" : "";
      document.documentElement.style.overflow = "";
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [selectedEvent, isMapExpanded]);

  const selectedEventDocuments = useMemo(() => {
    const currentEvent =
      events.find((ev) => ev.id === selectedEventId) || selectedEvent || null;

    const subcollectionDocs = eventDocumentsMap[selectedEventId] || [];
    const embeddedDocs = getEventEmbeddedDocuments(currentEvent);

    return mergeEventDocuments(subcollectionDocs, embeddedDocs);
  }, [eventDocumentsMap, selectedEventId, events, selectedEvent]);

  const visibleSelectedEventDocuments = useMemo(() => {
    return selectedEventDocuments.filter((docItem) => !docItem.isDeleted);
  }, [selectedEventDocuments]);

  useEffect(() => {
    const next = {};

    selectedEventDocuments.forEach((docItem) => {
      next[docItem.id] = getEffectiveDocumentType(docItem);
    });

    setReplaceDocumentTypes(next);
  }, [selectedEventDocuments]);

  const planningDocuments = useMemo(() => {
    return visibleSelectedEventDocuments.filter((docItem) => {
      return !docItem.isDeleted && isPlanningDocument(docItem);
    });
  }, [visibleSelectedEventDocuments]);

  const planningDocumentsSectionTitle = useMemo(() => {
    const hasUnitPlanning = planningDocuments.some(
      (docItem) => getPlanningDocumentScope(docItem) === "UNIT"
    );

    return hasUnitPlanning
      ? "Planejamento da unidade geradora"
      : "Planejamento / Ordem da AIO";
  }, [planningDocuments]);

  const gestoraOwnPlanningDocument = useMemo(() => {
    if (!permissions.isGestoraProfile || !selectedEvent) {
      return null;
    }

    const ownUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const ownUnitCode = normalizeCode(
      getUnitCode(unitMap[ownUnitId]) ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    return (
      planningDocuments.find((docItem) => {
        if (!docItem || docItem.isDeleted) return false;
        if (getPlanningDocumentScope(docItem) !== "UNIT") return false;

        const docUnitId = getDocumentLinkedUnitId(docItem);
        const docUnitCode = getDocumentLinkedUnitCode(docItem);

        return (
          (ownUnitId && docUnitId === ownUnitId) ||
          (ownUnitCode && docUnitCode === ownUnitCode)
        );
      }) || null
    );
  }, [
    permissions.isGestoraProfile,
    selectedEvent,
    planningDocuments,
    lockedProfileUnitId,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    unitMap,
  ]);

  const desdobramentoDocuments = useMemo(() => {
    return visibleSelectedEventDocuments.filter((docItem) => {
      const origin = getDocumentOriginValue(
        docItem,
        String(docItem?.category || "").toUpperCase() === "DESDOBRAMENTO"
          ? "UNIT"
          : ""
      );

      return (
        !docItem.isDeleted &&
        (
          origin === "UNIT" ||
          String(docItem?.category || "").toUpperCase() === "DESDOBRAMENTO"
        )
      );
    });
  }, [visibleSelectedEventDocuments]);

  const visibleGestoraRootDesdobramentoIds = useMemo(() => {
    const visibleIds = new Set();

    const currentUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const currentUnitCode = normalizeCode(
      lockedProfileUnitCode ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    const managedScopeIds = new Set();
    resolvedPermissionUnitIds.forEach((id) => {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) return;
      managedScopeIds.add(normalizedId);
      if (unitMap[normalizedId]) {
        collectDescendantIds(normalizedId, childrenMap, managedScopeIds);
      }
    });
    if (lockedProfileUnitId) {
      managedScopeIds.add(String(lockedProfileUnitId).trim());
    }

    const managedScopeCodes = new Set(
      [
        lockedProfileUnitCode,
        directProfileUnitIdentity.unitCode,
        permissions.activeUnitCode,
        ...resolvedPermissionUnitCodes,
      ]
        .map((code) => normalizeCode(code))
        .filter(Boolean)
    );

    desdobramentoDocuments.forEach((rootDoc) => {
      const requestedBadges = getRequestedSubordinateBadges(rootDoc, unitMap);
      if (!requestedBadges.length) return;

      const docUnitId = getDocumentLinkedUnitId(rootDoc);
      const docUnitCode = getDocumentLinkedUnitCode(rootDoc);

      const isInsideViewerScope =
        permissions.isAIOUser ||
        permissions.isGlobalReader ||
        (!isHierarchyRestrictedViewer && docUnitId && managedScopeIds.has(docUnitId)) ||
        (!isHierarchyRestrictedViewer && docUnitCode && managedScopeCodes.has(docUnitCode));

      const isMyGestoraOrder = requestedBadges.some((badge) => {
        const badgeUnitId = String(badge?.unitId || "").trim();
        const badgeUnitCode = normalizeCode(badge?.code);

        return (
          (currentUnitId && badgeUnitId === currentUnitId) ||
          (currentUnitCode && badgeUnitCode === currentUnitCode)
        );
      });

      if (isInsideViewerScope || isMyGestoraOrder) {
        visibleIds.add(rootDoc.id);
      }
    });

    return visibleIds;
  }, [
    desdobramentoDocuments,
    unitMap,
    childrenMap,
    resolvedPermissionUnitIds,
    resolvedPermissionUnitCodes,
    permissions.isAIOUser,
    permissions.isGlobalReader,
    isHierarchyRestrictedViewer,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    lockedProfileUnitId,
    lockedProfileUnitCode,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
  ]);

  const groupedSubordinateDocumentIds = useMemo(() => {
    const groupedIds = new Set();

    desdobramentoDocuments.forEach((rootDoc) => {
      if (!visibleGestoraRootDesdobramentoIds.has(rootDoc.id)) return;

      const subordinateTree = buildRequestedSubordinateTree(
        rootDoc,
        desdobramentoDocuments,
        unitMap
      );

      subordinateTree.forEach((item) => {
        if (item?.document?.id) {
          groupedIds.add(item.document.id);
        }
      });
    });

    return groupedIds;
  }, [
    desdobramentoDocuments,
    visibleGestoraRootDesdobramentoIds,
    unitMap,
  ]);

  const displayedDesdobramentoDocuments = useMemo(() => {
    const currentUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const currentUnitCode = normalizeCode(
      lockedProfileUnitCode ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    const managedScopeIds = new Set();
    resolvedPermissionUnitIds.forEach((id) => {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) return;
      managedScopeIds.add(normalizedId);
      if (unitMap[normalizedId]) {
        collectDescendantIds(normalizedId, childrenMap, managedScopeIds);
      }
    });
    if (lockedProfileUnitId) {
      managedScopeIds.add(String(lockedProfileUnitId).trim());
    }

    const managedScopeCodes = new Set(
      [
        lockedProfileUnitCode,
        directProfileUnitIdentity.unitCode,
        permissions.activeUnitCode,
        ...resolvedPermissionUnitCodes,
      ]
        .map((code) => normalizeCode(code))
        .filter(Boolean)
    );

    const hasVisibleGestoraRoots = visibleGestoraRootDesdobramentoIds.size > 0;
    const isRestrictedViewer = isHierarchyRestrictedViewer;

    return desdobramentoDocuments.filter((docItem) => {
      if (groupedSubordinateDocumentIds.has(docItem.id)) return false;

      const isRequestedRoot =
        getRequestedSubordinateBadges(docItem, unitMap).length > 0;

      if (isRequestedRoot) {
        return visibleGestoraRootDesdobramentoIds.has(docItem.id);
      }

      const docUnitId = getDocumentLinkedUnitId(docItem);
      const docUnitCode = getDocumentLinkedUnitCode(docItem);
      const isInsideViewerScope =
        permissions.isAIOUser ||
        permissions.isGlobalReader ||
        (!isRestrictedViewer && docUnitId && managedScopeIds.has(docUnitId)) ||
        (!isRestrictedViewer && docUnitCode && managedScopeCodes.has(docUnitCode));

      if (hasVisibleGestoraRoots) {
        if ((permissions.usesScopeVisibility || permissions.isGlobalReader) && !isRestrictedViewer) {
          return !!isInsideViewerScope;
        }

        return (
          (currentUnitId && docUnitId === currentUnitId) ||
          (currentUnitCode && docUnitCode === currentUnitCode)
        );
      }

      if ((permissions.usesScopeVisibility || permissions.isGlobalReader) && !isRestrictedViewer) {
        return !!isInsideViewerScope;
      }

      return (
        (currentUnitId && docUnitId === currentUnitId) ||
        (currentUnitCode && docUnitCode === currentUnitCode)
      );
    });
  }, [
    desdobramentoDocuments,
    groupedSubordinateDocumentIds,
    visibleGestoraRootDesdobramentoIds,
    unitMap,
    childrenMap,
    resolvedPermissionUnitIds,
    resolvedPermissionUnitCodes,
    permissions.isAIOUser,
    permissions.isGlobalReader,
    isHierarchyRestrictedViewer,
    permissions.usesScopeVisibility,
    isHierarchyRestrictedViewer,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    lockedProfileUnitId,
    lockedProfileUnitCode,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
  ]);

  const selectedEventUnitBadges = useMemo(() => {
    return buildEventUnitBadges(selectedEvent, unitMap);
  }, [selectedEvent, unitMap]);

  const selectedEventDesdobramentoState = useMemo(() => {
    return getDesdobramentoUnitState(selectedEventDocuments);
  }, [selectedEventDocuments]);

  const selectedEventPendingDesdobramentoUnits = useMemo(() => {
    return getPendingDesdobramentoUnits(
      selectedEvent,
      selectedEventDocuments,
      unitMap
    );
  }, [selectedEvent, selectedEventDocuments, unitMap]);

  const profileAlertUnitId = useMemo(() => {
    return String(
      user?.unitId ||
        claims?.unitId ||
        claims?.currentUnitId ||
        permissions.activeUnitId ||
        ""
    ).trim();
  }, [
    user?.unitId,
    claims?.unitId,
    claims?.currentUnitId,
    permissions.activeUnitId,
  ]);

  const profileAlertUnit = useMemo(() => {
    return unitMap[profileAlertUnitId] || null;
  }, [profileAlertUnitId, unitMap]);

  const profileAlertCandidateIds = useMemo(() => {
    return Array.from(
      new Set(
        [
          String(directProfileUnitIdentity.unitId || "").trim(),
          String(profileAlertUnitId || "").trim(),
          String(user?.unitId || "").trim(),
          String(claims?.unitId || "").trim(),
          String(claims?.currentUnitId || "").trim(),
          String(permissions.activeUnitId || "").trim(),
        ].filter(Boolean)
      )
    );
  }, [
    directProfileUnitIdentity.unitId,
    profileAlertUnitId,
    user?.unitId,
    claims?.unitId,
    claims?.currentUnitId,
    permissions.activeUnitId,
  ]);

  const profileAlertCandidateCodes = useMemo(() => {
    return Array.from(
      new Set(
        [
          directProfileUnitIdentity.unitCode || "",
          profileAlertUnit ? getUnitCode(profileAlertUnit) : "",
          user?.unitCode || "",
          claims?.unitCode || "",
          claims?.command || "",
        ]
          .map((value) => normalizeCode(value))
          .filter(Boolean)
      )
    );
  }, [
    directProfileUnitIdentity.unitCode,
    profileAlertUnit,
    user?.unitCode,
    claims?.unitCode,
    claims?.command,
  ]);

  const profilePendingUnitInSelectedEvent = useMemo(() => {
    if (!selectedEvent) return null;

    return (
      selectedEventPendingDesdobramentoUnits.find((unit) => {
        const candidateId = String(unit?.id || "").trim();
        const candidateCode = normalizeCode(getUnitCode(unit));

        return (
          (candidateId && profileAlertCandidateIds.includes(candidateId)) ||
          (candidateCode && profileAlertCandidateCodes.includes(candidateCode))
        );
      }) || null
    );
  }, [
    selectedEvent,
    selectedEventPendingDesdobramentoUnits,
    profileAlertCandidateIds,
    profileAlertCandidateCodes,
  ]);

  const showProfilePendingAlertInModal = useMemo(() => {
    return !!profilePendingUnitInSelectedEvent;
  }, [profilePendingUnitInSelectedEvent]);

  const profileScopeUnitIds = useMemo(() => {
    return getProfileScopeUnitIds(user, claims, permissions);
  }, [user, claims, permissions]);

  const profileScopeUnitCodes = useMemo(() => {
    return getProfileScopeUnitCodes(user, claims, permissions, unitMap);
  }, [user, claims, permissions, unitMap]);

  const userManagedScopeIds = useMemo(() => {
    const ids = new Set();

    resolvedPermissionUnitIds.forEach((id) => {
      if (!id || !unitMap[id]) return;
      ids.add(id);
      collectDescendantIds(id, childrenMap, ids);
    });

    return ids;
  }, [resolvedPermissionUnitIds, unitMap, childrenMap]);

  const eligibleDesdobramentoUnits = useMemo(() => {
    if (!selectedEvent || permissions.isAIOUser) return [];

    const directTargetUnits = getEventDirectTargetUnits(
      selectedEvent,
      units,
      unitMap
    );

    const directUnitId = String(
      directProfileUnitIdentity.unitId || permissions.activeUnitId || ""
    ).trim();
    const directUnitCode = normalizeCode(
      directProfileUnitIdentity.unitCode || permissions.activeUnitCode || ""
    );

    return directTargetUnits.filter((unit) => {
      const unitId = String(unit?.id || "").trim();
      const unitCode = getUnitCode(unit);

      if (permissions.usesScopeVisibility) {
        return (
          (unitId && userManagedScopeIds.has(unitId)) ||
          (unitCode && profileScopeUnitCodes.includes(unitCode))
        );
      }

      return (
        (directUnitId && unitId === directUnitId) ||
        (directUnitCode && unitCode === directUnitCode)
      );
    });
  }, [
    selectedEvent,
    permissions.isAIOUser,
    permissions.usesScopeVisibility,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    units,
    unitMap,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    userManagedScopeIds,
    profileScopeUnitCodes,
  ]);

  const shouldShowGestoraSubordinateSelector = useMemo(() => {
    if (!selectedEvent || permissions.isAIOUser || !permissions.isGestoraProfile) {
      return false;
    }

    const ownUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const ownUnitCode = normalizeCode(
      getUnitCode(unitMap[ownUnitId]) ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    const createdByUnitId = String(selectedEvent?.createdByUnitId || "").trim();
    const createdByUnitCode = normalizeCode(
      selectedEvent?.createdByUnitCode || getLeafCodeFromPath(selectedEvent?.unitPath)
    );

    return !(
      (ownUnitId && createdByUnitId === ownUnitId) ||
      (ownUnitCode && createdByUnitCode === ownUnitCode)
    );
  }, [
    selectedEvent,
    permissions.isAIOUser,
    permissions.isGestoraProfile,
    lockedProfileUnitId,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    unitMap,
  ]);

  const canViewGestoraSubordinateTree = useMemo(() => {
    return !!selectedEvent;
  }, [selectedEvent]);

  const gestoraSubordinateSelectionUnits = useMemo(() => {
    if (!shouldShowGestoraSubordinateSelector) return [];
    if (!lockedProfileUnitId || !unitMap[lockedProfileUnitId]) return [];

    const descendantIds = collectDescendantIds(lockedProfileUnitId, childrenMap, new Set());

    return Array.from(descendantIds)
      .map((unitId) => unitMap[unitId])
      .filter(Boolean)
      .sort(sortUnits);
  }, [
    shouldShowGestoraSubordinateSelector,
    lockedProfileUnitId,
    unitMap,
    childrenMap,
  ]);

  const canGestoraManageRequestedSubordinates = useMemo(() => {
    return (
      permissions.isGestoraProfile &&
      shouldShowGestoraSubordinateSelector &&
      gestoraSubordinateSelectionUnits.length > 0
    );
  }, [
    permissions.isGestoraProfile,
    shouldShowGestoraSubordinateSelector,
    gestoraSubordinateSelectionUnits,
  ]);

  const selectedSubordinateUnitsToInclude = useMemo(() => {
    if (!shouldShowGestoraSubordinateSelector) return [];

    const selectedIds = new Set(
      desdobramentoSelectedUnitIds.map((id) => String(id || "").trim()).filter(Boolean)
    );

    return gestoraSubordinateSelectionUnits.filter((unit) =>
      selectedIds.has(String(unit?.id || "").trim())
    );
  }, [
    shouldShowGestoraSubordinateSelector,
    desdobramentoSelectedUnitIds,
    gestoraSubordinateSelectionUnits,
  ]);

  const profileLockedDesdobramentoUnit = useMemo(() => {
    if (!selectedEvent || permissions.isAIOUser || permissions.isGestoraProfile) return null;

    const directUnitId = String(
      directProfileUnitIdentity.unitId || permissions.activeUnitId || ""
    ).trim();
    const directUnitCode = normalizeCode(
      directProfileUnitIdentity.unitCode || permissions.activeUnitCode || ""
    );

    return (
      eligibleDesdobramentoUnits.find((unit) => {
        const unitId = String(unit?.id || "").trim();
        const unitCode = getUnitCode(unit);

        return (
          (directUnitId && unitId === directUnitId) ||
          (directUnitCode && unitCode === directUnitCode)
        );
      }) || null
    );
  }, [
    selectedEvent,
    permissions.isAIOUser,
    permissions.isGestoraProfile,
    permissions.activeUnitId,
    permissions.activeUnitCode,
    eligibleDesdobramentoUnits,
    directProfileUnitIdentity.unitId,
    directProfileUnitIdentity.unitCode,
  ]);

  const selectedDesdobramentoUnit = useMemo(() => {
    if (profileLockedDesdobramentoUnit) return profileLockedDesdobramentoUnit;

    if (permissions.isGestoraProfile) {
      const ownUnit = eligibleDesdobramentoUnits.find(
        (unit) => String(unit?.id || "").trim() === String(lockedProfileUnitId || "").trim()
      );
      if (ownUnit) return ownUnit;
    }

    const normalizedSelectedId = String(desdobramentoUnitId || "").trim();
    if (normalizedSelectedId) {
      const matchedUnit = eligibleDesdobramentoUnits.find(
        (unit) => String(unit?.id || "").trim() === normalizedSelectedId
      );
      if (matchedUnit) return matchedUnit;
    }

    return eligibleDesdobramentoUnits[0] || null;
  }, [
    profileLockedDesdobramentoUnit,
    permissions.isGestoraProfile,
    lockedProfileUnitId,
    desdobramentoUnitId,
    eligibleDesdobramentoUnits,
  ]);

  const selectedDesdobramentoUnitsForUpload = useMemo(() => {
    if (!selectedEvent || permissions.isAIOUser) return [];
    return selectedDesdobramentoUnit ? [selectedDesdobramentoUnit] : [];
  }, [selectedEvent, permissions.isAIOUser, selectedDesdobramentoUnit]);

  const selectedUploadUnitsWithExistingDocs = useMemo(() => {
    return selectedDesdobramentoUnitsForUpload
      .map((unit) => ({
        unit,
        doc: findActiveDesdobramentoForUnit(desdobramentoDocuments, unit),
      }))
      .filter((item) => !!item.doc);
  }, [selectedDesdobramentoUnitsForUpload, desdobramentoDocuments]);

  const activeDesdobramentoForSelectedUnit = useMemo(() => {
    if (!selectedDesdobramentoUnit) return null;

    const targetCode = normalizeCode(getUnitCode(selectedDesdobramentoUnit));

    return (
      desdobramentoDocuments.find(
        (docItem) =>
          !docItem.isDeleted &&
          ((docItem.unitId && docItem.unitId === selectedDesdobramentoUnit.id) ||
            normalizeCode(docItem.unitCode) === targetCode)
      ) || null
    );
  }, [desdobramentoDocuments, selectedDesdobramentoUnit]);

  const previousDesdobramentoForSelectedUnit = useMemo(() => {
    if (!selectedDesdobramentoUnit) return null;

    const targetCode = normalizeCode(getUnitCode(selectedDesdobramentoUnit));

    return (
      selectedEventDocuments.find(
        (docItem) =>
          String(docItem.origin || "").toUpperCase() === "UNIT" &&
          (
            (docItem.unitId && docItem.unitId === selectedDesdobramentoUnit.id) ||
            normalizeCode(docItem.unitCode) === targetCode
          )
      ) || null
    );
  }, [selectedEventDocuments, selectedDesdobramentoUnit]);

  const gestoraRootDocumentForSubordinates = useMemo(() => {
    if (activeDesdobramentoForSelectedUnit) return activeDesdobramentoForSelectedUnit;
    if (gestoraOwnPlanningDocument) return gestoraOwnPlanningDocument;
    return null;
  }, [activeDesdobramentoForSelectedUnit, gestoraOwnPlanningDocument]);

  const activeRequestedSubordinateUnitIds = useMemo(() => {
    if (!gestoraRootDocumentForSubordinates) return [];

    return Array.from(
      new Set(
        toArray(gestoraRootDocumentForSubordinates?.requestedSubordinateUnitIds)
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    );
  }, [gestoraRootDocumentForSubordinates]);

  useEffect(() => {
    if (!shouldShowGestoraSubordinateSelector) {
      setDesdobramentoSelectedUnitIds([]);
      setShowGestoraSubordinateSelectorStep(false);
      setShowGestoraSubordinateSelectorInUpload(false);
      return;
    }

    if (!activeDesdobramentoForSelectedUnit) {
      setDesdobramentoSelectedUnitIds([]);
      setShowGestoraSubordinateSelectorStep(false);
      return;
    }

    setDesdobramentoSelectedUnitIds(activeRequestedSubordinateUnitIds);
  }, [
    shouldShowGestoraSubordinateSelector,
    activeDesdobramentoForSelectedUnit,
    activeRequestedSubordinateUnitIds,
  ]);
  const selectedProfileUnitDesdobramentoPending = useMemo(() => {
    if (!selectedDesdobramentoUnit) return false;

    const selectedUnitId = String(selectedDesdobramentoUnit?.id || "").trim();
    const selectedUnitCode = normalizeCode(getUnitCode(selectedDesdobramentoUnit));

    return selectedEventPendingDesdobramentoUnits.some((unit) => {
      const candidateId = String(unit?.id || "").trim();
      const candidateCode = normalizeCode(getUnitCode(unit));

      return (
        (selectedUnitId && candidateId === selectedUnitId) ||
        (selectedUnitCode && candidateCode === selectedUnitCode)
      );
    });
  }, [selectedDesdobramentoUnit, selectedEventPendingDesdobramentoUnits]);

  const canShowUploadDesdobramentoSection =
    !!selectedEvent &&
    !permissions.isAIOUser &&
    selectedDesdobramentoUnitsForUpload.length > 0 &&
    !(permissions.isGestoraProfile && !!gestoraOwnPlanningDocument);

  const selectedEventOriginDisplay = useMemo(() => {
    if (!selectedEvent) return "-";

    const origin = getEventOriginUnit(selectedEvent, unitMap);
    if (!origin) return selectedEvent.originType || "-";

    return origin.code || origin.name || selectedEvent.originType || "-";
  }, [selectedEvent, unitMap]);

  const selectedEventProtocolLabel = useMemo(() => {
    if (!selectedEvent) return "-";
    return fmtProtocolDate(
      selectedEvent.protocolDate ||
        selectedEvent.createdAt ||
        selectedEvent.startAt ||
        selectedEvent.updatedAt
    );
  }, [selectedEvent]);

  const selectedEventResponsibleName = useMemo(() => {
    if (!selectedEvent) return "Não informado";

    return (
      [
        selectedEvent.responsibleName,
        selectedEvent.contactName,
        selectedEvent.organizerName,
        selectedEvent.requesterName,
        selectedEvent.applicantName,
      ]
        .map((item) => String(item || "").trim())
        .find(Boolean) || "Não informado"
    );
  }, [selectedEvent]);

  const selectedEventResponsiblePhone = useMemo(() => {
    if (!selectedEvent) return "Não informado";

    return (
      [
        selectedEvent.responsiblePhone,
        selectedEvent.contactPhone,
        selectedEvent.organizerPhone,
        selectedEvent.phone,
        selectedEvent.requesterPhone,
      ]
        .map((item) => String(item || "").trim())
        .find(Boolean) || "Não informado"
    );
  }, [selectedEvent]);

  const selectedEventPublicDisplay = useMemo(() => {
    const value = formatEstimatedPublic(selectedEvent?.estimatedPublic);
    return value === "Não informado" ? value : `${value} pessoas`;
  }, [selectedEvent]);

  const visibleDesdobramentoDocuments = useMemo(() => {
    return desdobramentoDocuments.filter((docItem) => !docItem.isDeleted);
  }, [desdobramentoDocuments]);

  const selectedEventInvolvedDisplay = useMemo(() => {
    const labels = selectedEventUnitBadges
      .filter((badge) => !badge.isOrigin)
      .map((badge) => badge.code || badge.name || "")
      .filter(Boolean);

    if (labels.length) return labels.join(", ");

    return String(selectedEvent?.involved || selectedEvent?.involvedText || "Não informado");
  }, [selectedEventUnitBadges, selectedEvent]);

  useEffect(() => {
    if (!selectedEvent) {
      setDesdobramentoUnitId("");
      setDesdobramentoSelectedUnitIds([]);
      setDesdobramentoFile(null);
      setShowGestoraSubordinateSelectorStep(false);
      setDesdobramentoDocumentType("DESDOBRAMENTO");
      setReplaceDocumentTypes({});
      return;
    }

    setDesdobramentoFile(null);
    setShowGestoraSubordinateSelectorStep(false);
    setDesdobramentoDocumentType("DESDOBRAMENTO");
  }, [selectedEventId, selectedEvent]);

  useEffect(() => {
    if (!selectedEvent) {
      setDesdobramentoUnitId("");
      setDesdobramentoSelectedUnitIds([]);
      return;
    }

    const validUploadIds = eligibleDesdobramentoUnits
      .map((unit) => String(unit?.id || "").trim())
      .filter(Boolean);
    const validUploadIdSet = new Set(validUploadIds);

    if (profileLockedDesdobramentoUnit) {
      const lockedId = String(profileLockedDesdobramentoUnit.id || "").trim();
      setDesdobramentoUnitId(lockedId);
    } else {
      setDesdobramentoUnitId((current) => {
        const normalizedCurrent = String(current || "").trim();
        if (normalizedCurrent && validUploadIdSet.has(normalizedCurrent)) {
          return normalizedCurrent;
        }

        return validUploadIds[0] || "";
      });
    }

    if (shouldShowGestoraSubordinateSelector) {
      const validSubordinateIds = gestoraSubordinateSelectionUnits
        .map((unit) => String(unit?.id || "").trim())
        .filter(Boolean);
      const validSubordinateIdSet = new Set(validSubordinateIds);

      setDesdobramentoSelectedUnitIds((current) =>
        Array.from(
          new Set(
            (current || [])
              .map((id) => String(id || "").trim())
              .filter((id) => validSubordinateIdSet.has(id))
          )
        )
      );
      return;
    }

    setShowGestoraSubordinateSelectorStep(false);
    setDesdobramentoSelectedUnitIds([]);
  }, [
    selectedEvent,
    profileLockedDesdobramentoUnit,
    eligibleDesdobramentoUnits,
    shouldShowGestoraSubordinateSelector,
    gestoraSubordinateSelectionUnits,
  ]);

  function toggleDesdobramentoUploadUnit(unitId) {
    const normalizedId = String(unitId || "").trim();
    if (!normalizedId || documentActionLoading === "new:desdobramento") return;

    setDesdobramentoSelectedUnitIds((current) => {
      const currentIds = (current || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean);

      const hasUnit = currentIds.includes(normalizedId);
      const nextIds = hasUnit
        ? currentIds.filter((id) => id !== normalizedId)
        : [...currentIds, normalizedId];

      if (!hasUnit) {
        setDesdobramentoUnitId(normalizedId);
      } else if (String(desdobramentoUnitId || "").trim() === normalizedId) {
        setDesdobramentoUnitId(nextIds[0] || "");
      }

      return Array.from(new Set(nextIds));
    });
  }

  function selectAllEligibleDesdobramentoUnits() {
    const nextIds = gestoraSubordinateSelectionUnits
      .map((unit) => String(unit?.id || "").trim())
      .filter(Boolean);

    setDesdobramentoSelectedUnitIds(nextIds);
  }

  function clearEligibleDesdobramentoUnitsSelection() {
    setDesdobramentoSelectedUnitIds([]);
  }

  const totalEvents = filteredEvents.length;
  const ongoingCount = filteredEvents.filter(
    (ev) => getComputedEventStatus(ev) === "EM_ANDAMENTO"
  ).length;
  const expectedCount = filteredEvents.filter(
    (ev) => getComputedEventStatus(ev) === "PREVISTO"
  ).length;
  const closedCount = filteredEvents.filter(
    (ev) => getComputedEventStatus(ev) === "ENCERRADO"
  ).length;

  const monthLabel = calendarMonth.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  const calendarDays = buildCalendarDays(calendarMonth);

  const canManageSelectedEvent = useMemo(() => {
    return canManageEvent(selectedEvent, permissions, user);
  }, [selectedEvent, permissions, user]);

  const canShowTopEventActions = useMemo(() => {
    return canShowTopEventActionsForEvent(
      selectedEvent,
      permissions,
      user,
      directProfileUnitIdentity
    );
  }, [selectedEvent, permissions, user, directProfileUnitIdentity]);

  function goPrevMonth() {
    setCalendarMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
    );
  }

  function goNextMonth() {
    setCalendarMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
    );
  }

  function handleCalendarDayMouseDown(day) {
    if (!day) return;

    const value = toDateInputValue(day);
    setIsCalendarDragging(true);
    setCalendarDragStart(day);
    setFrom(value);
    setTo(value);
  }

  function handleCalendarDayMouseEnter(day) {
    if (!isCalendarDragging || !calendarDragStart || !day) return;

    const [rangeStart, rangeEnd] = buildOrderedDateRange(calendarDragStart, day);
    setFrom(toDateInputValue(rangeStart));
    setTo(toDateInputValue(rangeEnd));
  }

  function handleCalendarDayClick(day) {
    if (!day || isCalendarDragging) return;

    const value = toDateInputValue(day);
    setFrom(value);
    setTo(value);
  }

  function clearDateFilter() {
    setFrom("");
    setTo("");
  }

  function closeModal() {
    if (
      actionLoading === "delete" ||
      documentActionLoading ||
      documentActionLoading === "new:desdobramento"
    ) {
      return;
    }
    setSelectedEventId(null);
  }

  function handleEditEvent() {
    if (!selectedEvent || !canManageSelectedEvent) return;

    const payload = {
      mode: "edit",
      isRetification: true,
      distributionType: "RETIFICACAO",
      eventId: selectedEvent.id,
      event: serializeEventForEdit(selectedEvent),
      openedAt: new Date().toISOString(),
      openedByEmail: user?.email || null,
    };

    try {
      sessionStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Erro ao salvar payload de edição:", error);
    }

    if (typeof onCreateEvent === "function") {
      onCreateEvent(payload);
    }

    closeModal();
  }

  async function handleDeleteEvent() {
    if (!selectedEvent || !canManageSelectedEvent) return;

    const confirmed = window.confirm(
      `Deseja excluir o evento "${selectedEvent.title || "Sem nome"}"?`
    );

    if (!confirmed) return;

    setActionLoading("delete");

    try {
      await updateDoc(doc(db, "events", selectedEvent.id), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        deletedByEmail: user?.email || null,
        deletedByUid: user?.uid || null,
        deletedByActorType: permissions.isAIOUser ? "AIO" : "UNIT",
        status: "CANCELADO",
      });

      setEvents((prev) => prev.filter((ev) => ev.id !== selectedEvent.id));

      setEventDocumentsMap((prev) => {
        const next = { ...prev };
        delete next[selectedEvent.id];
        return next;
      });

      closeModal();
    } catch (error) {
      console.error("Erro ao excluir evento:", error);
      window.alert("Não foi possível excluir o evento.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleDeleteDocument(docItem) {
    if (
      !selectedEvent ||
      !docItem ||
      !canManageDocument(docItem, permissions, user, directProfileUnitIdentity)
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Deseja excluir o documento "${getDocumentTypeLabel(docItem)}"?`
    );

    if (!confirmed) return;

    setDocumentActionLoading(`${docItem.id}:delete`);

    try {
      const rootField = getDocumentRootField(docItem);

      if (rootField) {
        const currentEventState =
          events.find((ev) => ev.id === selectedEvent.id) || selectedEvent;

        const currentList = toArray(currentEventState?.[rootField]);
        const nowIso = new Date().toISOString();

        const { nextList, matched } = patchEmbeddedRootDocumentList(
          currentList,
          docItem,
          {
            isDeleted: true,
            deletedAt: nowIso,
            deletedByEmail: user?.email || null,
            deletedByUid: user?.uid || null,
            deletedByActorType: permissions.isAIOUser ? "AIO" : "UNIT",
            updatedAt: nowIso,
            updatedByEmail: user?.email || null,
            updatedByUid: user?.uid || null,
            lastRetificationType: "DELETED_FILE",
            retifiedAt: nowIso,
            retifiedByEmail: user?.email || null,
            retifiedByUid: user?.uid || null,
          }
        );

        if (matched) {
          await updateDoc(doc(db, "events", selectedEvent.id), {
            [rootField]: nextList,
            updatedAt: serverTimestamp(),
          });

          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === selectedEvent.id
                ? {
                    ...ev,
                    [rootField]: nextList,
                    updatedAt: new Date(),
                  }
                : ev
            )
          );

          return;
        }
      }

      await updateDoc(
        doc(db, "events", selectedEvent.id, "documents", docItem.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedByEmail: user?.email || null,
          deletedByUid: user?.uid || null,
          deletedByActorType: permissions.isAIOUser ? "AIO" : "UNIT",
          updatedAt: serverTimestamp(),
          updatedByEmail: user?.email || null,
          updatedByUid: user?.uid || null,
          lastRetificationType: "DELETED_FILE",
          retifiedAt: serverTimestamp(),
          retifiedByEmail: user?.email || null,
          retifiedByUid: user?.uid || null,
        }
      );

      setEventDocumentsMap((prev) => {
        const docs = prev[selectedEvent.id] || [];
        const updatedDocs = docs.map((item) =>
          item.id === docItem.id
            ? {
                ...item,
                isDeleted: true,
                deletedAt: new Date(),
                deletedByEmail: user?.email || null,
                deletedByUid: user?.uid || null,
                deletedByActorType: permissions.isAIOUser ? "AIO" : "UNIT",
                updatedAt: new Date(),
                updatedByEmail: user?.email || null,
                updatedByUid: user?.uid || null,
                lastRetificationType: "DELETED_FILE",
                retifiedAt: new Date(),
                retifiedByEmail: user?.email || null,
                retifiedByUid: user?.uid || null,
              }
            : item
        );

        return {
          ...prev,
          [selectedEvent.id]: updatedDocs,
        };
      });
    } catch (error) {
      console.error("Erro ao excluir documento:", error);
      window.alert(
        `Não foi possível excluir o documento.

Código: ${error?.code || "-"}
Mensagem: ${error?.message || "-"}`
      );
    } finally {
      setDocumentActionLoading("");
    }
  }

  async function handleReplaceDocument(docItem, file, selectedDocumentType) {
    if (
      !selectedEvent ||
      !docItem ||
      !file ||
      !canManageDocument(docItem, permissions, user, directProfileUnitIdentity)
    ) {
      return;
    }

    if (!isAllowedDocumentFile(file)) {
      window.alert("O arquivo deve ser PDF, DOC ou DOCX.");
      return;
    }

    if (file.size > MAX_DOCUMENT_SIZE) {
      window.alert("O arquivo deve ter no máximo 20 MB.");
      return;
    }

    const isUnitDocument = getDocumentOriginValue(docItem, "") === "UNIT";
    const normalizedDocumentType = normalizeDocumentType(
      selectedDocumentType,
      isUnitDocument ? "DESDOBRAMENTO" : "DOCUMENTO"
    );

    setDocumentActionLoading(`${docItem.id}:replace`);

    try {
      const targetUnitId = String(
        docItem.unitId || permissions.activeUnitId || ""
      ).trim();

      const targetUnitCode = normalizeCode(
        docItem.unitCode || permissions.activeUnitCode
      );

      const unitFolder = targetUnitId || targetUnitCode || "UNIDADE";

      const uploadResult = await uploadDocumentToStorageWithFallback(
        file,
        buildStorageUploadCandidatePaths({
          eventId: selectedEvent.id,
          fileName: file.name,
          category: isUnitDocument ? "DESDOBRAMENTO" : "DOCUMENTO",
          documentType: normalizedDocumentType,
          unitKey: isUnitDocument ? unitFolder : "",
        })
      );

      const { storagePath, downloadURL } = uploadResult;

      const rootField = getDocumentRootField(docItem);

      if (rootField) {
        const currentEventState =
          events.find((ev) => ev.id === selectedEvent.id) || selectedEvent;

        const currentList = toArray(currentEventState?.[rootField]);
        const nowIso = new Date().toISOString();

        const { nextList, matched } = patchEmbeddedRootDocumentList(
          currentList,
          docItem,
          (currentItem) => ({
            ...currentItem,
            fileName: file.name,
            fileType: file.type || "",
            mimeType: file.type || "",
            size: Number(file.size || 0),
            storagePath,
            downloadURL,
            documentType: normalizedDocumentType,
            category: isUnitDocument
              ? currentItem?.category || "DESDOBRAMENTO"
              : normalizedDocumentType,
            isDeleted: false,
            deletedAt: null,
            deletedByEmail: null,
            deletedByUid: null,
            deletedByActorType: null,
            replacedAt: nowIso,
            replacedByEmail: user?.email || null,
            replacedByUid: user?.uid || null,
            uploadedAt: nowIso,
            uploadedByEmail: user?.email || null,
            uploadedByUid: user?.uid || null,
            updatedAt: nowIso,
            updatedByEmail: user?.email || null,
            updatedByUid: user?.uid || null,
            lastRetificationType: "UPDATED_FILE",
            retifiedAt: nowIso,
            retifiedByEmail: user?.email || null,
            retifiedByUid: user?.uid || null,
          })
        );

        if (matched) {
          await updateDoc(doc(db, "events", selectedEvent.id), {
            [rootField]: nextList,
            updatedAt: serverTimestamp(),
          });

          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === selectedEvent.id
                ? {
                    ...ev,
                    [rootField]: nextList,
                    updatedAt: new Date(),
                  }
                : ev
            )
          );
        } else {
          await updateDoc(
            doc(db, "events", selectedEvent.id, "documents", docItem.id),
            {
              fileName: file.name,
              fileType: file.type || "",
              mimeType: file.type || "",
              size: Number(file.size || 0),
              storagePath,
              downloadURL,
              documentType: normalizedDocumentType,
              category: isUnitDocument
                ? docItem.category || "DESDOBRAMENTO"
                : normalizedDocumentType,
              isDeleted: false,
              deletedAt: null,
              deletedByEmail: null,
              deletedByUid: null,
              deletedByActorType: null,
              replacedAt: serverTimestamp(),
              replacedByEmail: user?.email || null,
              replacedByUid: user?.uid || null,
              uploadedAt: serverTimestamp(),
              uploadedByEmail: user?.email || null,
              uploadedByUid: user?.uid || null,
              updatedAt: serverTimestamp(),
              updatedByEmail: user?.email || null,
              updatedByUid: user?.uid || null,
              lastRetificationType: "UPDATED_FILE",
              retifiedAt: serverTimestamp(),
              retifiedByEmail: user?.email || null,
              retifiedByUid: user?.uid || null,
            }
          );

          setEventDocumentsMap((prev) => {
            const docs = prev[selectedEvent.id] || [];
            const updatedDocs = docs.map((item) =>
              item.id === docItem.id
                ? {
                    ...item,
                    fileName: file.name,
                    fileType: file.type || "",
                    mimeType: file.type || "",
                    size: Number(file.size || 0),
                    storagePath,
                    downloadURL,
                    documentType: normalizedDocumentType,
                    category: isUnitDocument
                      ? item.category || "DESDOBRAMENTO"
                      : normalizedDocumentType,
                    isDeleted: false,
                    deletedAt: null,
                    deletedByEmail: null,
                    deletedByUid: null,
                    deletedByActorType: null,
                    replacedAt: new Date(),
                    replacedByEmail: user?.email || null,
                    replacedByUid: user?.uid || null,
                    uploadedAt: new Date(),
                    uploadedByEmail: user?.email || null,
                    uploadedByUid: user?.uid || null,
                    updatedAt: new Date(),
                    updatedByEmail: user?.email || null,
                    updatedByUid: user?.uid || null,
                    lastRetificationType: "UPDATED_FILE",
                    retifiedAt: new Date(),
                    retifiedByEmail: user?.email || null,
                    retifiedByUid: user?.uid || null,
                  }
                : item
            );

            return {
              ...prev,
              [selectedEvent.id]: updatedDocs,
            };
          });
        }
      } else {
        await updateDoc(
          doc(db, "events", selectedEvent.id, "documents", docItem.id),
          {
            fileName: file.name,
            fileType: file.type || "",
            mimeType: file.type || "",
            size: Number(file.size || 0),
            storagePath,
            downloadURL,
            documentType: normalizedDocumentType,
            category: isUnitDocument
              ? docItem.category || "DESDOBRAMENTO"
              : normalizedDocumentType,
            isDeleted: false,
            deletedAt: null,
            deletedByEmail: null,
            deletedByUid: null,
            deletedByActorType: null,
            replacedAt: serverTimestamp(),
            replacedByEmail: user?.email || null,
            replacedByUid: user?.uid || null,
            uploadedAt: serverTimestamp(),
            uploadedByEmail: user?.email || null,
            uploadedByUid: user?.uid || null,
            updatedAt: serverTimestamp(),
            updatedByEmail: user?.email || null,
            updatedByUid: user?.uid || null,
            lastRetificationType: "UPDATED_FILE",
            retifiedAt: serverTimestamp(),
            retifiedByEmail: user?.email || null,
            retifiedByUid: user?.uid || null,
          }
        );

        setEventDocumentsMap((prev) => {
          const docs = prev[selectedEvent.id] || [];
          const updatedDocs = docs.map((item) =>
            item.id === docItem.id
              ? {
                  ...item,
                  fileName: file.name,
                  fileType: file.type || "",
                  mimeType: file.type || "",
                  size: Number(file.size || 0),
                  storagePath,
                  downloadURL,
                  documentType: normalizedDocumentType,
                  category: isUnitDocument
                    ? item.category || "DESDOBRAMENTO"
                    : normalizedDocumentType,
                  isDeleted: false,
                  deletedAt: null,
                  deletedByEmail: null,
                  deletedByUid: null,
                  deletedByActorType: null,
                  replacedAt: new Date(),
                  replacedByEmail: user?.email || null,
                  replacedByUid: user?.uid || null,
                  uploadedAt: new Date(),
                  uploadedByEmail: user?.email || null,
                  uploadedByUid: user?.uid || null,
                  updatedAt: new Date(),
                  updatedByEmail: user?.email || null,
                  updatedByUid: user?.uid || null,
                  lastRetificationType: "UPDATED_FILE",
                  retifiedAt: new Date(),
                  retifiedByEmail: user?.email || null,
                  retifiedByUid: user?.uid || null,
                }
              : item
          );

          return {
            ...prev,
            [selectedEvent.id]: updatedDocs,
          };
        });
      }
    } catch (error) {
      console.error("Erro ao substituir documento:", error);
      const attemptedPaths = toArray(error?.attemptedStoragePaths);
      const attemptedPathsMessage = attemptedPaths.length
        ? `

Caminhos testados:
${attemptedPaths.join("\n")}`
        : "";

      window.alert(
        `Não foi possível substituir o documento.

Código: ${error?.code || "-"}
Mensagem: ${error?.message || "-"}${attemptedPathsMessage}`
      );
    } finally {
      setDocumentActionLoading("");
      setReplacePickerDocId("");
    }
  }

  async function handleSaveRequestedSubordinates({ showSuccess = true } = {}) {
    if (
      !selectedEvent ||
      !permissions.isGestoraProfile ||
      !canGestoraManageRequestedSubordinates ||
      !gestoraRootDocumentForSubordinates
    ) {
      return { applied: false, selectedUnits: [] };
    }

    const selectedUnits = selectedSubordinateUnitsToInclude;
    const requestedPayload = buildRequestedSubordinateUnitsPayload(selectedUnits);
    const currentEventState =
      events.find((ev) => ev.id === selectedEvent.id) || selectedEvent;

    setSavingRequestedSubordinates(true);

    try {
      const targetRootDocument = gestoraRootDocumentForSubordinates;
      const rootField = getDocumentRootField(targetRootDocument);
      const nowIso = new Date().toISOString();

      if (rootField) {
        const currentList = toArray(currentEventState?.[rootField]);
        const { nextList, matched } = patchEmbeddedRootDocumentList(
          currentList,
          targetRootDocument,
          {
            ...requestedPayload,
            updatedAt: nowIso,
            updatedByEmail: user?.email || null,
            updatedByUid: user?.uid || null,
          }
        );

        if (matched) {
          await updateDoc(doc(db, "events", selectedEvent.id), {
            [rootField]: nextList,
            updatedAt: serverTimestamp(),
          });

          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === selectedEvent.id
                ? {
                    ...ev,
                    [rootField]: nextList,
                    updatedAt: new Date(),
                  }
                : ev
            )
          );

          setEventDocumentsMap((prev) => {
            const docs = prev[selectedEvent.id] || [];
            const updatedDocs = docs.map((item) =>
              item.id === targetRootDocument.id
                ? {
                    ...item,
                    ...requestedPayload,
                    updatedAt: new Date(),
                    updatedByEmail: user?.email || null,
                    updatedByUid: user?.uid || null,
                  }
                : item
            );

            return {
              ...prev,
              [selectedEvent.id]: updatedDocs,
            };
          });
        }
      } else {
        await updateDoc(
          doc(db, "events", selectedEvent.id, "documents", targetRootDocument.id),
          {
            ...requestedPayload,
            updatedAt: serverTimestamp(),
            updatedByEmail: user?.email || null,
            updatedByUid: user?.uid || null,
          }
        );

        const mirroredEntry = {
          ...buildEmbeddedDesdobramentoDoc(
            selectedEvent.id,
            targetRootDocument,
            0
          ),
          ...requestedPayload,
          updatedAt: nowIso,
          updatedByEmail: user?.email || null,
          updatedByUid: user?.uid || null,
        };

        const nextRootDesdobramentos = upsertEmbeddedDesdobramentoEntry(
          currentEventState?.desdobramentos,
          mirroredEntry
        );

        if (!isPlanningDocument(targetRootDocument)) {
          await updateDoc(doc(db, "events", selectedEvent.id), {
            desdobramentos: nextRootDesdobramentos,
            updatedAt: serverTimestamp(),
          });

          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === selectedEvent.id
                ? {
                    ...ev,
                    desdobramentos: nextRootDesdobramentos,
                    updatedAt: new Date(),
                  }
                : ev
            )
          );
        }

        setEventDocumentsMap((prev) => {
          const docs = prev[selectedEvent.id] || [];
          const updatedDocs = docs.map((item) =>
            item.id === targetRootDocument.id
              ? {
                  ...item,
                  ...requestedPayload,
                  updatedAt: new Date(),
                  updatedByEmail: user?.email || null,
                  updatedByUid: user?.uid || null,
                }
              : item
          );

          return {
            ...prev,
            [selectedEvent.id]: updatedDocs,
          };
        });
      }

      setShowGestoraSubordinateSelectorStep(false);

      if (showSuccess) {
        if (selectedUnits.length > 0) {
          window.alert(
            `Subordinadas marcadas como pendentes: ${selectedUnits
              .map((unit) => getUnitCode(unit) || getUnitLabel(unit))
              .join(", ")}.`
          );
        } else {
          window.alert("Nenhuma subordinada foi marcada como pendente.");
        }
      }

      return { applied: true, selectedUnits };
    } finally {
      setSavingRequestedSubordinates(false);
    }
  }

  async function handleUploadDesdobramento() {
    if (!selectedEvent) {
      window.alert("Nenhum evento foi selecionado.");
      return;
    }

    if (!canShowUploadDesdobramentoSection) {
      window.alert(
        "A seção de envio de desdobramento não está liberada para este perfil/unidade."
      );
      return;
    }

    if (!desdobramentoFile) {
      window.alert("Selecione o arquivo do desdobramento antes de enviar.");
      return;
    }

    const authUid = String(user?.uid || "").trim();
    const authEmail = String(user?.email || "").trim() || null;

    if (!authUid) {
      window.alert("Usuário não autenticado.");
      return;
    }

    const targetUnits = selectedDesdobramentoUnit ? [selectedDesdobramentoUnit] : [];

    if (!targetUnits.length) {
      window.alert("Nenhuma unidade válida foi identificada para o desdobramento.");
      return;
    }

    if (!isAllowedDocumentFile(desdobramentoFile)) {
      window.alert("O arquivo deve ser PDF, DOC ou DOCX.");
      return;
    }

    if (desdobramentoFile.size > MAX_DOCUMENT_SIZE) {
      window.alert("O arquivo deve ter no máximo 20 MB.");
      return;
    }

    const eligibleUnitIds = new Set(
      eligibleDesdobramentoUnits.map((unit) => String(unit?.id || "").trim()).filter(Boolean)
    );
    const eligibleUnitCodes = new Set(
      eligibleDesdobramentoUnits.map((unit) => getUnitCode(unit)).filter(Boolean)
    );

    const disallowedUnits = targetUnits.filter((unit) => {
      const unitId = String(unit?.id || "").trim();
      const unitCode = getUnitCode(unit);

      if (permissions.isGestoraProfile) {
        return !(
          (unitId && eligibleUnitIds.has(unitId)) ||
          (unitCode && eligibleUnitCodes.has(unitCode))
        );
      }

      const directUnitId = String(
        directProfileUnitIdentity.unitId ||
          permissions.activeUnitId ||
          user?.unitId ||
          claims?.unitId ||
          claims?.currentUnitId ||
          ""
      ).trim();
      const directUnitCode = normalizeCode(
        directProfileUnitIdentity.unitCode ||
          permissions.activeUnitCode ||
          user?.unitCode ||
          user?.sigla ||
          claims?.unitCode ||
          claims?.command ||
          ""
      );

      return !(
        (directUnitId && unitId && directUnitId === unitId) ||
        (directUnitCode && unitCode && directUnitCode === unitCode)
      );
    });

    if (disallowedUnits.length > 0) {
      window.alert(
        permissions.isGestoraProfile
          ? "Selecione apenas unidades do seu escopo vinculadas ao evento."
          : "O desdobramento só pode ser anexado pela própria unidade vinculada ao evento."
      );
      return;
    }

    const invalidEventUnits = targetUnits.filter((unit) => {
      const unitId = String(unit?.id || "").trim();
      const unitCode = getUnitCode(unit);

      return !(
        (unitId && getEventDirectTargetUnitIds(selectedEvent).has(unitId)) ||
        (unitCode && getEventDirectTargetUnitCodes(selectedEvent).has(unitCode))
      );
    });

    if (invalidEventUnits.length > 0) {
      window.alert(
        `As seguintes unidades não estão incluídas diretamente neste evento: ${invalidEventUnits
          .map((unit) => getUnitCode(unit) || getUnitLabel(unit))
          .join(", ")}.`
      );
      return;
    }

    const existingDocsByUnit = targetUnits
      .map((unit) => ({
        unit,
        doc: findActiveDesdobramentoForUnit(desdobramentoDocuments, unit),
      }))
      .filter((item) => !!item.doc);

    const unitsToCreate = targetUnits.filter((unit) => {
      const unitId = String(unit?.id || "").trim();
      const unitCode = getUnitCode(unit);

      return !existingDocsByUnit.some((item) => {
        const existingUnitId = String(item.unit?.id || "").trim();
        const existingUnitCode = getUnitCode(item.unit);
        return (unitId && existingUnitId === unitId) || (unitCode && existingUnitCode === unitCode);
      });
    });

    if (!unitsToCreate.length) {
      window.alert(
        `Já existe desdobramento para as unidades selecionadas: ${existingDocsByUnit
          .map((item) => getUnitCode(item.unit) || getUnitLabel(item.unit))
          .join(", ")}. Use a opção de substituir na lista de documentos.`
      );
      return;
    }

    const normalizedDocumentType = normalizeDocumentType(
      desdobramentoDocumentType,
      "DESDOBRAMENTO"
    );

    if (
      canGestoraManageRequestedSubordinates &&
      !showGestoraSubordinateSelectorInUpload
    ) {
      setDesdobramentoSelectedUnitIds(activeRequestedSubordinateUnitIds);
      setShowGestoraSubordinateSelectorInUpload(true);
      return;
    }

    setDocumentActionLoading("new:desdobramento");

    try {
      const createdLocalPayloads = [];
      let workingEventDesdobramentos =
        toArray((events.find((ev) => ev.id === selectedEvent.id) || selectedEvent)?.desdobramentos);
      let eventRootWasUpdated = false;
      let shouldSyncEventRootDesdobramentos = false;

      for (const targetUnit of unitsToCreate) {
        const targetUnitId = String(targetUnit?.id || "").trim();
        const targetUnitCode = getUnitCode(targetUnit);
        const unitFolder = targetUnitId || targetUnitCode || "UNIDADE";

        const uploadResult = await uploadDocumentToStorageWithFallback(
          desdobramentoFile,
          buildStorageUploadCandidatePaths({
            eventId: selectedEvent.id,
            fileName: desdobramentoFile.name,
            category: "DESDOBRAMENTO",
            documentType: normalizedDocumentType,
            unitKey: unitFolder,
          })
        );

        const { storagePath, downloadURL } = uploadResult;
        const documentRef = doc(collection(db, "events", selectedEvent.id, "documents"));
        const documentId = documentRef.id;

        const hadPreviousDocumentForUnit =
          !!findActiveDesdobramentoForUnit(selectedEventDocuments, targetUnit);

        const unitPath = (() => {
          const parts = [];
          const visited = new Set();
          let current = targetUnit;

          while (current && !visited.has(current.id)) {
            visited.add(current.id);
            parts.unshift(getUnitCode(current) || getUnitLabel(current));
            if (!current.parentUnitId || !unitMap[current.parentUnitId]) break;
            current = unitMap[current.parentUnitId];
          }

          return parts.join(" > ");
        })();

        const nowIso = new Date().toISOString();

        const requestedPayloadForCurrentUpload =
          permissions.isGestoraProfile &&
          shouldShowGestoraSubordinateSelector &&
          selectedDesdobramentoUnit &&
          String(targetUnitId || "").trim() === String(selectedDesdobramentoUnit?.id || "").trim()
            ? buildRequestedSubordinateUnitsPayload(selectedSubordinateUnitsToInclude)
            : null;

        const payload = {
          eventId: selectedEvent.id,
          fileName: desdobramentoFile.name,
          fileType: desdobramentoFile.type || "",
          mimeType: desdobramentoFile.type || "",
          size: Number(desdobramentoFile.size || 0),
          category: "DESDOBRAMENTO",
          documentType: normalizedDocumentType,
          documentScope: "UNIT",
          origin: "UNIT",
          unitId: targetUnitId || null,
          unitCode: targetUnitCode || null,
          unitName: getUnitLabel(targetUnit),
          unitPath,
          storagePath,
          downloadURL,
          uploadedByUid: authUid,
          uploadedByEmail: authEmail,
          uploadedByUnitId: targetUnitId || null,
          uploadedByUnitCode: targetUnitCode || null,
          uploadedByUnitName: getUnitLabel(targetUnit),
          updatedByUid: authUid,
          updatedByEmail: authEmail,
          ...(requestedPayloadForCurrentUpload || {}),
          uploadedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          isDeleted: false,
          lastRetificationType: hadPreviousDocumentForUnit ? "NEW_FILE" : null,
          retifiedAt: hadPreviousDocumentForUnit ? serverTimestamp() : null,
          retifiedByEmail: hadPreviousDocumentForUnit ? authEmail : null,
          retifiedByUid: hadPreviousDocumentForUnit ? authUid : null,
          addedInRetification: hadPreviousDocumentForUnit,
          addedInRetificationAt: hadPreviousDocumentForUnit
            ? serverTimestamp()
            : null,
        };

        const embeddedPayload = {
          id: documentId,
          eventId: selectedEvent.id,
          fileName: desdobramentoFile.name,
          fileType: desdobramentoFile.type || "",
          mimeType: desdobramentoFile.type || "",
          size: Number(desdobramentoFile.size || 0),
          category: "DESDOBRAMENTO",
          documentType: normalizedDocumentType,
          documentScope: "UNIT",
          origin: "UNIT",
          unitId: targetUnitId || null,
          unitCode: targetUnitCode || null,
          unitName: getUnitLabel(targetUnit),
          unitPath,
          storagePath,
          downloadURL,
          uploadedByUid: authUid,
          uploadedByEmail: authEmail,
          uploadedByUnitId: targetUnitId || null,
          uploadedByUnitCode: targetUnitCode || null,
          uploadedByUnitName: getUnitLabel(targetUnit),
          updatedByUid: authUid,
          updatedByEmail: authEmail,
          ...(requestedPayloadForCurrentUpload || {}),
          uploadedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
          isDeleted: false,
          lastRetificationType: hadPreviousDocumentForUnit ? "NEW_FILE" : null,
          retifiedAt: hadPreviousDocumentForUnit ? nowIso : null,
          retifiedByEmail: hadPreviousDocumentForUnit ? authEmail : null,
          retifiedByUid: hadPreviousDocumentForUnit ? authUid : null,
          addedInRetification: hadPreviousDocumentForUnit,
          addedInRetificationAt: hadPreviousDocumentForUnit ? nowIso : null,
        };

        let persistedVia = "SUBCOLLECTION";

        if (requestedPayloadForCurrentUpload) {
          workingEventDesdobramentos = upsertEmbeddedDesdobramentoEntry(
            workingEventDesdobramentos,
            embeddedPayload
          );
          shouldSyncEventRootDesdobramentos = true;
        }

        try {
          await setDoc(documentRef, payload);
        } catch (writeError) {
          const code = String(writeError?.code || "").toLowerCase();
          const message = String(writeError?.message || "").toLowerCase();
          const isPermissionDenied =
            code.includes("permission-denied") ||
            message.includes("missing or insufficient permissions");

          if (!isPermissionDenied) {
            throw writeError;
          }

          workingEventDesdobramentos = upsertEmbeddedDesdobramentoEntry(
            workingEventDesdobramentos,
            embeddedPayload
          );

          const eventRef = doc(db, "events", selectedEvent.id);
          let rootUpdated = false;
          let lastRootError = null;

          try {
            await updateDoc(eventRef, {
              desdobramentos: workingEventDesdobramentos,
            });
            rootUpdated = true;
          } catch (rootError) {
            lastRootError = rootError;
          }

          if (!rootUpdated) {
            try {
              await updateDoc(eventRef, {
                desdobramentos: workingEventDesdobramentos,
                updatedAt: serverTimestamp(),
              });
              rootUpdated = true;
            } catch (rootError2) {
              lastRootError = rootError2;
            }
          }

          if (!rootUpdated) {
            throw lastRootError || writeError;
          }

          persistedVia = "EVENT_DOC";
          eventRootWasUpdated = true;
        }

        const localPayload =
          persistedVia === "EVENT_DOC"
            ? buildEmbeddedDesdobramentoDoc(selectedEvent.id, embeddedPayload, 0)
            : {
                id: documentId,
                ...payload,
                origin: "UNIT",
                originType: "UNIT",
                documentScope: "UNIT",
                ...(requestedPayloadForCurrentUpload || {}),
                uploadedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                retifiedAt: hadPreviousDocumentForUnit ? new Date() : null,
                addedInRetificationAt: hadPreviousDocumentForUnit ? new Date() : null,
              };

        createdLocalPayloads.push(localPayload);
      }

      if (shouldSyncEventRootDesdobramentos && !eventRootWasUpdated) {
        await updateDoc(doc(db, "events", selectedEvent.id), {
          desdobramentos: workingEventDesdobramentos,
          updatedAt: serverTimestamp(),
        });
        eventRootWasUpdated = true;
      }

      setEventDocumentsMap((prev) => {
        const docs = prev[selectedEvent.id] || [];
        let nextDocs = [...docs];

        createdLocalPayloads.forEach((localPayload) => {
          const payloadUnitId = String(localPayload?.unitId || "").trim();
          const payloadUnitCode = normalizeCode(localPayload?.unitCode);

          nextDocs = nextDocs.filter((docItem) => {
            if (!docItem) return false;

            const sameUnitDesdobramento =
              String(docItem.category || "").toUpperCase() === "DESDOBRAMENTO" &&
              !docItem.isDeleted &&
              (
                (payloadUnitId && String(docItem.unitId || "") === payloadUnitId) ||
                (payloadUnitCode && normalizeCode(docItem.unitCode) === payloadUnitCode)
              );

            return !sameUnitDesdobramento;
          });

          nextDocs.unshift(localPayload);
        });

        nextDocs.sort((a, b) => {
          const da = normalizeToDate(a.uploadedAt);
          const dbd = normalizeToDate(b.uploadedAt);
          return (dbd?.getTime() || 0) - (da?.getTime() || 0);
        });

        return {
          ...prev,
          [selectedEvent.id]: nextDocs,
        };
      });

      if (eventRootWasUpdated) {
        setEvents((prev) =>
          prev.map((ev) =>
            ev.id === selectedEvent.id
              ? {
                  ...ev,
                  desdobramentos: workingEventDesdobramentos,
                  updatedAt: new Date(),
                }
              : ev
          )
        );
      }

      const skippedUnits = existingDocsByUnit.map((item) =>
        getUnitCode(item.unit) || getUnitLabel(item.unit)
      );
      const createdUnits = unitsToCreate.map((unit) =>
        getUnitCode(unit) || getUnitLabel(unit)
      );

      if (profileLockedDesdobramentoUnit) {
        setDesdobramentoUnitId(String(profileLockedDesdobramentoUnit?.id || ""));
      }

      setDesdobramentoFile(null);
      setShowGestoraSubordinateSelectorStep(false);
      setShowGestoraSubordinateSelectorInUpload(false);
      setDesdobramentoSelectedUnitIds([]);
      setDesdobramentoDocumentType("DESDOBRAMENTO");

      const selectedSubordinateLabels = selectedSubordinateUnitsToInclude.map(
        (unit) => getUnitCode(unit) || getUnitLabel(unit)
      );

      if (skippedUnits.length > 0) {
        window.alert(
          `Desdobramento anexado para ${createdUnits.join(", ")}. As seguintes unidades já possuíam arquivo e foram mantidas: ${skippedUnits.join(", ")}.`
        );
      } else if (shouldShowGestoraSubordinateSelector && selectedSubordinateLabels.length > 0) {
        window.alert(
          `Desdobramento da gestora anexado com sucesso. As seguintes subordinadas foram indicadas para inserir seus desdobramentos: ${selectedSubordinateLabels.join(", ")}.`
        );
      } else {
        window.alert("Desdobramento anexado com sucesso.");
      }
    } catch (error) {
      console.error("Erro ao anexar desdobramento:", error);
      const attemptedPaths = toArray(error?.attemptedStoragePaths);
      const attemptedPathsMessage = attemptedPaths.length
        ? `

Caminhos testados:
${attemptedPaths.join("\n")}`
        : "";

      window.alert(
        `Não foi possível anexar o desdobramento.

Código: ${error?.code || "-"}
Mensagem: ${error?.message || "-"}${attemptedPathsMessage}`
      );
    } finally {
      setDocumentActionLoading("");
    }
  }


  function renderDocumentActions(docItem, includeUnitBadge = false) {
    const baseCanManage = canManageDocument(docItem, permissions, user, directProfileUnitIdentity);

    const documentUnitId = getDocumentLinkedUnitId(docItem);
    const documentUnitCode = getDocumentLinkedUnitCode(docItem);

    const viewerUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const viewerUnitCode = normalizeCode(
      lockedProfileUnitCode ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    const isOwnUnitDocument =
      (viewerUnitId && documentUnitId && documentUnitId === viewerUnitId) ||
      (viewerUnitCode && documentUnitCode && documentUnitCode === viewerUnitCode);

    const isManagedSubordinateDocument =
      permissions.isGestoraProfile &&
      profileHasSubordinates &&
      !isHierarchyRestrictedViewer &&
      (
        (documentUnitId && userManagedScopeIds.has(documentUnitId)) ||
        (documentUnitCode &&
          (
            profileScopeUnitCodes.includes(documentUnitCode) ||
            resolvedPermissionUnitCodes.includes(documentUnitCode)
          ))
      );

    const canManage =
      permissions.canManageAll ||
      (
        baseCanManage &&
        (
          isOwnUnitDocument ||
          isManagedSubordinateDocument
        )
      );

    const canOpen = canOpenDocument(docItem, permissions);
    const isBusyDelete = documentActionLoading === `${docItem.id}:delete`;
    const isBusyReplace = documentActionLoading === `${docItem.id}:replace`;
    const isBusy = isBusyDelete || isBusyReplace;

    const replaceType =
      replaceDocumentTypes[docItem.id] || getEffectiveDocumentType(docItem);

    const documentTypeOptions = getDocumentTypeOptions(docItem.origin);
    const isReplacePickerOpen = replacePickerDocId === docItem.id;

    return (
      <div className="documentItemActions">
        {includeUnitBadge && (
          <span className="documentPill success">
            {docItem.unitCode || "UNIDADE"}
          </span>
        )}

        {!docItem.isDeleted && docItem.downloadURL && (
          <>
            <a
              href={docItem.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="documentActionBtn iconOnlyActionBtn"
              title="Visualizar documento"
              aria-label="Visualizar documento"
            >
              <ExternalLink size={15} />
              <span>Visualizar</span>
            </a>

            <a
              href={docItem.downloadURL}
              download={docItem.fileName || true}
              className="documentActionBtn secondary iconOnlyActionBtn"
              title="Baixar documento"
              aria-label="Baixar documento"
            >
              <Download size={15} />
              <span>Baixar</span>
            </a>
          </>
        )}

        {docItem.isDeleted && canOpen && docItem.downloadURL && (
          <>
            <a
              href={docItem.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="documentActionBtn iconOnlyActionBtn"
              title="Visualizar documento"
              aria-label="Visualizar documento"
            >
              <ExternalLink size={15} />
              <span>Visualizar</span>
            </a>

            <a
              href={docItem.downloadURL}
              download={docItem.fileName || true}
              className="documentActionBtn secondary iconOnlyActionBtn"
              title="Baixar documento"
              aria-label="Baixar documento"
            >
              <Download size={15} />
              <span>Baixar</span>
            </a>
          </>
        )}

        {!docItem.isDeleted && canManage && (
          <>
            {isReplacePickerOpen ? (
              <div
                style={{
                  minWidth: 220,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 10,
                  border: "1px solid #dbe2ea",
                  borderRadius: 12,
                  background: "#f8fafc",
                }}
              >
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#6b7280",
                  }}
                >
                  Tipo do arquivo
                </label>
                <select
                  value={replaceType}
                  disabled={isBusy}
                  onChange={(e) =>
                    setReplaceDocumentTypes((prev) => ({
                      ...prev,
                      [docItem.id]: e.target.value,
                    }))
                  }
                  style={{
                    height: 38,
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    padding: "0 10px",
                    fontSize: 13,
                    background: "#fff",
                  }}
                >
                  {documentTypeOptions.map((option) => (
                    <option key={`${docItem.id}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <label
                  className="documentActionBtn"
                  style={{ cursor: isBusy ? "not-allowed" : "pointer" }}
                >
                  {isBusyReplace ? (
                    <Loader2
                      size={15}
                      style={{ animation: "spin 0.9s linear infinite" }}
                    />
                  ) : (
                    <Pencil size={15} />
                  )}
                  <span>{isBusyReplace ? "Substituindo..." : "Escolher arquivo"}</span>
                  <input
                    type="file"
                    hidden
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    disabled={isBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleReplaceDocument(docItem, file, replaceType);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="documentActionBtn secondary"
                  onClick={() => setReplacePickerDocId("")}
                  disabled={isBusy}
                >
                  <X size={15} />
                  <span>Cancelar</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="documentActionBtn iconOnlyActionBtn"
                title="Substituir documento"
                aria-label="Substituir documento"
                onClick={() => {
                  setReplaceDocumentTypes((prev) => ({
                    ...prev,
                    [docItem.id]: prev[docItem.id] || getEffectiveDocumentType(docItem),
                  }));
                  setReplacePickerDocId(docItem.id);
                }}
                disabled={isBusy}
              >
                <Pencil size={15} />
                <span>Substituir documento</span>
              </button>
            )}

            <button
              type="button"
              className="documentActionBtn dangerSoft iconOnlyActionBtn"
              title="Excluir documento"
              aria-label="Excluir documento"
              onClick={() => handleDeleteDocument(docItem)}
              disabled={isBusy}
            >
              {isBusyDelete ? (
                <Loader2
                  size={15}
                  style={{ animation: "spin 0.9s linear infinite" }}
                />
              ) : (
                <Trash2 size={15} />
              )}
              <span>{isBusyDelete ? "Excluindo documento" : "Excluir documento"}</span>
            </button>
          </>
        )}

        {docItem.isDeleted && !permissions.isGlobalReader && (
          <span className="documentPill subtle">Arquivo indisponível</span>
        )}
      </div>
    );
  }

  function renderDocumentHeader(docItem, secondaryText) {
    const docRetified = hasDocumentRetification(docItem);
    const docRetifiedDate = getDocumentRetificationDate(docItem);

    return (
      <div className="documentTitleBlock">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <strong>{getDocumentTypeLabel(docItem)}</strong>
          {docRetified && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px",
                borderRadius: 999,
                background: "#fce7f3",
                color: "#be185d",
                border: "1px solid #f9a8d4",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              <BadgeCheck size={11} />
              <span>{docItem.isDeleted ? "Retificado / Excluído" : "Retificado"}</span>
            </span>
          )}
        </div>

        {!docItem.isDeleted && (
          <span className="documentTypeLabel">{secondaryText || "-"}</span>
        )}

        <DeletedDocumentNotice docItem={docItem} />
      </div>
    );
  }


  function renderGestoraRequestedSubordinatesBlock(docItem) {
    const requestedSubordinateBadges = getRequestedSubordinateBadges(docItem, unitMap);
    const requestedSubordinateTree = buildRequestedSubordinateTree(
      docItem,
      desdobramentoDocuments,
      unitMap
    );
    const docUnitId = getDocumentLinkedUnitId(docItem);
    const docUnitCode = getDocumentLinkedUnitCode(docItem);
    const isGestoraOwnDocument =
      permissions.isGestoraProfile &&
      ((lockedProfileUnitId && docUnitId === lockedProfileUnitId) ||
        (lockedProfileUnitCode && docUnitCode === lockedProfileUnitCode));

    const currentUnitId = String(
      lockedProfileUnitId ||
        directProfileUnitIdentity.unitId ||
        permissions.activeUnitId ||
        ""
    ).trim();

    const currentUnitCode = normalizeCode(
      lockedProfileUnitCode ||
        directProfileUnitIdentity.unitCode ||
        permissions.activeUnitCode ||
        ""
    );

    const isInsideViewerScope =
      permissions.isAIOUser ||
      permissions.isGlobalReader ||
      (!isHierarchyRestrictedViewer && docUnitId && userManagedScopeIds.has(docUnitId)) ||
      (!isHierarchyRestrictedViewer && docUnitCode && (profileScopeUnitCodes.includes(docUnitCode) || resolvedPermissionUnitCodes.includes(docUnitCode)));

    const canShowGestoraRequestedSubordinatesCard =
      !docItem.isDeleted &&
      canViewGestoraSubordinateTree &&
      requestedSubordinateBadges.length > 0 &&
      (
        isGestoraOwnDocument ||
        permissions.isAIOUser ||
        permissions.isGlobalReader ||
        isInsideViewerScope ||
        requestedSubordinateBadges.some((badge) => {
          const badgeUnitId = String(badge?.unitId || "").trim();
          const badgeUnitCode = normalizeCode(badge?.code);

          return (
            (currentUnitId && badgeUnitId === currentUnitId) ||
            (currentUnitCode && badgeUnitCode === currentUnitCode)
          );
        })
      );

    if (!canShowGestoraRequestedSubordinatesCard) return null;

    return (
      <div
        style={{
          marginTop: 0,
          paddingTop: 1,
          borderTop: "1px dashed #dbe2ea",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 1,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: 0.3,
            }}
          >
            Unidades subordinadas
          </div>

          <button
            type="button"
            className="documentActionBtn secondary"
            title={showGestoraSubordinateSelectorStep ? "Recolher" : "Expandir"}
            aria-label={showGestoraSubordinateSelectorStep ? "Recolher" : "Expandir"}
            style={{
              marginLeft: "auto",
              minWidth: 30,
              width: 30,
              height: 30,
              padding: 0,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1,
            }}
            onClick={() => setShowGestoraSubordinateSelectorStep((prev) => !prev)}
          >
            <span style={{ display: "inline-block", transform: "translateY(-1px)" }}>
              {showGestoraSubordinateSelectorStep ? "−" : "+"}
            </span>
          </button>
        </div>

        <div
          className="eventUnitBadges"
          style={{
            marginBottom: showGestoraSubordinateSelectorStep ? 2 : 0,
            gap: 6,
          }}
        >
          {requestedSubordinateBadges.map((badge) => {
            const badgeUnitId = String(badge?.unitId || "").trim();
            const badgeCode = normalizeCode(badge?.code);
            const hasUnitDesdobramento =
              (badgeUnitId && selectedEventDesdobramentoState.unitIds.has(badgeUnitId)) ||
              (!!badgeCode && selectedEventDesdobramentoState.unitCodes.has(badgeCode));

            return (
              <span
                key={`${docItem.id}-requested-${badge.key}`}
                className={[
                  "eventUnitBadge",
                  hasUnitDesdobramento ? "hasDesdobramento" : "",
                ].join(" ")}
                title={badge.name || badge.code || "UNIDADE"}
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                }}
              >
                {badge.code || badge.name || "UNIDADE"}
              </span>
            );
          })}
        </div>

        {showGestoraSubordinateSelectorStep && requestedSubordinateTree.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 2,
              marginTop: 0,
            }}
          >
            {requestedSubordinateTree.map((item) => {
              const badge = item.badge;
              const childDoc = item.document;
              const hasChildDoc = !!childDoc;

              return (
                <div
                  key={item.key}
                  style={{
                    marginLeft: 4,
                    paddingLeft: 6,
                    borderLeft: "2px solid #dbe2ea",
                  }}
                >
                  <div
                    className="compactTreeNodeCard"
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      background: "#f8fafc",
                      padding: hasChildDoc ? "7px 9px" : "6px 9px",
                    }}
                  >
                    {hasChildDoc ? (
                      <div
                        style={{
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div className="documentItemTitle" style={{ gap: 10, minWidth: 0 }}>
                            <DocumentFileIcon fileName={childDoc.fileName} />
                            {renderDocumentHeader(
                              childDoc,
                              childDoc.unitCode && childDoc.unitName
                                ? `${childDoc.unitCode} - ${childDoc.unitName}`
                                : childDoc.unitCode || childDoc.unitName || "UNIDADE"
                            )}
                          </div>

                          <span
                            className="documentPill success"
                            style={{ flexShrink: 0, padding: "4px 8px", fontSize: 10 }}
                          >
                            Recebido
                          </span>
                        </div>

                        <div className="documentPills" style={{ gap: 6 }}>
                          <span className="documentPill success">
                            {childDoc.unitCode || badge.code || "UNIDADE"}
                          </span>
                          {!childDoc.isDeleted && (
                            <>
                              <span className="documentPill subtle">
                                {childDoc.uploadedByEmail || "-"}
                              </span>
                              <span className="documentPill subtle">
                                {fmtDateTime(childDoc.uploadedAt)}
                              </span>
                            </>
                          )}

                          {childDoc.isDeleted && (
                            <span className="documentPill subtle">
                              {fmtDateTime(childDoc.deletedAt)}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 0 }}>
                          {renderDocumentActions(childDoc)}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              color: "#111827",
                            }}
                          >
                            {badge.code && badge.name
                              ? `${badge.code} — ${badge.name}`
                              : badge.code || badge.name || "UNIDADE"}
                          </div>

                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 11,
                              color: "#6b7280",
                              fontWeight: 600,
                            }}
                          >
                            Aguardando desdobramento.
                          </div>
                        </div>

                        <span
                          className="documentPill subtle"
                          style={{ flexShrink: 0, padding: "4px 8px", fontSize: 10 }}
                        >
                          Pendente
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }   return (
    <div className="dashboardShell">
      <CompactDocumentUiStyle />
      <AppSidebar
        user={user}
        claims={claims}
        active="home"
        onGoHome={onGoHome}
        onGoCreateEvent={onCreateEvent}
        onGoUnits={onOpenUnits}
        onGoAccess={onGoAccess}
      />

      <main className="dashboardMain">
        <div className="dashboardTopbar">
          <div>
            <div className="welcomeText">Bem-vinda à Mapoteca</div>
            <h1 className="pageTitle">Operações e Desdobramentos</h1>
          </div>

          <div className="viewSwitch">
            <button
              className={viewMode === "list" ? "viewBtn active" : "viewBtn"}
              onClick={() => setViewMode("list")}
              type="button"
            >
              <List size={16} />
              <span>Lista</span>
            </button>
            <button
              className={viewMode === "map" ? "viewBtn active" : "viewBtn"}
              onClick={() => setViewMode("map")}
              type="button"
            >
              <MapIcon size={16} />
              <span>Mapa</span>
            </button>
          </div>
        </div>

        <section className="summaryGrid">
          <div className="summaryCard">
            <div className="summaryIcon">
              <Shield size={20} />
            </div>
            <span className="summaryLabel">Total de operações</span>
            <strong className="summaryValue">{totalEvents}</strong>
          </div>

          <div className="summaryCard">
            <div className="summaryIcon">
              <Activity size={20} />
            </div>
            <span className="summaryLabel">Em andamento</span>
            <strong className="summaryValue">{ongoingCount}</strong>
          </div>

          <div className="summaryCard">
            <div className="summaryIcon">
              <Clock3 size={20} />
            </div>
            <span className="summaryLabel">Previstas</span>
            <strong className="summaryValue">{expectedCount}</strong>
          </div>

          <div className="summaryCard">
            <div className="summaryIcon">
              <CheckCircle2 size={20} />
            </div>
            <span className="summaryLabel">Encerradas</span>
            <strong className="summaryValue">{closedCount}</strong>
          </div>
        </section>

        <div
          className={[
            "dashboardContentGrid",
            isMapExpanded && viewMode === "map" ? "mapWorkspaceExpanded" : "",
          ].join(" ")}
        >
          <section className="mainPanel">
            <div className="contentCard">
              <div className="cardHeader">
                <div>
                  <h2 className="cardTitle">Filtros operacionais</h2>
                  <p className="cardSubtitle">
                    Ajuste período, unidade cadastrada e pesquisa para refinar
                    os eventos.
                  </p>
                </div>

                <button className="ghostBtn" onClick={clearDateFilter} type="button">
                  Limpar datas
                </button>
              </div>

              <div className="filtersGrid">
                <div className="field">
                  <label>Período inicial</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label>Período final</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>

                <div className="field fieldWide fieldSearchWide">
                  <label>Pesquisar</label>
                  <div className="inputWithIcon">
                    <Search size={16} />
                    <input
                      className="searchInput searchInputIcon"
                      placeholder="Pesquisar por título ou local"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label>Unidade</label>
                  <select
                    value={unitFilterId}
                    onChange={(e) => setUnitFilterId(e.target.value)}
                    disabled={!(permissions.isGlobalReader || permissions.usesScopeVisibility)}
                  >
                    {loadingUnits && visibleUnitOptions.length === 0 ? (
                      <option value="">Carregando unidade...</option>
                    ) : visibleUnitOptions.length === 0 ? (
                      <option value="">Unidade do perfil</option>
                    ) : (
                      visibleUnitOptions.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            </div>

            <div className="contentCard">
              <div className="cardHeader">
                <div>
                  <h2 className="cardTitle">
                    {viewMode === "list" ? "Operações / Eventos" : "Mapa operacional"}
                  </h2>
                  <p className="cardSubtitle">
                    {loading
                      ? "Carregando dados..."
                      : `${filteredEvents.length} evento(s) encontrado(s)`}
                  </p>
                </div>

                {viewMode === "map" && (
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => setIsMapExpanded((prev) => !prev)}
                  >
                    <ExternalLink size={15} />
                    <span>{isMapExpanded ? "Restaurar mapa" : "Maximizar mapa"}</span>
                  </button>
                )}
              </div>

              {viewMode === "map" && (
                <>
                  {mapEvents.length === 0 ? (
                    <div className="emptyState">
                      Nenhum evento com coordenadas válidas para exibir no mapa.
                    </div>
                  ) : (
                    <div className="mapWrap">
                      <MapContainer
                        center={[-3.119, -60.021]}
                        zoom={12}
                        style={{
                          height: isMapExpanded ? "calc(100vh - 260px)" : "560px",
                          width: "100%",
                        }}
                      >
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                        <MapViewportController
                          events={mapEvents}
                          selectedEventId={selectedEventId}
                        />

                        {mapEvents.map((ev) => {
                          const coords = getEventCoordinates(ev);
                          if (!coords) return null;

                          const computedStatus = getComputedEventStatus(ev);

                          return (
                            <Marker
                              key={ev.id}
                              position={coords}
                              riseOnHover
                              icon={getPinMarkerIcon(
                                computedStatus,
                                selectedEventId === ev.id
                              )}
                              eventHandlers={{
                                click: () => setSelectedEventId(ev.id),
                              }}
                            >
                              <Tooltip
                                direction="top"
                                offset={[0, -40]}
                                opacity={1}
                                sticky
                              >
                                <div className="eventMarkerTooltip">
                                  <div className="eventMarkerTooltipTitle">
                                    {ev.title || "Evento sem nome"}
                                  </div>

                                  <div className="eventMarkerTooltipLine">
                                    <MapPin size={12} />
                                    <span>{ev.location || "-"}</span>
                                  </div>

                                  <div className="eventMarkerTooltipLine">
                                    <Clock3 size={12} />
                                    <span>
                                      {fmtEventDateRange(ev.startAt, ev.endAt)} •{" "}
                                      {fmtEventTimeRange(ev.startAt, ev.endAt)}
                                    </span>
                                  </div>

                                  <div style={{ marginTop: 8 }}>
                                    <StatusPill status={computedStatus} small />
                                  </div>
                                </div>
                              </Tooltip>
                            </Marker>
                          );
                        })}
                      </MapContainer>
                    </div>
                  )}
                </>
              )}

              {viewMode === "list" && (
                <div className="eventsTable">
                  <div className="eventsHeader eventsHeaderCompact">
                    <span>Data</span>
                    <span style={{ fontSize: 11, marginBottom: 2 }}>Horário</span>
                    <span>Evento</span>
                    <span>Status</span>
                  </div>

                  {loading ? (
                    <div className="emptyState">Carregando eventos...</div>
                  ) : filteredEvents.length === 0 ? (
                    <div className="emptyState">Nenhum evento encontrado.</div>
                  ) : (
                    filteredEvents.map((ev) => {
                      const { start, end } = getEventRange(ev);
                      const computedStatus = getComputedEventStatus(ev);
                      const rowDocuments = mergeEventDocuments(
                        eventDocumentsMap[ev.id] || [],
                        getEventEmbeddedDocuments(ev)
                      );

                      const eventUnitBadges = buildEventUnitBadges(ev, unitMap);
                      const { unitIds: desdobramentoUnitIds, unitCodes: desdobramentoUnitCodes } =
                        getDesdobramentoUnitState(rowDocuments);

                      const pendingUnitsForRow = getPendingDesdobramentoUnits(
                        ev,
                        rowDocuments,
                        unitMap
                      );
                      const showPendingAlertForProfileInRow = pendingUnitsForRow.some((unit) => {
                        const candidateId = String(unit?.id || "").trim();
                        const candidateCode = normalizeCode(getUnitCode(unit));

                        return (
                          (candidateId && profileAlertCandidateIds.includes(candidateId)) ||
                          (candidateCode && profileAlertCandidateCodes.includes(candidateCode))
                        );
                      });

                      return (
                        <div
                          key={ev.id}
                          className={`eventRowCompact ${
                            selectedEventId === ev.id ? "rowSelected" : ""
                          }`}
                          onClick={() => setSelectedEventId(ev.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              setSelectedEventId(ev.id);
                            }
                          }}
                        >
                          <div className="colDate">{fmtEventDateRange(start, end)}</div>

                          <div className="colTime">
                            <b>{fmtHour(start)}</b> - <b>{fmtHour(end)}</b>
                          </div>

                          <div className="colTitle">
                            <div className="eventName">
                              {ev.title || ev.name || "Evento sem nome"}
                            </div>

                            {hasRetification(ev) && (
                              <RetifiedTag date={ev.retifiedAt} />
                            )}

                            {eventUnitBadges.length > 0 && (
                              <div className="eventUnitBadges">
                                {eventUnitBadges.map((badge) => {
                                  const codeNorm = normalizeCode(badge.code);
                                  const unitIdNorm = String(badge.unitId || "").trim();

                                  const hasDesdobramento =
                                    (unitIdNorm && desdobramentoUnitIds.has(unitIdNorm)) ||
                                    (!!codeNorm && desdobramentoUnitCodes.has(codeNorm));

                                  return (
                                    <span
                                      key={`${ev.id}-${badge.key}`}
                                      title={badge.name || badge.code || badge.label}
                                      className={[
                                        "eventUnitBadge",
                                        badge.isOrigin ? "originBadge" : "",
                                        hasDesdobramento ? "hasDesdobramento" : "",
                                      ].join(" ")}
                                    >
                                      {badge.isOrigin
                                        ? `Origem • ${badge.code || badge.name || "UNIDADE"}`
                                        : badge.code || badge.name || "UNIDADE"}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {showPendingAlertForProfileInRow && (
                              <MissingDesdobramentoTag />
                            )}
                          </div>

                          <div className="colStatus">
                            <StatusPill status={computedStatus} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="rightRail">
            <div className="contentCard">
              <div className="cardHeader cardHeaderCompact">
                <h3 className="cardTitle">Calendário</h3>

                <div className="calendarNav">
                  <button className="calendarNavBtn" onClick={goPrevMonth} type="button">
                    <ChevronLeft size={16} />
                  </button>
                  <button className="calendarNavBtn" onClick={goNextMonth} type="button">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div className="calendarMonth">{monthLabel}</div>

              <div className="calendarWeekdays">
                <span>D</span>
                <span>S</span>
                <span>T</span>
                <span>Q</span>
                <span>Q</span>
                <span>S</span>
                <span>S</span>
              </div>

              <div className="calendarGrid">
                {calendarDays.map((day, index) => {
                  const isToday = day && isSameDay(day, new Date());
                  const hasEvent =
                    day && filteredEvents.some((ev) => eventOccursOnDay(ev, day));
                  const isSelected = day && isDayInsideRange(day, from, to);

                  return (
                    <button
                      key={`${day ? day.toISOString() : "empty"}-${index}`}
                      type="button"
                      className={[
                        "calendarDay",
                        !day ? "calendarDayEmpty" : "",
                        isToday ? "calendarDayToday" : "",
                        hasEvent ? "calendarDayEvent" : "",
                        isSelected ? "calendarDaySelected" : "",
                      ].join(" ")}
                      onMouseDown={() => handleCalendarDayMouseDown(day)}
                      onMouseEnter={() => handleCalendarDayMouseEnter(day)}
                      onClick={() => handleCalendarDayClick(day)}
                      onDragStart={(e) => e.preventDefault()}
                      disabled={!day}
                    >
                      {day ? day.getDate() : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="contentCard">
              <div className="cardHeader cardHeaderCompact">
                <h3 className="cardTitle">Resumo rápido</h3>
              </div>

              <div className="miniList">
                {filteredEvents.slice(0, 5).map((ev) => {
                  const computedStatus = getComputedEventStatus(ev);

                  return (
                    <div key={ev.id} className="miniListItem">
                      <div className="miniListMain">
                        <strong>{ev.title}</strong>
                        <span className="inlineIconText">
                          <MapPin size={13} />
                          {ev.location}
                        </span>
                        {hasRetification(ev) && (
                          <RetifiedTag date={ev.retifiedAt} />
                        )}
                      </div>
                      <StatusPill status={computedStatus} small />
                    </div>
                  );
                })}

                {!loading && filteredEvents.length === 0 && (
                  <div className="emptyMini">Nenhum evento para exibir.</div>
                )}
              </div>
            </div>
          </aside>
        </div>

        {selectedEvent &&
          (() => {
            const computedStatus = getComputedEventStatus(selectedEvent);

            return (
              <div className="eventModalOverlay" onClick={closeModal}>
                <div
                  className="eventModal eventModalModern"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                >
                  <div
                    className="eventModalTopBand"
                    style={{ padding: "14px 18px 12px", minHeight: "auto" }}
                  >
                    <button
                      type="button"
                      className="eventModalClose eventModalCloseBand"
                      onClick={closeModal}
                      disabled={actionLoading === "delete" || !!documentActionLoading}
                      aria-label="Fechar modal"
                    >
                      <X size={22} />
                    </button>

                    <div className="eventModalTopContent" style={{ gap: 8 }}>
                      <span className="eventModalTopLabel" style={{ marginBottom: 2 }}>Evento / Operação</span>

                      <h2 className="eventModalTopTitle" style={{ margin: 0, lineHeight: 1.15 }}>
                        {selectedEvent.title || selectedEvent.name || "Evento sem nome"}
                      </h2>

                      <div className="eventModalTopDate" style={{ marginTop: 2 }}>
                        {fmtEventDateRange(selectedEvent.startAt, selectedEvent.endAt)}
                      </div>

                      <div className="eventModalTopBadges" style={{ marginTop: 2 }}>
                        <StatusPill status={computedStatus} />
                      </div>

                      {hasRetification(selectedEvent) && (
                        <RetifiedTag date={selectedEvent.retifiedAt} light />
                      )}

                      {canShowTopEventActions && (
                        <>
                          <div className="eventModalTopActions" style={{ marginTop: 6 }}>
                            <button
                              type="button"
                              className="eventTopActionBtn eventTopActionBtnPrimary"
                              onClick={handleEditEvent}
                              disabled={actionLoading === "delete" || !!documentActionLoading}
                            >
                              <Pencil size={16} />
                              <span>Editar / Retificar</span>
                            </button>

                            <button
                              type="button"
                              className="eventTopActionBtn eventTopActionBtnDanger"
                              onClick={handleDeleteEvent}
                              disabled={actionLoading === "delete" || !!documentActionLoading}
                            >
                              {actionLoading === "delete" ? (
                                <Loader2
                                  size={16}
                                  style={{ animation: "spin 0.9s linear infinite" }}
                                />
                              ) : (
                                <Trash2 size={16} />
                              )}
                              <span>{actionLoading === "delete" ? "Excluindo..." : "Excluir"}</span>
                            </button>
                          </div>

                          <div className="eventModalTopHint" style={{ marginTop: 6, fontSize: 12 }}>
                            Ao retificar, as unidades devem receber a atualização como novo envio.
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="eventModalBody">
                    <div className="eventModalInfoGroup" style={{ gap: 10, marginBottom: 10 }}>
                      <div className="eventModalInfoCard" style={{ minHeight: 0, padding: "10px 12px", borderRadius: 14 }}>
                        <div className="eventModalInfoIcon" style={{ width: 34, height: 34, minWidth: 34 }}>
                          <Clock3 size={16} />
                        </div>
                        <div className="eventModalInfoText" style={{ gap: 2, lineHeight: 1.15 }}>
                          <span style={{ fontSize: 11, marginBottom: 2 }}>Horário</span>
                          <strong style={{ fontSize: 14, lineHeight: 1.15 }}>
                            {fmtEventTimeRange(selectedEvent.startAt, selectedEvent.endAt)}
                          </strong>
                        </div>
                      </div>

                      <div className="eventModalInfoCard" style={{ minHeight: 0, padding: "10px 12px", borderRadius: 14 }}>
                        <div className="eventModalInfoIcon" style={{ width: 34, height: 34, minWidth: 34 }}>
                          <MapPin size={16} />
                        </div>
                        <div className="eventModalInfoText" style={{ gap: 2, lineHeight: 1.15 }}>
                          <span style={{ fontSize: 11, marginBottom: 2 }}>Local</span>
                          <strong style={{ fontSize: 14, lineHeight: 1.15 }}>
                            {selectedEvent.location ||
                              selectedEvent.address ||
                              "Local não informado"}
                          </strong>
                        </div>
                      </div>

                      <div className="eventModalInfoCard" style={{ minHeight: 0, padding: "10px 12px", borderRadius: 14 }}>
                        <div className="eventModalInfoIcon" style={{ width: 34, height: 34, minWidth: 34 }}>
                          <BadgeInfo size={16} />
                        </div>
                        <div className="eventModalInfoText" style={{ gap: 2, lineHeight: 1.15 }}>
                          <span style={{ fontSize: 11, marginBottom: 2 }}>Status / Tipo</span>
                          <strong style={{ fontSize: 14, lineHeight: 1.15 }}>
                            {statusLabel(computedStatus)} •{" "}
                            {typeLabel(selectedEvent.operationType)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="eventModalGrid eventModalGridCompact" style={{ gap: 10, marginTop: 2, marginBottom: 10 }}>
                      <div className="eventModalItem" style={{ minHeight: 0, padding: "10px 12px", borderRadius: 14 }}>
                        <span style={{ fontSize: 11, marginBottom: 2 }}>Público estimado</span>
                        <strong style={{ fontSize: 14, lineHeight: 1.15 }}>{formatEstimatedPublic(selectedEvent.estimatedPublic)}</strong>
                      </div>

                      <div className="eventModalItem" style={{ minHeight: 0, padding: "10px 12px", borderRadius: 14 }}>
                        <span style={{ fontSize: 11, marginBottom: 2 }}>Origem</span>
                        <strong style={{ fontSize: 14, lineHeight: 1.15 }}>{selectedEventOriginDisplay}</strong>
                      </div>
                    </div>

                    {Array.isArray(selectedEvent.responsibleUnits) &&
                      selectedEvent.responsibleUnits.length > 0 && (
                        <div className="eventModalSection">
                          <div className="sectionTitleRow">
                            <h3>Unidades responsáveis</h3>
                          </div>

                          <div className="eventModalTags">
                            {selectedEvent.responsibleUnits.map((unit, index) => (
                              <span
                                key={`${unit.unitId || unit.code || "resp"}-${index}`}
                                className="eventTag"
                              >
                                <b>{unit.code || "UNIDADE"}</b>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    {Array.isArray(selectedEvent.involvedUnits) &&
                      selectedEvent.involvedUnits.length > 0 && (
                        <div className="eventModalSection">
                          <div className="sectionTitleRow">
                            <h3>Unidades envolvidas</h3>
                          </div>

                          <div className="eventModalTags">
                            {selectedEvent.involvedUnits.map((unit, index) => (
                              <span
                                key={`${unit.unitId || unit.code || "inv"}-${index}`}
                                className="eventTag"
                              >
                                <b>{unit.code || "UNIDADE"}</b>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    <div className="eventModalSection">
                      <div className="sectionTitleRow">
                        <h3>{planningDocumentsSectionTitle}</h3>
                        <span className="sectionCounter">{planningDocuments.length}</span>
                      </div>

                      {loadingDocuments ? (
                        <div className="emptyMini">Carregando documentos...</div>
                      ) : planningDocuments.length === 0 ? (
                        <div className="emptyMini">Nenhum documento da AIO anexado.</div>
                      ) : (
                        <div className="documentsList modernDocumentsList">
                          {planningDocuments.map((docItem) => {
                            const docUnitId = String(docItem?.unitId || "").trim();
                            const docUnitCode = normalizeCode(docItem?.unitCode);
                            const isGestoraOwnDocument =
                              permissions.isGestoraProfile &&
                              (
                                (lockedProfileUnitId && docUnitId === lockedProfileUnitId) ||
                                (lockedProfileUnitCode && docUnitCode === lockedProfileUnitCode)
                              );
                            const requestedSubordinateBadges = getRequestedSubordinateBadges(docItem, unitMap);
                            const shouldRenderGestoraTreeInline =
                              !docItem.isDeleted &&
                              canViewGestoraSubordinateTree &&
                              (requestedSubordinateBadges.length > 0 || canGestoraManageRequestedSubordinates) &&
                              (
                                isGestoraOwnDocument ||
                                permissions.isAIOUser ||
                                permissions.isGlobalReader ||
                                requestedSubordinateBadges.some((badge) => {
                                  const badgeUnitId = String(badge?.unitId || "").trim();
                                  const badgeUnitCode = normalizeCode(badge?.code);

                                  return (
                                    (lockedProfileUnitId && badgeUnitId === lockedProfileUnitId) ||
                                    (lockedProfileUnitCode && badgeUnitCode === lockedProfileUnitCode)
                                  );
                                })
                              );

                            return (
                              <div key={docItem.id} className="documentItem modernDocumentItem compactDocCard">
                                <div className="documentLeftAccent aioAccent" />

                                <div className="documentItemMain" style={shouldRenderGestoraTreeInline ? { paddingRight: 132 } : undefined}>
                                  <div className="documentItemTitle">
                                    <DocumentFileIcon fileName={docItem.fileName} />
                                    {renderDocumentHeader(docItem, getPlanningDocumentSecondaryLabel(docItem))}
                                  </div>

                                  <div className="documentPills">
                                    {!docItem.isDeleted && (
                                      <>
                                        <span className="documentPill subtle">
                                          {docItem.uploadedByEmail || "-"}
                                        </span>
                                        <span className="documentPill subtle">
                                          {fmtDateTime(docItem.uploadedAt)}
                                        </span>
                                      </>
                                    )}

                                    {docItem.isDeleted && (
                                      <span className="documentPill subtle">
                                        {fmtDateTime(docItem.deletedAt)}
                                      </span>
                                    )}
                                  </div>

                                  {shouldRenderGestoraTreeInline ? (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: 8,
                                        right: 10,
                                        zIndex: 1,
                                      }}
                                    >
                                      {renderDocumentActions(docItem)}
                                    </div>
                                  ) : null}

                                  {renderGestoraRequestedSubordinatesBlock(docItem)}
                                </div>

                                {!shouldRenderGestoraTreeInline ? renderDocumentActions(docItem) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="eventModalSection">
                      <div className="sectionTitleRow">
                        <h3>Desdobramentos das unidades</h3>
                        <span className="sectionCounter">{displayedDesdobramentoDocuments.length}</span>
                      </div>

                      {showProfilePendingAlertInModal && (
                        <div style={{ marginBottom: 14 }}>
                          <MissingDesdobramentoTag
                            text={`Falta o desdobramento da unidade ${
                              profilePendingUnitInSelectedEvent
                                ? getUnitCode(profilePendingUnitInSelectedEvent) ||
                                  getUnitLabel(profilePendingUnitInSelectedEvent)
                                : selectedDesdobramentoUnit
                                ? getUnitCode(selectedDesdobramentoUnit) ||
                                  getUnitLabel(selectedDesdobramentoUnit)
                                : profileAlertUnit
                                ? getUnitCode(profileAlertUnit) ||
                                  getUnitLabel(profileAlertUnit)
                                : "do seu perfil"
                            }`}
                          />
                        </div>
                      )}

                      {loadingDocuments ? (
                        <div className="emptyMini">Carregando documentos...</div>
                      ) : displayedDesdobramentoDocuments.length === 0 ? (
                        <div className="emptyMini">
                          {permissions.isGestoraProfile && gestoraOwnPlanningDocument
                            ? "Somente as unidades subordinadas precisam anexar desdobramento neste evento."
                            : "Nenhum desdobramento anexado."}
                        </div>
                      ) : (
                        <div className="documentsList modernDocumentsList">
                          {displayedDesdobramentoDocuments.map((docItem) => {
                            const requestedSubordinateBadges = getRequestedSubordinateBadges(docItem, unitMap);
                            const docUnitId = String(docItem?.unitId || "").trim();
                            const docUnitCode = normalizeCode(docItem?.unitCode);
                            const isGestoraOwnDocument =
                              permissions.isGestoraProfile &&
                              (
                                (lockedProfileUnitId && docUnitId === lockedProfileUnitId) ||
                                (lockedProfileUnitCode && docUnitCode === lockedProfileUnitCode)
                              );
                            const canShowGestoraRequestedSubordinatesCard =
                              !docItem.isDeleted &&
                              canViewGestoraSubordinateTree &&
                              (requestedSubordinateBadges.length > 0 || canGestoraManageRequestedSubordinates) &&
                              (
                                isGestoraOwnDocument ||
                                permissions.isAIOUser ||
                                permissions.isGlobalReader ||
                                requestedSubordinateBadges.some((badge) => {
                                  const badgeUnitId = String(badge?.unitId || "").trim();
                                  const badgeUnitCode = normalizeCode(badge?.code);

                                  return (
                                    (lockedProfileUnitId && badgeUnitId === lockedProfileUnitId) ||
                                    (lockedProfileUnitCode && badgeUnitCode === lockedProfileUnitCode)
                                  );
                                })
                              );

                            return (
                              <div key={docItem.id} className="documentItem modernDocumentItem compactDocCard">
                                <div className="documentLeftAccent unitAccent" />

                                <div className="documentItemMain" style={canShowGestoraRequestedSubordinatesCard ? { paddingRight: 132 } : undefined}>
                                  <div className="documentItemTitle">
                                    <DocumentFileIcon fileName={docItem.fileName} />
                                    {renderDocumentHeader(
                                      docItem,
                                      docItem.unitCode && docItem.unitName
                                        ? `${docItem.unitCode} - ${docItem.unitName}`
                                        : docItem.unitCode || docItem.unitName || "UNIDADE"
                                    )}
                                  </div>

                                  <div className="documentPills">
                                    <span className="documentPill success">
                                      {docItem.unitCode || "UNIDADE"}
                                    </span>

                                    {!docItem.isDeleted && (
                                      <>
                                        <span className="documentPill subtle">
                                          {docItem.uploadedByEmail || "-"}
                                        </span>
                                        <span className="documentPill subtle">
                                          {fmtDateTime(docItem.uploadedAt)}
                                        </span>
                                      </>
                                    )}

                                    {docItem.isDeleted && (
                                      <span className="documentPill subtle">
                                        {fmtDateTime(docItem.deletedAt)}
                                      </span>
                                    )}
                                  </div>

                                  {canShowGestoraRequestedSubordinatesCard ? (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: 8,
                                        right: 10,
                                        zIndex: 1,
                                      }}
                                    >
                                      {renderDocumentActions(docItem)}
                                    </div>
                                  ) : null}

                                  {renderGestoraRequestedSubordinatesBlock(docItem)}
                                </div>

                                {!canShowGestoraRequestedSubordinatesCard ? renderDocumentActions(docItem) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {canShowUploadDesdobramentoSection && (
                      <div className="eventModalSection">
                        <div className="sectionTitleRow">
                          <h3>Anexar desdobramento da unidade</h3>
                        </div>

                        <div className="desdobramentoUploadBox">
                          {canGestoraManageRequestedSubordinates ? (
                            <div className="desdobramentoUploadInfo" style={{ marginBottom: 12 }}>
                              Quando a Gestora anexar o seu desdobramento, ela poderá indicar quais subordinadas também deverão inserir desdobramento. Depois da confirmação, essa seleção some e as unidades ficam pendentes.
                            </div>
                          ) : null}
                          
                          
                          <div className="desdobramentoUploadRow" style={{ flexWrap: "wrap" }}>
                            {selectedDesdobramentoUnitsForUpload.length > 0 ? (
                              selectedDesdobramentoUnitsForUpload.map((unit) => (
                                <span key={`selected-${unit.id}`} className="documentPill success">
                                  {`${getUnitCode(unit)} - ${getUnitLabel(unit)}`}
                                </span>
                              ))
                            ) : (
                              <span className="documentPill subtle">Nenhuma unidade selecionada</span>
                            )}
                          </div>

                          {selectedProfileUnitDesdobramentoPending && (
                            <div style={{ marginBottom: 12 }}>
                              <MissingDesdobramentoTag
                                text={`Falta o desdobramento da unidade ${
                                  profilePendingUnitInSelectedEvent
                                    ? getUnitCode(profilePendingUnitInSelectedEvent)
                                    : selectedDesdobramentoUnit
                                    ? getUnitCode(selectedDesdobramentoUnit)
                                    : profileAlertUnit
                                    ? getUnitCode(profileAlertUnit)
                                    : "do seu perfil"
                                }`}
                              />
                            </div>
                          )}

                          {selectedUploadUnitsWithExistingDocs.length > 0 ? (
                            <div className="desdobramentoUploadHint">
                              Já existe desdobramento para{" "}
                              <b>
                                {selectedDesdobramentoUnit
                                  ? `${getUnitCode(selectedDesdobramentoUnit)}`
                                  : "a unidade selecionada"}
                              </b>
                              . Para editar, use <b>Substituir</b> na lista de documentos.
                            </div>
                          ) : (
                            <>
                              {permissions.isGestoraProfile && selectedUploadUnitsWithExistingDocs.length > 0 && (
                                <div className="desdobramentoUploadHint">
                                  As seguintes unidades já possuem desdobramento e serão ignoradas neste envio: <b>{selectedUploadUnitsWithExistingDocs
                                    .map((item) => getUnitCode(item.unit) || getUnitLabel(item.unit))
                                    .join(", ")}</b>.
                                </div>
                              )}
                              <div className="desdobramentoUploadField">
                                <label>Arquivo do desdobramento</label>
                                <input
                                  type="file"
                                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                  onChange={(e) =>
                                    setDesdobramentoFile(e.target.files?.[0] || null)
                                  }
                                />
                              </div>

                              {desdobramentoFile && (
                                <>
                                  <div className="desdobramentoUploadField">
                                    <label>Tipo do arquivo</label>
                                    <select
                                      value={desdobramentoDocumentType}
                                      onChange={(e) => setDesdobramentoDocumentType(e.target.value)}
                                    >
                                      {getDocumentTypeOptions("UNIT").map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div className="desdobramentoUploadRow">
                                    <span className="documentPill subtle">
                                      {desdobramentoFile.name}
                                    </span>
                                  </div>
                                </>
                              )}

                              {canGestoraManageRequestedSubordinates && showGestoraSubordinateSelectorInUpload ? (
                                <div
                                  style={{
                                    marginTop: 8,
                                    marginBottom: 12,
                                    padding: "10px 12px",
                                    borderRadius: 12,
                                    border: "1px solid #dbe2ea",
                                    background: "#f8fafc",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      marginBottom: 10,
                                    }}
                                  >
                                    <div>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 800,
                                          color: "#374151",
                                        }}
                                      >
                                        Escolha as subordinadas que também receberão o evento
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          color: "#6b7280",
                                          fontWeight: 600,
                                          marginTop: 2,
                                        }}
                                      >
                                        Depois do envio do desdobramento da gestora, esta etapa some e as unidades marcadas ficam pendentes.
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      className="documentActionBtn secondary iconOnlyActionBtn"
                                      title="Fechar seleção"
                                      aria-label="Fechar seleção"
                                      onClick={() => setShowGestoraSubordinateSelectorInUpload(false)}
                                      disabled={documentActionLoading === "new:desdobramento"}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>

                                  <div className="desdobramentoUploadRow" style={{ marginBottom: 10, gap: 8 }}>
                                    <button
                                      type="button"
                                      className="documentActionBtn secondary"
                                      onClick={selectAllEligibleDesdobramentoUnits}
                                      disabled={documentActionLoading === "new:desdobramento"}
                                    >
                                      Selecionar todas
                                    </button>

                                    <button
                                      type="button"
                                      className="documentActionBtn secondary"
                                      onClick={clearEligibleDesdobramentoUnitsSelection}
                                      disabled={documentActionLoading === "new:desdobramento"}
                                    >
                                      Limpar
                                    </button>
                                  </div>

                                  <div
                                    style={{
                                      display: "grid",
                                      gap: 8,
                                      maxHeight: 220,
                                      overflowY: "auto",
                                      paddingRight: 4,
                                    }}
                                  >
                                    {gestoraSubordinateSelectionUnits.map((unit) => {
                                      const unitId = String(unit?.id || "").trim();
                                      const checked = desdobramentoSelectedUnitIds.includes(unitId);
                                      const hasExistingDoc = !!findActiveDesdobramentoForUnit(
                                        desdobramentoDocuments,
                                        unit
                                      );

                                      return (
                                        <label
                                          key={`upload-subordinate-${unitId}`}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 10,
                                            border: "1px solid #e5e7eb",
                                            borderRadius: 10,
                                            padding: "8px 10px",
                                            background: hasExistingDoc ? "#f8fafc" : "#fff",
                                            opacity: hasExistingDoc ? 0.72 : 1,
                                          }}
                                        >
                                          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => toggleDesdobramentoUploadUnit(unitId)}
                                              disabled={documentActionLoading === "new:desdobramento" || hasExistingDoc}
                                            />
                                            <span
                                              style={{
                                                fontSize: 12,
                                                fontWeight: 700,
                                                color: "#111827",
                                              }}
                                            >
                                              {`${getUnitCode(unit)} - ${getUnitLabel(unit)}`}
                                            </span>
                                          </span>

                                          <span className={`documentPill ${hasExistingDoc ? "success" : "subtle"}`}>
                                            {hasExistingDoc ? "Já anexou" : "Pendente"}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              <div className="desdobramentoUploadRow">
                                <button
                                  type="button"
                                  className="documentActionBtn compactUploadAction iconOnlyActionBtn"
                                  title="Anexar desdobramento"
                                  aria-label="Anexar desdobramento"
                                  onClick={handleUploadDesdobramento}
                                  disabled={
                                    !desdobramentoFile ||
                                    selectedDesdobramentoUnitsForUpload.length === 0 ||
                                    documentActionLoading === "new:desdobramento"
                                  }
                                >
                                  {documentActionLoading === "new:desdobramento" ? (
                                    <Loader2
                                      size={15}
                                      style={{ animation: "spin 0.9s linear infinite" }}
                                    />
                                  ) : (
                                    <Upload size={15} />
                                  )}
                                  <span>
                                    {documentActionLoading === "new:desdobramento"
                                      ? "Enviando desdobramento"
                                      : canGestoraManageRequestedSubordinates && !showGestoraSubordinateSelectorInUpload
                                      ? "Escolher subordinadas"
                                      : "Confirmar envio"}
                                  </span>
                                </button>

                                
                                {desdobramentoFile && (
                                  <button
                                    type="button"
                                    className="documentActionBtn secondary"
                                    onClick={() => {
                                      setDesdobramentoFile(null);
                                      setShowGestoraSubordinateSelectorInUpload(false);
                                      setDesdobramentoSelectedUnitIds(activeRequestedSubordinateUnitIds);
                                    }}
                                    disabled={documentActionLoading === "new:desdobramento"}
                                  >
                                    <X size={15} />
                                    <span>Limpar arquivo</span>
                                  </button>
                                )}
                              </div>

                              <div className="desdobramentoUploadInfo">
                                Após anexar, o documento ficará disponível na lista de desdobramentos.
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
      </main>
  
    </div>
  );
}
