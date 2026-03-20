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
  const name = String(docItem?.fileName || "").toLowerCase();
  const category = String(docItem?.category || "").toLowerCase();

  if (name.includes("plano") || category.includes("planejamento")) {
    return "Plano de Operação";
  }

  if (name.includes("ordem") || category.includes("ordem")) {
    return "Ordem de Operações";
  }

  if (name.includes("nota")) {
    return "Nota";
  }

  if (name.includes("cronograma")) {
    return "Cronograma";
  }

  if (name.includes("oficio") || name.includes("ofício")) {
    return "Ofício";
  }

  if (name.includes("desdobramento") || category.includes("desdobramento")) {
    return "Desdobramento";
  }

  return "Documento";
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
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase();
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
    ...toArray(user?.unitId),
    ...toArray(claims?.unitIds),
    ...toArray(user?.unitIds),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const orderedUnitCodes = [
    ...toArray(claims?.unitCode),
    ...toArray(claims?.command),
    ...toArray(user?.unitCode),
    ...toArray(user?.sigla),
    ...toArray(claims?.unitCodes),
    ...toArray(claims?.commands),
    ...toArray(user?.unitCodes),
  ]
    .map((item) => normalizeCode(item))
    .filter(Boolean);

  const unitIds = new Set(orderedUnitIds);
  const unitCodes = new Set(orderedUnitCodes);

  const roleTexts = [
    ...toArray(claims?.role),
    ...toArray(claims?.roles),
    ...toArray(claims?.profile),
    ...toArray(user?.role),
    ...toArray(user?.roles),
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const isAdminUser =
    roleTexts.includes("ADMIN") || roleTexts.includes("AIO_ADMIN");

  const isAIOUser =
    roleTexts.includes("AIO") ||
    roleTexts.includes("AIO_ADMIN") ||
    roleTexts.some(
      (role) =>
        role.includes("ASSESSORIA DE INTEGRACAO OPERACIONAL") ||
        role.includes("ASSESSORIA DE INTEGRAÇÃO OPERACIONAL")
    ) ||
    unitCodes.has("AIO") ||
    orderedUnitIds.includes("AIO");

  const canReadAll = claims?.canViewAll === true || isAdminUser || isAIOUser;
  const canManageAll = isAdminUser || isAIOUser;

  return {
    unitIds,
    unitCodes,
    activeUnitId: orderedUnitIds[0] || "",
    activeUnitCode: orderedUnitCodes[0] || "",
    isAIOUser,
    isAdminUser,
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

function canManageDocument(docItem, permissions, user) {
  if (!docItem) return false;
  if (permissions.canManageAll) return true;

  const origin = String(docItem.origin || "").toUpperCase();
  if (origin !== "UNIT") return false;

  if (user?.uid && docItem.uploadedByUid && docItem.uploadedByUid === user.uid) {
    return true;
  }

  if (
    user?.email &&
    docItem.uploadedByEmail &&
    String(docItem.uploadedByEmail).toLowerCase() === String(user.email).toLowerCase()
  ) {
    return true;
  }

  if (docItem.unitId && permissions.unitIds.has(docItem.unitId)) {
    return true;
  }

  if (
    normalizeCode(docItem.unitCode) &&
    permissions.unitCodes.has(normalizeCode(docItem.unitCode))
  ) {
    return true;
  }

  return false;
}

function shouldKeepDeletedDocumentVisible(docItem) {
  const origin = String(docItem?.origin || "").toUpperCase();
  const deletedByActorType = String(docItem?.deletedByActorType || "").toUpperCase();

  return origin === "UNIT" && deletedByActorType !== "AIO";
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

function hasDocumentRetification(docItem) {
  const type = String(docItem?.lastRetificationType || "").toUpperCase();

  return (
    type === "UPDATED_FILE" ||
    type === "NEW_FILE" ||
    !!docItem?.addedInRetification ||
    !!normalizeToDate(docItem?.retifiedAt) ||
    !!normalizeToDate(docItem?.replacedAt)
  );
}

function getDocumentRetificationDate(docItem) {
  return (
    normalizeToDate(docItem?.retifiedAt) ||
    normalizeToDate(docItem?.replacedAt) ||
    normalizeToDate(docItem?.addedInRetificationAt)
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

function getEventOriginUnit(ev) {
  if (!ev) return null;

  const code =
    normalizeCode(ev.createdByUnitCode) ||
    (String(ev.originType || "").toUpperCase() === "AIO" ? "AIO" : "") ||
    normalizeCode(getLeafCodeFromPath(ev.unitPath));

  const name =
    String(ev.createdByUnitName || "").trim() ||
    (code === "AIO" ? "Assessoria de Integração Operacional" : "");

  if (!code && !name) return null;

  return {
    key: `origin:${ev.createdByUnitId || code || name}`,
    unitId: ev.createdByUnitId || null,
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

function buildEventUnitBadges(ev) {
  if (!ev) return [];

  const result = [];
  const seen = new Set();

  const origin = getEventOriginUnit(ev);
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

function getEventDirectTargetUnitIds(ev) {
  const ids = new Set();

  toArray(ev?.responsibleUnitIds).forEach((id) => {
    if (id) ids.add(id);
  });

  toArray(ev?.participantUnitIds).forEach((id) => {
    if (id) ids.add(id);
  });

  if (Array.isArray(ev?.involvedUnits)) {
    ev.involvedUnits.forEach((unit) => {
      if (unit?.unitId) ids.add(unit.unitId);
    });
  }

  if (!ids.size && Array.isArray(ev?.responsibleUnits)) {
    ev.responsibleUnits.forEach((unit) => {
      if (unit?.unitId) ids.add(unit.unitId);
    });
  }

  return ids;
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
        width: 50,
        minWidth: 50,
        height: 58,
        borderRadius: 14,
        border: `1px solid ${border}`,
        background,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width="28"
        height="32"
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
  const [desdobramentoFile, setDesdobramentoFile] = useState(null);

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

  const resolvedPermissionUnitIds = useMemo(() => {
    const ids = new Set();

    permissions.unitIds.forEach((id) => {
      if (id) ids.add(id);
    });

    permissions.unitCodes.forEach((code) => {
      const resolvedId = codeToUnitIdMap[normalizeCode(code)];
      if (resolvedId) ids.add(resolvedId);
    });

    if (!ids.size && permissions.activeUnitCode) {
      const resolvedId = codeToUnitIdMap[normalizeCode(permissions.activeUnitCode)];
      if (resolvedId) ids.add(resolvedId);
    }

    if (permissions.activeUnitId) {
      ids.add(permissions.activeUnitId);
    }

    return Array.from(ids);
  }, [
    permissions.unitIds,
    permissions.unitCodes,
    permissions.activeUnitCode,
    permissions.activeUnitId,
    codeToUnitIdMap,
  ]);

  async function loadEvents() {
    setLoading(true);

    try {
      const refCollection = collection(db, "events");

      if (permissions.isGlobalReader) {
        const q = query(refCollection, orderBy("createdAt", "desc"), limit(500));
        const snap = await getDocs(q);

        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((row) => !row.isDeleted)
          .sort(sortEventsByPeriodDesc);

        setEvents(rows);
        return;
      }

      const queryUnitIds = Array.from(
        new Set(resolvedPermissionUnitIds.filter(Boolean))
      );

      if (queryUnitIds.length === 0) {
        setEvents([]);
        return;
      }

      const chunks = chunkArray(queryUnitIds, 10);

      const snapshots = await Promise.all(
        chunks.map(async (chunk) => {
          if (chunk.length === 1) {
            return getDocs(
              query(
                refCollection,
                where("visibleToUnitIds", "array-contains", chunk[0]),
                limit(500)
              )
            );
          }

          return getDocs(
            query(
              refCollection,
              where("visibleToUnitIds", "array-contains-any", chunk),
              limit(500)
            )
          );
        })
      );

      const mergedMap = new Map();

      snapshots.forEach((snap) => {
        snap.docs.forEach((d) => {
          const row = { id: d.id, ...d.data() };
          if (!row.isDeleted) {
            mergedMap.set(row.id, row);
          }
        });
      });

      const rows = Array.from(mergedMap.values()).sort(sortEventsByPeriodDesc);
      setEvents(rows);
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
  }, [permissions.isGlobalReader, resolvedPermissionUnitIds.join("|")]);

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
              console.error(
                `Erro ao carregar documentos do evento ${ev.id}:`,
                error
              );
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

  const selectedUnitScopeIds = useMemo(() => {
    if (!unitFilterId || !unitMap[unitFilterId]) return new Set();

    const ids = new Set([unitFilterId]);
    collectDescendantIds(unitFilterId, childrenMap, ids);

    return ids;
  }, [unitFilterId, unitMap, childrenMap]);

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
  }, [events, from, to, search, unitFilterId, selectedUnitScopeIds, unitMap]);

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
    return (eventDocumentsMap[selectedEventId] || []).filter(
      (docItem) => !docItem.isDeleted || shouldKeepDeletedDocumentVisible(docItem)
    );
  }, [eventDocumentsMap, selectedEventId]);

  const aioDocuments = useMemo(() => {
    return selectedEventDocuments.filter(
      (docItem) => String(docItem.origin || "").toUpperCase() === "AIO"
    );
  }, [selectedEventDocuments]);

  const desdobramentoDocuments = useMemo(() => {
    return selectedEventDocuments.filter(
      (docItem) => String(docItem.origin || "").toUpperCase() === "UNIT"
    );
  }, [selectedEventDocuments]);

  const selectedEventUnitBadges = useMemo(() => {
    return buildEventUnitBadges(selectedEvent);
  }, [selectedEvent]);

  const selectedEventUnitCodesWithDesdobramento = useMemo(() => {
    return getDesdobramentoUnitCodes(selectedEventDocuments);
  }, [selectedEventDocuments]);

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

    const directTargetIds = getEventDirectTargetUnitIds(selectedEvent);
    const rows = [];
    const seen = new Set();

    directTargetIds.forEach((id) => {
      if (!id || !userManagedScopeIds.has(id) || !unitMap[id] || seen.has(id)) {
        return;
      }

      seen.add(id);
      rows.push(unitMap[id]);
    });

    return rows.sort(sortUnits);
  }, [selectedEvent, permissions.isAIOUser, userManagedScopeIds, unitMap]);

  const selectedDesdobramentoUnit = useMemo(() => {
    return unitMap[desdobramentoUnitId] || null;
  }, [desdobramentoUnitId, unitMap]);

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

  const canShowUploadDesdobramentoSection =
    !!selectedEvent &&
    !permissions.isAIOUser &&
    eligibleDesdobramentoUnits.length > 0;

  const selectedEventOriginDisplay = useMemo(() => {
    if (!selectedEvent) return "-";

    const origin = getEventOriginUnit(selectedEvent);
    if (!origin) return selectedEvent.originType || "-";

    if (origin.code && origin.name) {
      return `${origin.code} — ${origin.name}`;
    }

    return origin.code || origin.name || selectedEvent.originType || "-";
  }, [selectedEvent]);

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

  const selectedPrimaryAioDocument = useMemo(() => {
    return aioDocuments.find((docItem) => !docItem.isDeleted) || aioDocuments[0] || null;
  }, [aioDocuments]);

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
      setDesdobramentoFile(null);
      return;
    }

    setDesdobramentoFile(null);
  }, [selectedEventId, selectedEvent]);

  useEffect(() => {
    if (!eligibleDesdobramentoUnits.length) {
      setDesdobramentoUnitId("");
      return;
    }

    setDesdobramentoUnitId((prev) => {
      const exists = eligibleDesdobramentoUnits.some((unit) => unit.id === prev);
      return exists ? prev : eligibleDesdobramentoUnits[0].id;
    });
  }, [eligibleDesdobramentoUnits]);

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
      !canManageDocument(docItem, permissions, user)
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Deseja excluir o documento "${getDocumentTypeLabel(docItem)}"?`
    );

    if (!confirmed) return;

    setDocumentActionLoading(`${docItem.id}:delete`);

    try {
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
      window.alert("Não foi possível excluir o documento.");
    } finally {
      setDocumentActionLoading("");
    }
  }

  async function handleReplaceDocument(docItem, file) {
    if (
      !selectedEvent ||
      !docItem ||
      !file ||
      !canManageDocument(docItem, permissions, user)
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

    setDocumentActionLoading(`${docItem.id}:replace`);

    try {
      const safeName = sanitizeFileName(file.name);
      const isUnitDocument = String(docItem.origin || "").toUpperCase() === "UNIT";

      let storagePath = "";

      if (isUnitDocument) {
        const targetUnitId = String(
          docItem.unitId || permissions.activeUnitId || ""
        ).trim();

        if (!targetUnitId) {
          window.alert("Não foi possível identificar a unidade do documento.");
          setDocumentActionLoading("");
          return;
        }

        storagePath = `events/${selectedEvent.id}/documents/desdobramentos/${targetUnitId}/${Date.now()}_${safeName}`;
      } else {
        storagePath = `events/${selectedEvent.id}/documents/planejamento/${Date.now()}_${safeName}`;
      }

      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      await updateDoc(
        doc(db, "events", selectedEvent.id, "documents", docItem.id),
        {
          fileName: file.name,
          fileType: file.type || "",
          storagePath,
          downloadURL,
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
                storagePath,
                downloadURL,
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
    } catch (error) {
      console.error("Erro ao substituir documento:", error);
      window.alert("Não foi possível substituir o documento.");
    } finally {
      setDocumentActionLoading("");
    }
  }

  async function handleUploadDesdobramento() {
    if (
      !selectedEvent ||
      !selectedDesdobramentoUnit ||
      !desdobramentoFile ||
      !canShowUploadDesdobramentoSection
    ) {
      return;
    }

    if (activeDesdobramentoForSelectedUnit) {
      window.alert(
        "Já existe um desdobramento para esta unidade. Use a opção de substituir abaixo para editar o arquivo enviado."
      );
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

    setDocumentActionLoading("new:desdobramento");

    try {
      const safeName = sanitizeFileName(desdobramentoFile.name);
      const storagePath = `events/${selectedEvent.id}/documents/desdobramentos/${selectedDesdobramentoUnit.id}/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, desdobramentoFile);
      const downloadURL = await getDownloadURL(storageRef);

      const newDocRef = doc(collection(db, "events", selectedEvent.id, "documents"));

      const payload = {
        fileName: desdobramentoFile.name,
        fileType: desdobramentoFile.type || "",
        category: "DESDOBRAMENTO",
        origin: "UNIT",
        unitId: selectedDesdobramentoUnit.id,
        unitCode: getUnitCode(selectedDesdobramentoUnit),
        unitName: getUnitLabel(selectedDesdobramentoUnit),
        unitPath: (() => {
          const parts = [];
          const visited = new Set();
          let current = selectedDesdobramentoUnit;

          while (current && !visited.has(current.id)) {
            visited.add(current.id);
            parts.unshift(getUnitCode(current) || getUnitLabel(current));
            if (!current.parentUnitId || !unitMap[current.parentUnitId]) break;
            current = unitMap[current.parentUnitId];
          }

          return parts.join(" > ");
        })(),
        storagePath,
        downloadURL,
        uploadedByUid: user?.uid || null,
        uploadedByEmail: user?.email || null,
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
        updatedByEmail: user?.email || null,
        isDeleted: false,
      };

      await setDoc(newDocRef, payload);

      const localPayload = {
        id: newDocRef.id,
        ...payload,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      };

      setEventDocumentsMap((prev) => {
        const docs = prev[selectedEvent.id] || [];
        const updatedDocs = [localPayload, ...docs].sort((a, b) => {
          const da = normalizeToDate(a.uploadedAt);
          const dbd = normalizeToDate(b.uploadedAt);
          return (dbd?.getTime() || 0) - (da?.getTime() || 0);
        });

        return {
          ...prev,
          [selectedEvent.id]: updatedDocs,
        };
      });

      setDesdobramentoFile(null);
    } catch (error) {
      console.error("Erro ao anexar desdobramento:", error);
      window.alert("Não foi possível anexar o desdobramento.");
    } finally {
      setDocumentActionLoading("");
    }
  }

  function renderDocumentActions(docItem, includeUnitBadge = false) {
    const canManage = canManageDocument(docItem, permissions, user);
    const canOpen = canOpenDocument(docItem, permissions);
    const isBusyDelete = documentActionLoading === `${docItem.id}:delete`;
    const isBusyReplace = documentActionLoading === `${docItem.id}:replace`;
    const isBusy = isBusyDelete || isBusyReplace;

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
              className="documentActionBtn"
            >
              <ExternalLink size={15} />
              <span>Visualizar</span>
            </a>

            <a
              href={docItem.downloadURL}
              download={docItem.fileName || true}
              className="documentActionBtn secondary"
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
              className="documentActionBtn"
            >
              <ExternalLink size={15} />
              <span>Visualizar</span>
            </a>

            <a
              href={docItem.downloadURL}
              download={docItem.fileName || true}
              className="documentActionBtn secondary"
            >
              <Download size={15} />
              <span>Baixar</span>
            </a>
          </>
        )}

        {!docItem.isDeleted && canManage && (
          <>
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
              <span>{isBusyReplace ? "Substituindo..." : "Substituir"}</span>
              <input
                type="file"
                hidden
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={isBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReplaceDocument(docItem, file);
                  e.target.value = "";
                }}
              />
            </label>

            <button
              type="button"
              className="documentActionBtn secondary"
              style={{
                background: "#fee2e2",
                color: "#991b1b",
              }}
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
              <span>{isBusyDelete ? "Excluindo..." : "Excluir"}</span>
            </button>
          </>
        )}

        {docItem.isDeleted && !permissions.isGlobalReader && (
          <span
            className="documentPill subtle"
            style={{
              background: "#f3f4f6",
              color: "#6b7280",
            }}
          >
            Arquivo indisponível
          </span>
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
          {docRetified && !docItem.isDeleted && (
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
              <span>Retificado</span>
            </span>
          )}
        </div>

        {!docItem.isDeleted && (
          <span className="documentTypeLabel">{secondaryText || "-"}</span>
        )}

        {docRetified && !docItem.isDeleted && docRetifiedDate && (
          <span
            style={{
              fontSize: 12,
              color: "#be185d",
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            Atualizado em {fmtDateTime(docRetifiedDate)}
          </span>
        )}

        <DeletedDocumentNotice docItem={docItem} />
      </div>
    );
  }

  return (
    <div className="dashboardShell">
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
                    disabled={loadingUnits}
                  >
                    <option value="">
                      {loadingUnits ? "Carregando unidades..." : "Todas"}
                    </option>

                    {unitOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
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
                    <span>Horário</span>
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
                      const eventUnitBadges = buildEventUnitBadges(ev);
                      const desdobramentoUnitCodes = getDesdobramentoUnitCodes(
                        eventDocumentsMap[ev.id] || []
                      );

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
                                  const hasDesdobramento =
                                    !!codeNorm &&
                                    desdobramentoUnitCodes.has(codeNorm);

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
                  className="eventModal"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="eventModalHeader">
                    <div className="eventModalHeaderTop">
                      <div className="eventModalProtocol">
                        DATA DO PROTOCOLO {selectedEventProtocolLabel}
                      </div>

                      <h2>
                        {selectedEvent.title || selectedEvent.name || "Evento sem nome"}
                      </h2>
                    </div>

                    <button
                      type="button"
                      className="eventModalClose"
                      onClick={closeModal}
                      disabled={
                        actionLoading === "delete" ||
                        !!documentActionLoading
                      }
                      aria-label="Fechar modal"
                    >
                      <X size={22} />
                    </button>
                  </div>

                  <div className="eventModalBody">
                    <section className="eventModalInfoPanel">
                      <div className="eventModalGridCustom">
                        <div className="eventModalBlock">
                          <div className="eventModalBlockLabel">Data e horário</div>

                          <div className="eventModalValueStack">
                            <div className="eventModalValueRow">
                              <CalendarDays size={24} />
                              <strong>
                                {fmtEventDateRange(
                                  selectedEvent.startAt,
                                  selectedEvent.endAt
                                )}
                              </strong>
                            </div>

                            <div className="eventModalValueRow">
                              <Clock3 size={24} />
                              <span>
                                {fmtEventTimeRange(
                                  selectedEvent.startAt,
                                  selectedEvent.endAt
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="eventModalBlock">
                          <div className="eventModalBlockLabel">Localização</div>

                          <div className="eventModalValueRow eventModalValueWrap">
                            <MapPin size={24} />
                            <strong>
                              {selectedEvent.location ||
                                selectedEvent.address ||
                                "Local não informado"}
                            </strong>
                          </div>
                        </div>

                        <div className="eventModalBlock">
                          <div className="eventModalBlockLabel">Responsável</div>

                          <div className="eventModalValueStack">
                            <div className="eventModalValueRow">
                              <UserRound size={24} />
                              <span>{selectedEventResponsibleName}</span>
                            </div>

                            <div className="eventModalValueRow">
                              <Phone size={24} />
                              <span>{selectedEventResponsiblePhone}</span>
                            </div>
                          </div>
                        </div>

                        <div className="eventModalBlock">
                          <div className="eventModalBlockLabel">Público estimado</div>

                          <div className="eventModalValueRow">
                            <Users size={24} />
                            <span>{selectedEventPublicDisplay}</span>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="eventModalDocCard">
                      <div className="eventModalDocTitle">
                        <FileText size={22} />
                        <span>OFÍCIO DE SOLICITAÇÃO:</span>
                      </div>

                      {selectedPrimaryAioDocument?.downloadURL ? (
                        <a
                          className="eventModalDocButton"
                          href={selectedPrimaryAioDocument.downloadURL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FolderOpen size={28} />
                          <span>ABRIR DOCUMENTO</span>
                        </a>
                      ) : (
                        <div
                          className="eventModalDocButton"
                          style={{
                            opacity: 0.58,
                            cursor: "not-allowed",
                          }}
                        >
                          <FolderOpen size={28} />
                          <span>DOCUMENTO NÃO DISPONÍVEL</span>
                        </div>
                      )}

                      {selectedPrimaryAioDocument &&
                        hasDocumentRetification(selectedPrimaryAioDocument) && (
                          <div style={{ marginTop: 10 }}>
                            <RetifiedTag
                              date={getDocumentRetificationDate(
                                selectedPrimaryAioDocument
                              )}
                              text="Documento retificado"
                            />
                          </div>
                        )}
                    </section>

                    <section className="eventModalSection">
                      <h3 className="eventModalSectionTitle">Envolvidos:</h3>
                      <div className="eventModalText">
                        {selectedEventInvolvedDisplay}
                      </div>
                    </section>

                    {!!selectedEvent.description && (
                      <section className="eventModalSection">
                        <h3 className="eventModalSectionTitle">Descrição:</h3>
                        <div className="eventModalTextSmall">
                          {selectedEvent.description}
                        </div>
                      </section>
                    )}

                    {visibleDesdobramentoDocuments.length > 0 ? (
                      <section className="eventModalDeploymentList">
                        {visibleDesdobramentoDocuments.map((docItem) => {
                          const unitLabel = docItem.unitCode
                            ? `${docItem.unitCode} - ${
                                docItem.unitName || "Unidade"
                              }`
                            : docItem.unitName || "Unidade";

                          return (
                            <div
                              key={docItem.id}
                              className="eventModalDeploymentCard"
                              role={docItem.downloadURL ? "button" : undefined}
                              tabIndex={docItem.downloadURL ? 0 : -1}
                              onClick={() => {
                                if (docItem.downloadURL) {
                                  window.open(docItem.downloadURL, "_blank", "noopener,noreferrer");
                                }
                              }}
                              onKeyDown={(e) => {
                                if (
                                  docItem.downloadURL &&
                                  (e.key === "Enter" || e.key === " ")
                                ) {
                                  e.preventDefault();
                                  window.open(
                                    docItem.downloadURL,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                                }
                              }}
                              style={{
                                cursor: docItem.downloadURL ? "pointer" : "default",
                              }}
                            >
                              <div className="eventModalDeploymentIcon">
                                <FolderOpen size={28} />
                              </div>

                              <div className="eventModalDeploymentMeta">
                                <span>Desdobramento</span>
                                <strong>{unitLabel}</strong>

                                {hasDocumentRetification(docItem) && (
                                  <RetifiedTag
                                    date={getDocumentRetificationDate(docItem)}
                                    text="Documento retificado"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </section>
                    ) : (
                      <section className="eventModalSection">
                        <h3 className="eventModalSectionTitle">Desdobramentos:</h3>
                        <div className="emptyMini">
                          Nenhum desdobramento anexado.
                        </div>
                      </section>
                    )}

                    {canShowUploadDesdobramentoSection && (
                      <section className="eventModalSection">
                        <h3 className="eventModalSectionTitle">
                          Anexar desdobramento da unidade
                        </h3>

                        <div className="desdobramentoUploadBox">
                          {eligibleDesdobramentoUnits.length > 1 ? (
                            <div className="desdobramentoUploadField">
                              <label>Unidade para envio</label>
                              <select
                                value={desdobramentoUnitId}
                                onChange={(e) =>
                                  setDesdobramentoUnitId(e.target.value)
                                }
                              >
                                {eligibleDesdobramentoUnits.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {getUnitCode(unit)} - {getUnitLabel(unit)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="desdobramentoUploadRow">
                              <span className="documentPill success">
                                {selectedDesdobramentoUnit
                                  ? `${getUnitCode(selectedDesdobramentoUnit)} - ${getUnitLabel(
                                      selectedDesdobramentoUnit
                                    )}`
                                  : "UNIDADE"}
                              </span>
                            </div>
                          )}

                          {activeDesdobramentoForSelectedUnit ? (
                            <div className="desdobramentoUploadHint">
                              Já existe desdobramento para{" "}
                              <b>
                                {selectedDesdobramentoUnit
                                  ? `${getUnitCode(selectedDesdobramentoUnit)}`
                                  : "a unidade selecionada"}
                              </b>
                              . Para editar, use <b>Substituir</b> na lista de
                              documentos.
                            </div>
                          ) : (
                            <>
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
                                <div className="desdobramentoUploadRow">
                                  <span className="documentPill subtle">
                                    {desdobramentoFile.name}
                                  </span>
                                </div>
                              )}

                              <div className="desdobramentoUploadRow">
                                <button
                                  type="button"
                                  className="documentActionBtn"
                                  onClick={handleUploadDesdobramento}
                                  disabled={
                                    !desdobramentoFile ||
                                    documentActionLoading === "new:desdobramento"
                                  }
                                >
                                  {documentActionLoading === "new:desdobramento" ? (
                                    <Loader2
                                      size={15}
                                      style={{
                                        animation: "spin 0.9s linear infinite",
                                      }}
                                    />
                                  ) : (
                                    <Upload size={15} />
                                  )}
                                  <span>
                                    {documentActionLoading === "new:desdobramento"
                                      ? "Enviando..."
                                      : "Anexar desdobramento"}
                                  </span>
                                </button>

                                {desdobramentoFile && (
                                  <button
                                    type="button"
                                    className="documentActionBtn secondary"
                                    onClick={() => setDesdobramentoFile(null)}
                                    disabled={
                                      documentActionLoading === "new:desdobramento"
                                    }
                                  >
                                    <X size={15} />
                                    <span>Limpar arquivo</span>
                                  </button>
                                )}
                              </div>

                              <div className="desdobramentoUploadInfo">
                                Após anexar, o documento ficará disponível na lista
                                de desdobramentos.
                              </div>
                            </>
                          )}
                        </div>
                      </section>
                    )}

                    {canManageSelectedEvent && (
                      <section className="eventModalSection">
                        <h3 className="eventModalSectionTitle">Ações do evento</h3>

                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={handleEditEvent}
                            disabled={
                              actionLoading === "delete" || !!documentActionLoading
                            }
                            style={{
                              border: 0,
                              borderRadius: 14,
                              padding: "12px 16px",
                              cursor:
                                actionLoading === "delete" || !!documentActionLoading
                                  ? "not-allowed"
                                  : "pointer",
                              fontWeight: 800,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              background: "#0a8b63",
                              color: "#ffffff",
                              opacity:
                                actionLoading === "delete" || !!documentActionLoading
                                  ? 0.7
                                  : 1,
                            }}
                          >
                            <Pencil size={16} />
                            <span>Editar / Retificar</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleDeleteEvent}
                            disabled={
                              actionLoading === "delete" || !!documentActionLoading
                            }
                            style={{
                              border: "1px solid #fecaca",
                              borderRadius: 14,
                              padding: "12px 16px",
                              cursor:
                                actionLoading === "delete" || !!documentActionLoading
                                  ? "not-allowed"
                                  : "pointer",
                              fontWeight: 800,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              background: "#fee2e2",
                              color: "#991b1b",
                              opacity:
                                actionLoading === "delete" || !!documentActionLoading
                                  ? 0.8
                                  : 1,
                            }}
                          >
                            {actionLoading === "delete" ? (
                              <Loader2
                                size={16}
                                style={{ animation: "spin 0.9s linear infinite" }}
                              />
                            ) : (
                              <Trash2 size={16} />
                            )}
                            <span>
                              {actionLoading === "delete" ? "Excluindo..." : "Excluir"}
                            </span>
                          </button>
                        </div>
                      </section>
                    )}

                    {(selectedPrimaryAioDocument ||
                      visibleDesdobramentoDocuments.length > 0) && (
                      <section className="eventModalSection">
                        <h3 className="eventModalSectionTitle">
                          Gerenciar documentos
                        </h3>

                        <div
                          style={{
                            display: "grid",
                            gap: 14,
                          }}
                        >
                          {selectedPrimaryAioDocument && (
                            <div
                              style={{
                                background: "#ffffff",
                                border: "1px solid #e5e7eb",
                                borderRadius: 18,
                                padding: 16,
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              <div className="documentItemTitle">
                                <DocumentFileIcon
                                  fileName={selectedPrimaryAioDocument.fileName}
                                />
                                {renderDocumentHeader(
                                  selectedPrimaryAioDocument,
                                  selectedPrimaryAioDocument.uploadedByEmail || "-"
                                )}
                              </div>

                              {renderDocumentActions(selectedPrimaryAioDocument)}
                            </div>
                          )}

                          {visibleDesdobramentoDocuments.map((docItem) => (
                            <div
                              key={`manage-${docItem.id}`}
                              style={{
                                background: "#ffffff",
                                border: "1px solid #e5e7eb",
                                borderRadius: 18,
                                padding: 16,
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              <div className="documentItemTitle">
                                <DocumentFileIcon fileName={docItem.fileName} />
                                {renderDocumentHeader(
                                  docItem,
                                  docItem.unitCode || "UNIDADE"
                                )}
                              </div>

                              {renderDocumentActions(docItem, true)}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
      </main>

      <style>{`
        :root {
          --sidebar-blue: var(--sidebar-accent, #03153eff);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes eventPinPulse {
          0% {
            transform: translate(-50%, -50%) scale(0.65);
            opacity: 0.8;
          }
          70% {
            transform: translate(-50%, -50%) scale(1.95);
            opacity: 0;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.95);
            opacity: 0;
          }
        }

        .eventPinMarkerIcon {
          background: transparent !important;
          border: none !important;
        }

        .eventPinMarker {
          position: relative;
          width: var(--pin-width);
          height: var(--pin-height);
          pointer-events: auto;
        }

        .eventPinPulse {
          position: absolute;
          left: 50%;
          top: var(--pulse-top);
          width: var(--pulse-size);
          height: var(--pulse-size);
          border-radius: 999px;
          background: var(--pulse-color);
          transform: translate(-50%, -50%) scale(0.65);
          animation: eventPinPulse 1.8s infinite ease-out;
          pointer-events: none;
        }

        .eventPinPulseDelayed {
          animation-delay: 0.9s;
        }

        .eventPinSvgWrap {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.24));
          transition: transform 0.18s ease;
        }

        .eventPinMarker.isSelected .eventPinSvgWrap {
          transform: scale(1.07);
        }

        .eventMarkerTooltip {
          min-width: 220px;
          max-width: 260px;
          padding: 2px;
        }

        .eventMarkerTooltipTitle {
          font-size: 13px;
          font-weight: 800;
          color: #111827;
          line-height: 1.35;
          margin-bottom: 8px;
        }

        .eventMarkerTooltipLine {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.4;
          margin-bottom: 4px;
        }

        .eventMarkerTooltipLine svg {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .eventsHeaderCompact,
        .eventRowCompact {
          display: grid;
          grid-template-columns: 150px 150px minmax(260px, 1fr) 170px;
          gap: 14px;
          align-items: center;
        }

        .eventRowCompact {
          padding: 16px 14px;
          border-bottom: 1px solid #eef2f7;
          cursor: pointer;
          transition: background 0.18s ease;
        }

        .eventRowCompact:hover {
          background: #f8fafc;
        }

        .colStatus {
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .eventName {
          font-size: 15px;
          font-weight: 800;
          color: #111827;
          margin-bottom: 4px;
        }

        .eventUnitBadges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .eventUnitBadge,
        .eventTag.unitStatusTag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 6px 10px;
          border-radius: 999px;
          background: #f8fafc;
          border: 1px solid #dbe3ef;
          color: #475569;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          white-space: nowrap;
        }

        .eventUnitBadge.originBadge,
        .eventTag.unitStatusTag.originBadge {
          background: #eef2ff;
          border-color: #c7d2fe;
          color: #3730a3;
        }

        .eventUnitBadge.hasDesdobramento,
        .eventTag.unitStatusTag.hasDesdobramento {
          background: #dcfce7;
          border-color: #86efac;
          color: #166534;
        }

        .filtersGrid .fieldSearchWide {
          grid-column: span 2;
          min-width: 0;
        }

        .filtersGrid .fieldSearchWide .inputWithIcon,
        .filtersGrid .fieldSearchWide input {
          width: 100%;
        }

        .dashboardContentGrid.mapWorkspaceExpanded {
          position: fixed;
          inset: 16px;
          z-index: 1400;
          background: #f5f7fb;
          padding: 16px;
          border-radius: 24px;
          box-shadow: 0 20px 70px rgba(15, 23, 42, 0.22);
          overflow: auto;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 18px;
        }

        .dashboardContentGrid.mapWorkspaceExpanded .mainPanel,
        .dashboardContentGrid.mapWorkspaceExpanded .rightRail {
          min-width: 0;
        }

        .calendarDay {
          transition:
            background 0.16s ease,
            transform 0.16s ease,
            box-shadow 0.16s ease,
            color 0.16s ease,
            border-color 0.16s ease;
          user-select: none;
        }

        .calendarDay:not(.calendarDayEmpty):not(.calendarDaySelected):hover {
          background: #f8fafc;
          transform: translateY(-1px);
        }

        .calendarDayEvent:not(.calendarDaySelected) {
          box-shadow: inset 0 0 0 1px #93c5fd;
        }

        .calendarDayEvent:not(.calendarDaySelected):hover {
          background: #eff6ff;
        }

        .calendarDaySelected,
        .calendarDaySelected:hover {
          background: var(--sidebar-blue) !important;
          color: #ffffff !important;
          border-color: var(--sidebar-blue) !important;
          transform: none !important;
          box-shadow: 0 8px 18px rgba(29, 78, 216, 0.22) !important;
        }

        .desdobramentoUploadBox {
          display: grid;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          border: 1px dashed #cbd5e1;
          background: #f8fafc;
        }

        .desdobramentoUploadField {
          display: grid;
          gap: 6px;
          max-width: 340px;
        }

        .desdobramentoUploadField label {
          font-size: 12px;
          font-weight: 700;
          color: #6b7280;
        }

        .desdobramentoUploadRow {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }

        .desdobramentoUploadHint {
          padding: 10px 12px;
          border-radius: 12px;
          background: #ecfccb;
          border: 1px solid #bef264;
          color: #3f6212;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.45;
        }

        .desdobramentoUploadInfo {
          font-size: 12px;
          color: #6b7280;
          font-weight: 600;
        }

        @media (max-width: 1180px) {
          .filtersGrid .fieldSearchWide {
            grid-column: span 2;
          }
        }

        @media (max-width: 1100px) {
          .eventsHeaderCompact,
          .eventRowCompact {
            grid-template-columns: 130px 130px minmax(220px, 1fr) 160px;
          }

          .dashboardContentGrid.mapWorkspaceExpanded {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 860px) {
          .eventsHeaderCompact {
            display: none;
          }

          .eventRowCompact {
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .colDate,
          .colTime,
          .colTitle,
          .colStatus {
            width: 100%;
          }

          .filtersGrid .fieldSearchWide {
            grid-column: span 1;
          }

          .dashboardContentGrid.mapWorkspaceExpanded {
            inset: 10px;
            padding: 12px;
            border-radius: 18px;
          }

          .desdobramentoUploadField {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}