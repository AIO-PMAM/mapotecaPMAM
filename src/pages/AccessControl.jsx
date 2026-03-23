import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import AppSidebar from "../components/AppSidebar";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  ArrowLeft,
  Shield,
  Save,
  Pencil,
  Trash2,
  X,
  UserCog,
  ChevronRight,
  Building2,
} from "lucide-react";
import "../styles/home.css";
import "../styles/units.css";

function getUnitCode(unit) {
  return String(unit?.code || unit?.sigla || "")
    .trim()
    .toUpperCase();
}

function getUnitLabel(unit) {
  return String(unit?.name || unit?.sigla || unit?.code || "UNIDADE").trim();
}

function getUnitCategory(unit) {
  return String(unit?.category || unit?.type || "UNIDADE").trim();
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sortUnits(a, b) {
  const aLabel = `${getUnitCode(a)} ${getUnitLabel(a)}`.trim();
  const bLabel = `${getUnitCode(b)} ${getUnitLabel(b)}`.trim();
  return aLabel.localeCompare(bLabel, "pt-BR");
}

function sortProfiles(a, b) {
  const aLabel = `${a.postoGrad || ""} ${a.fullName || ""}`.trim();
  const bLabel = `${b.postoGrad || ""} ${b.fullName || ""}`.trim();
  return aLabel.localeCompare(bLabel, "pt-BR");
}

function collectDescendants(unitId, childrenMap, result = new Set()) {
  const children = childrenMap[unitId] || [];

  for (const child of children) {
    if (!result.has(child.id)) {
      result.add(child.id);
      collectDescendants(child.id, childrenMap, result);
    }
  }

  return result;
}

function normalizeAccessProfile(value) {
  const raw = String(value || "").toUpperCase().trim();

  if (raw === "COMANDO") return "COMANDO";
  if (raw === "P-3" || raw === "P3") return "P-3";
  if (raw === "AUXILIAR_P3" || raw === "AUXILIAR P3") return "AUXILIAR_P3";
  if (
    raw === "VISUALIZACAO" ||
    raw === "VISUALIZAÇÃO" ||
    raw === "VIEWER" ||
    raw === "READ_ONLY" ||
    raw === "SOMENTE_VISUALIZACAO"
  ) {
    return "VISUALIZACAO";
  }

  return "COMANDO";
}

function getDefaultSystemRoleForAccessProfile(accessProfile) {
  const profile = normalizeAccessProfile(accessProfile);

  if (profile === "COMANDO") return "UNIT_MANAGER";
  if (profile === "P-3") return "P3";
  if (profile === "AUXILIAR_P3") return "AUXILIAR_P3";
  if (profile === "VISUALIZACAO") return "UNIDADE_OPERACIONAL";

  return "UNIT_MANAGER";
}

function normalizeSystemRole(value, accessProfile) {
  const raw = String(value || "").toUpperCase().trim();

  if (
    raw === "ADMIN" ||
    raw === "AIO" ||
    raw === "AIO_ADMIN" ||
    raw === "UNIT_MANAGER" ||
    raw === "P3" ||
    raw === "AUXILIAR_P3" ||
    raw === "UNIDADE_GESTORA" ||
    raw === "UNIDADE_OPERACIONAL" ||
    raw === "VIEWER"
  ) {
    return raw;
  }

  return getDefaultSystemRoleForAccessProfile(accessProfile);
}

function getProfilePermissions(accessProfile) {
  const profile = normalizeAccessProfile(accessProfile);

  if (profile === "COMANDO") {
    return {
      canView: true,
      canEdit: false,
      canManageUsers: false,
    };
  }

  if (profile === "P-3") {
    return {
      canView: true,
      canEdit: true,
      canManageUsers: true,
    };
  }

  if (profile === "AUXILIAR_P3") {
    return {
      canView: true,
      canEdit: true,
      canManageUsers: false,
    };
  }

  if (profile === "VISUALIZACAO") {
    return {
      canView: true,
      canEdit: false,
      canManageUsers: false,
    };
  }

  return {
    canView: true,
    canEdit: false,
    canManageUsers: false,
  };
}

function getGlobalFlagsBySystemRole(systemRole) {
  const role = String(systemRole || "").toUpperCase().trim();

  const isAio = role === "AIO" || role === "AIO_ADMIN";
  const canViewAll = role === "ADMIN" || role === "AIO" || role === "AIO_ADMIN";
  const canManageAll =
    role === "ADMIN" || role === "AIO" || role === "AIO_ADMIN";

  return {
    isAio,
    canViewAll,
    canManageAll,
  };
}

function roleLabel(value) {
  const map = {
    ADMIN: "Admin",
    AIO: "AIO",
    AIO_ADMIN: "AIO Admin",
    UNIT_MANAGER: "Comando",
    P3: "P-3",
    AUXILIAR_P3: "Auxiliar P-3",
    UNIDADE_GESTORA: "Unidade Gestora",
    UNIDADE_OPERACIONAL: "Unidade Operacional",
    VIEWER: "Somente visualização",
  };

  return map[String(value || "").toUpperCase()] || "-";
}

function accessProfileLabel(value) {
  const map = {
    COMANDO: "Comando",
    "P-3": "P-3",
    AUXILIAR_P3: "Auxiliar P-3",
    VISUALIZACAO: "Somente visualização",
  };

  return map[normalizeAccessProfile(value)] || "-";
}

function getRootUnit(unitId, unitMap) {
  let current = unitMap[unitId] || null;
  let last = current;
  const visited = new Set();

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    last = current;

    if (!current.parentUnitId) break;
    current = unitMap[current.parentUnitId] || null;
  }

  return last || null;
}

function getAncestorUnits(unitId, unitMap) {
  const result = [];
  const visited = new Set();
  let current = unitMap[unitId] || null;

  while (current?.parentUnitId && !visited.has(current.parentUnitId)) {
    visited.add(current.parentUnitId);
    const parent = unitMap[current.parentUnitId] || null;
    if (!parent) break;
    result.unshift(parent);
    current = parent;
  }

  return result;
}

function getUnitPath(unitId, unitMap) {
  const target = unitMap[unitId];
  if (!target) return "";

  if (target.hierarchyPath) return target.hierarchyPath;

  const ancestors = getAncestorUnits(unitId, unitMap);
  return [...ancestors, target]
    .map((item) => getUnitCode(item) || getUnitLabel(item))
    .filter(Boolean)
    .join(" > ");
}

function buildUnitScope(unitId, unitMap, childrenMap) {
  const target = unitMap[unitId];
  if (!target) {
    return {
      scopeUnitIds: [],
      scopeUnitCodes: [],
      scopeUnitNames: [],
      scopeUnitPaths: [],
    };
  }

  const ids = new Set([unitId]);
  collectDescendants(unitId, childrenMap, ids);

  const scopeUnits = Array.from(ids)
    .map((id) => unitMap[id])
    .filter(Boolean)
    .sort(sortUnits);

  return {
    scopeUnitIds: scopeUnits.map((unit) => unit.id),
    scopeUnitCodes: scopeUnits.map((unit) => getUnitCode(unit)).filter(Boolean),
    scopeUnitNames: scopeUnits.map((unit) => getUnitLabel(unit)).filter(Boolean),
    scopeUnitPaths: scopeUnits
      .map((unit) => getUnitPath(unit.id, unitMap))
      .filter(Boolean),
  };
}

export default function AccessControl({
  user,
  claims,
  onBack,
  onGoHome,
  onGoCreateEvent,
  onGoUnits,
  onGoAccess,
}) {
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [expandedUnits, setExpandedUnits] = useState({});

  const [postoGrad, setPostoGrad] = useState("");
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [ci, setCi] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [unitId, setUnitId] = useState("");
  const [funcao, setFuncao] = useState("");
  const [systemRole, setSystemRole] = useState("UNIT_MANAGER");
  const [accessProfile, setAccessProfile] = useState("COMANDO");
  const [isActive, setIsActive] = useState(true);

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const claimsRole = String(
    claims?.systemRole || claims?.role || ""
  ).toUpperCase().trim();

  const claimsUnitId = String(
    claims?.unitId || claims?.currentUnitId || ""
  ).trim();

  const claimsAccessProfile = normalizeAccessProfile(claims?.accessProfile);

  const isAdminLike =
    claimsRole === "ADMIN" ||
    claimsRole === "AIO" ||
    claimsRole === "AIO_ADMIN" ||
    claims?.canManageAll === true ||
    claims?.canEditAll === true;

  const claimIsP3Manager =
    claimsRole === "P3" ||
    claimsRole === "UNIT_MANAGER" ||
    claimsAccessProfile === "P-3";

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
      setErro("Não foi possível carregar as unidades.");
    } finally {
      setLoadingUnits(false);
    }
  }

  async function loadAccessProfiles() {
    setLoading(true);

    try {
      const refCollection = collection(db, "access_profiles");
      let rows = [];

      if (isAdminLike) {
        const q = query(refCollection, orderBy("fullName", "asc"));
        const snap = await getDocs(q);

        rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
      } else {
        if (!claimsUnitId) {
          setItems([]);
          setLoading(false);
          return;
        }

        const [ownSnap, descendantsSnap] = await Promise.all([
          getDocs(query(refCollection, where("unitId", "==", claimsUnitId))),
          getDocs(
            query(
              refCollection,
              where("ancestorUnitIds", "array-contains", claimsUnitId)
            )
          ),
        ]);

        const merged = new globalThis.Map();

        [...ownSnap.docs, ...descendantsSnap.docs].forEach((d) => {
          merged.set(d.id, {
            id: d.id,
            ...d.data(),
          });
        });

        rows = Array.from(merged.values());
      }

      rows.sort(sortProfiles);
      setItems(rows);
    } catch (error) {
      console.error("Erro ao carregar perfis de acesso:", error);
      setErro(
        `Não foi possível carregar os perfis de acesso. ${error?.code || ""} ${
          error?.message || ""
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUnits();
  }, []);

  useEffect(() => {
    loadAccessProfiles();
  }, [isAdminLike, claimsUnitId]);

  const unitMap = useMemo(() => {
    const map = {};
    for (const unit of units) {
      map[unit.id] = unit;
    }
    return map;
  }, [units]);

  const validUnitIds = useMemo(() => new Set(units.map((u) => u.id)), [units]);

  const rootUnits = useMemo(() => {
    return units
      .filter((u) => !u.parentUnitId || !validUnitIds.has(u.parentUnitId))
      .sort(sortUnits);
  }, [units, validUnitIds]);

  const childrenMap = useMemo(() => {
    const map = {};

    for (const unit of units) {
      const key = unit.parentUnitId || "__root__";
      if (!map[key]) map[key] = [];
      map[key].push(unit);
    }

    Object.keys(map).forEach((key) => {
      map[key].sort(sortUnits);
    });

    return map;
  }, [units]);

  const unitIdByAnyKey = useMemo(() => {
    const map = {};

    for (const unit of units) {
      map[normalizeKey(unit.id)] = unit.id;

      const code = getUnitCode(unit);
      if (code) map[normalizeKey(code)] = unit.id;

      const sigla = normalizeKey(unit.sigla);
      if (sigla) map[sigla] = unit.id;
    }

    return map;
  }, [units]);

  const normalizedItems = useMemo(() => {
    return items.map((item) => {
      const rawUnitId = normalizeKey(item.unitId);
      const rawUnitCode = normalizeKey(item.unitCode || item.code || item.sigla);

      const resolvedUnitId =
        unitMap[item.unitId]?.id ||
        unitIdByAnyKey[rawUnitId] ||
        unitIdByAnyKey[rawUnitCode] ||
        "";

      const resolvedUnit = unitMap[resolvedUnitId] || null;

      return {
        ...item,
        resolvedUnitId,
        resolvedUnitCode: resolvedUnit
          ? getUnitCode(resolvedUnit)
          : normalizeKey(item.unitCode || item.code || item.sigla),
        resolvedUnitName: resolvedUnit
          ? getUnitLabel(resolvedUnit)
          : String(item.unitName || item.name || "").trim(),
        resolvedUnitPath: resolvedUnit ? getUnitPath(resolvedUnit.id, unitMap) : "",
      };
    });
  }, [items, unitMap, unitIdByAnyKey]);

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

  const currentUserProfiles = useMemo(() => {
    const currentEmail = normalizeEmail(user?.email);
    if (!currentEmail) return [];

    return normalizedItems.filter(
      (item) =>
        normalizeEmail(item.email) === currentEmail && item.isActive !== false
    );
  }, [normalizedItems, user]);

  const currentP3Profiles = useMemo(() => {
    return currentUserProfiles.filter(
      (item) => normalizeAccessProfile(item.accessProfile) === "P-3"
    );
  }, [currentUserProfiles]);

  const managedUnitIds = useMemo(() => {
    const result = new Set();

    if (isAdminLike) {
      units.forEach((unit) => result.add(unit.id));
      return result;
    }

    if (claimIsP3Manager && claimsUnitId && unitMap[claimsUnitId]) {
      result.add(claimsUnitId);
      collectDescendants(claimsUnitId, childrenMap, result);
    }

    currentP3Profiles.forEach((profile) => {
      const profileUnitId = String(profile.resolvedUnitId || profile.unitId || "").trim();
      if (!profileUnitId) return;

      result.add(profileUnitId);
      collectDescendants(profileUnitId, childrenMap, result);
    });

    return result;
  }, [
    isAdminLike,
    claimIsP3Manager,
    claimsUnitId,
    currentP3Profiles,
    units,
    childrenMap,
    unitMap,
  ]);

  const canManageAccess = useMemo(() => {
    return isAdminLike || claimIsP3Manager || currentP3Profiles.length > 0;
  }, [isAdminLike, claimIsP3Manager, currentP3Profiles]);

  const visibleItems = useMemo(() => {
    if (isAdminLike) return [...normalizedItems].sort(sortProfiles);

    return normalizedItems
      .filter((item) => managedUnitIds.has(item.resolvedUnitId))
      .sort(sortProfiles);
  }, [normalizedItems, isAdminLike, managedUnitIds]);

  const orphanItems = useMemo(() => {
    return visibleItems.filter((item) => !item.resolvedUnitId);
  }, [visibleItems]);

  const availableUnitOptions = useMemo(() => {
    if (isAdminLike) return unitOptions;
    return unitOptions.filter((option) => managedUnitIds.has(option.id));
  }, [isAdminLike, unitOptions, managedUnitIds]);

  const unitProfilesMap = useMemo(() => {
    const map = {};

    for (const item of visibleItems) {
      const key = item.resolvedUnitId || "__without_unit__";
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }

    Object.keys(map).forEach((key) => {
      map[key].sort(sortProfiles);
    });

    return map;
  }, [visibleItems]);

  const visibleUnitIds = useMemo(() => {
    if (isAdminLike) {
      return new Set(units.map((unit) => unit.id));
    }
    return new Set(managedUnitIds);
  }, [isAdminLike, units, managedUnitIds]);

  const unitTreeStats = useMemo(() => {
    const hasContentMap = {};
    const subtreeCountMap = {};

    function visit(unitId) {
      if (!visibleUnitIds.has(unitId)) {
        return { hasContent: false, count: 0 };
      }

      const ownProfiles = unitProfilesMap[unitId] || [];
      let count = ownProfiles.length;
      let hasContent = ownProfiles.length > 0;

      const children = (childrenMap[unitId] || []).filter((child) =>
        visibleUnitIds.has(child.id)
      );

      for (const child of children) {
        const childStats = visit(child.id);
        count += childStats.count;
        if (childStats.hasContent) hasContent = true;
      }

      hasContentMap[unitId] = hasContent;
      subtreeCountMap[unitId] = count;

      return { hasContent, count };
    }

    units.forEach((unit) => {
      if (visibleUnitIds.has(unit.id) && hasContentMap[unit.id] === undefined) {
        visit(unit.id);
      }
    });

    return {
      hasContentMap,
      subtreeCountMap,
    };
  }, [units, visibleUnitIds, unitProfilesMap, childrenMap]);

  const visibleRootUnits = useMemo(() => {
    if (isAdminLike) {
      return rootUnits.filter((unit) => unitTreeStats.hasContentMap[unit.id]);
    }

    return units
      .filter(
        (unit) =>
          visibleUnitIds.has(unit.id) &&
          (!unit.parentUnitId || !visibleUnitIds.has(unit.parentUnitId)) &&
          unitTreeStats.hasContentMap[unit.id]
      )
      .sort(sortUnits);
  }, [isAdminLike, rootUnits, units, visibleUnitIds, unitTreeStats]);

  useEffect(() => {
    if (!visibleRootUnits.length) return;

    setExpandedUnits((prev) => {
      const next = { ...prev };

      visibleRootUnits.forEach((unit) => {
        if (next[unit.id] === undefined) {
          next[unit.id] = true;
        }
      });

      return next;
    });
  }, [visibleRootUnits]);

  useEffect(() => {
    if (isAdminLike) return;

    if (unitId && !managedUnitIds.has(unitId)) {
      setUnitId("");
    }

    if (normalizeAccessProfile(accessProfile) === "COMANDO") {
      setAccessProfile("P-3");
      setSystemRole("P3");
    }

    if (
      String(systemRole || "").toUpperCase() === "ADMIN" ||
      String(systemRole || "").toUpperCase() === "AIO" ||
      String(systemRole || "").toUpperCase() === "AIO_ADMIN"
    ) {
      setSystemRole("P3");
    }
  }, [isAdminLike, managedUnitIds, unitId, accessProfile, systemRole]);

  function expandUnitChain(targetUnitId) {
    if (!targetUnitId) return;

    setExpandedUnits((prev) => {
      const next = { ...prev };
      let current = unitMap[targetUnitId] || null;

      while (current) {
        next[current.id] = true;
        current = current.parentUnitId ? unitMap[current.parentUnitId] || null : null;
      }

      return next;
    });
  }

  function canManageProfileItem(item) {
    if (isAdminLike) return true;

    const normalizedProfile = normalizeAccessProfile(item.accessProfile);
    const normalizedSystemRole = String(item.systemRole || "").toUpperCase();

    return (
      managedUnitIds.has(item.resolvedUnitId || item.unitId) &&
      normalizedProfile !== "COMANDO" &&
      normalizedSystemRole !== "ADMIN" &&
      normalizedSystemRole !== "AIO" &&
      normalizedSystemRole !== "AIO_ADMIN"
    );
  }

  function limparMensagens() {
    if (erro) setErro("");
    if (sucesso) setSucesso("");
  }

  function resetForm() {
    setEditingId(null);
    setPostoGrad("");
    setNomeCompleto("");
    setCi("");
    setCpf("");
    setEmail("");
    setUnitId("");
    setFuncao("");
    setSystemRole(isAdminLike ? "UNIT_MANAGER" : "P3");
    setAccessProfile(isAdminLike ? "COMANDO" : "P-3");
    setIsActive(true);
    setErro("");
    setSucesso("");
  }

  function validarFormulario() {
    if (!postoGrad.trim()) {
      setErro("Informe o posto/graduação.");
      return false;
    }

    if (!nomeCompleto.trim()) {
      setErro("Informe o nome completo.");
      return false;
    }

    if (!ci.trim()) {
      setErro("Informe a CI.");
      return false;
    }

    if (!cpf.trim()) {
      setErro("Informe o CPF.");
      return false;
    }

    if (!email.trim()) {
      setErro("Informe o e-mail.");
      return false;
    }

    if (!unitId) {
      setErro("Selecione a unidade de lotação.");
      return false;
    }

    if (!funcao.trim()) {
      setErro("Informe a função.");
      return false;
    }

    if (!isAdminLike && !managedUnitIds.has(unitId)) {
      setErro("Você só pode cadastrar perfis na sua unidade ou subordinadas.");
      return false;
    }

    if (!isAdminLike) {
      const normalizedProfile = normalizeAccessProfile(accessProfile);
      const normalizedRole = normalizeSystemRole(systemRole, normalizedProfile);

      if (normalizedProfile === "COMANDO") {
        setErro("P-3 só pode cadastrar perfis P-3, Auxiliar P-3 ou Somente visualização.");
        return false;
      }

      if (
        normalizedRole === "ADMIN" ||
        normalizedRole === "AIO" ||
        normalizedRole === "AIO_ADMIN"
      ) {
        setErro("P-3 não pode cadastrar perfil Admin ou AIO.");
        return false;
      }
    }

    const duplicatedEmail = items.find(
      (item) =>
        item.id !== editingId &&
        normalizeEmail(item.email) === normalizeEmail(email)
    );

    if (duplicatedEmail) {
      setErro("Já existe um perfil cadastrado com este e-mail.");
      return false;
    }

    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    limparMensagens();

    if (!validarFormulario()) return;

    const selectedUnit = units.find((u) => u.id === unitId);
    if (!selectedUnit) {
      setErro("Unidade selecionada inválida.");
      return;
    }

    setSaving(true);

    try {
      const normalizedProfile = normalizeAccessProfile(accessProfile);
      const normalizedRole = normalizeSystemRole(systemRole, normalizedProfile);
      const permissions = getProfilePermissions(normalizedProfile);

      const rootUnit = getRootUnit(selectedUnit.id, unitMap);
      const ancestors = getAncestorUnits(selectedUnit.id, unitMap);
      const hierarchyPath = getUnitPath(selectedUnit.id, unitMap);

      const scope = buildUnitScope(selectedUnit.id, unitMap, childrenMap);

      const parentUnit =
        selectedUnit.parentUnitId && unitMap[selectedUnit.parentUnitId]
          ? unitMap[selectedUnit.parentUnitId]
          : null;

      const { isAio, canViewAll, canManageAll } =
        getGlobalFlagsBySystemRole(normalizedRole);

      const payload = {
        postoGrad: postoGrad.trim(),
        fullName: nomeCompleto.trim(),
        ci: ci.trim(),
        cpf: cpf.trim(),
        email: normalizeEmail(email),

        unitId: selectedUnit.id,
        unitCode: getUnitCode(selectedUnit),
        unitName: getUnitLabel(selectedUnit),
        unitCategory: getUnitCategory(selectedUnit),
        unitPath: hierarchyPath,

        parentUnitId: selectedUnit.parentUnitId || null,
        parentUnitCode: parentUnit ? getUnitCode(parentUnit) : "",
        parentUnitName: parentUnit ? getUnitLabel(parentUnit) : "",

        rootUnitId: rootUnit?.id || selectedUnit.id,
        rootUnitCode: getUnitCode(rootUnit) || getUnitCode(selectedUnit),
        rootUnitName: getUnitLabel(rootUnit) || getUnitLabel(selectedUnit),

        ancestorUnitIds: ancestors.map((item) => item.id),
        ancestorUnitCodes: ancestors.map((item) => getUnitCode(item)),
        ancestorUnitNames: ancestors.map((item) => getUnitLabel(item)),

        accessScopeUnitIds: scope.scopeUnitIds,
        accessScopeUnitCodes: scope.scopeUnitCodes,
        accessScopeUnitNames: scope.scopeUnitNames,
        accessScopeUnitPaths: scope.scopeUnitPaths,

        funcao: funcao.trim(),

        systemRole: normalizedRole,
        role: normalizedRole,
        accessProfile: normalizedProfile,

        permissions,
        canManageUsers: permissions.canManageUsers === true,

        canViewAll,
        canManageAll,
        isAio,

        isActive,
        status: isActive ? "ACTIVE" : "INACTIVE",
      };

      if (editingId) {
        const currentItem = normalizedItems.find((item) => item.id === editingId);
        if (!currentItem) {
          setErro("Perfil em edição não encontrado.");
          setSaving(false);
          return;
        }

        if (!canManageProfileItem(currentItem)) {
          setErro("Você não possui permissão para editar esse perfil.");
          setSaving(false);
          return;
        }

        await updateDoc(doc(db, "access_profiles", editingId), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
          updatedByEmail: user?.email || null,
        });

        setSucesso("Perfil de acesso atualizado com sucesso.");
      } else {
        await addDoc(collection(db, "access_profiles"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || null,
          createdByEmail: user?.email || null,
          createdByRole: claims?.role || null,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
          updatedByEmail: user?.email || null,
        });

        setSucesso("Perfil de acesso salvo com sucesso.");
      }

      resetForm();
      expandUnitChain(selectedUnit.id);
      await loadAccessProfiles();
    } catch (error) {
      console.error("Erro ao salvar perfil:", error);
      setErro(
        `Não foi possível salvar o perfil de acesso. ${error?.code || ""} ${
          error?.message || ""
        }`
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item) {
    limparMensagens();

    if (!canManageProfileItem(item)) {
      setErro("Você não possui permissão para editar esse perfil.");
      return;
    }

    const nextProfile = normalizeAccessProfile(item.accessProfile);
    const nextRole = normalizeSystemRole(item.systemRole, nextProfile);

    setEditingId(item.id);
    setPostoGrad(item.postoGrad || "");
    setNomeCompleto(item.fullName || "");
    setCi(item.ci || "");
    setCpf(item.cpf || "");
    setEmail(item.email || "");
    setUnitId(item.resolvedUnitId || item.unitId || "");
    setFuncao(item.funcao || "");
    setSystemRole(nextRole);
    setAccessProfile(nextProfile);
    setIsActive(item.isActive !== false);

    expandUnitChain(item.resolvedUnitId || item.unitId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(item) {
    limparMensagens();

    if (!canManageProfileItem(item)) {
      setErro("Você não possui permissão para excluir esse perfil.");
      return;
    }

    const confirmed = window.confirm(
      `Deseja excluir o perfil de acesso de "${item.fullName}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "access_profiles", item.id));
      setSucesso("Perfil excluído com sucesso.");

      if (editingId === item.id) {
        resetForm();
      }

      await loadAccessProfiles();
    } catch (error) {
      console.error(error);
      setErro("Não foi possível excluir o perfil.");
    }
  }

  function toggleUnitExpansion(targetUnitId) {
    setExpandedUnits((prev) => ({
      ...prev,
      [targetUnitId]: !prev[targetUnitId],
    }));
  }

  function renderUnitNode(unit, level = 0) {
    if (!unit) return null;

    const ownProfiles = unitProfilesMap[unit.id] || [];
    const visibleChildren = (childrenMap[unit.id] || [])
      .filter(
        (child) =>
          visibleUnitIds.has(child.id) && unitTreeStats.hasContentMap[child.id]
      )
      .sort(sortUnits);

    const totalProfilesInBranch = unitTreeStats.subtreeCountMap[unit.id] || 0;
    const isExpanded = expandedUnits[unit.id] !== false;

    if (!unitTreeStats.hasContentMap[unit.id]) {
      return null;
    }

    return (
      <div
        key={unit.id}
        style={{
          marginLeft: level > 0 ? 18 : 0,
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
        }}
      >
        <button
          type="button"
          onClick={() => toggleUnitExpansion(unit.id)}
          style={{
            width: "100%",
            border: "none",
            background: "#fff",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              textAlign: "left",
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: level === 0 ? "#eef2ff" : "#eff6ff",
                color: level === 0 ? "#1d4ed8" : "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Building2 size={20} />
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#111827",
                }}
              >
                {getUnitCode(unit) || "-"} — {getUnitLabel(unit)}
              </div>

              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "#6b7280",
                }}
              >
                {ownProfiles.length} perfil(is) nesta unidade • {totalProfilesInBranch} no grupo
              </div>
            </div>
          </div>

          <ChevronRight
            size={18}
            style={{
              color: "#6b7280",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
              flexShrink: 0,
            }}
          />
        </button>

        {isExpanded && (
          <div
            style={{
              borderTop: "1px solid #eef2f7",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              background: "#fafbff",
            }}
          >
            {ownProfiles.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {ownProfiles.map((item) => {
                  const canManageThisItem = canManageProfileItem(item);

                  return (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 16,
                        background: "#fff",
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 800,
                            color: "#111827",
                            fontSize: 14,
                          }}
                        >
                          {item.postoGrad || "-"} — {item.fullName || "-"}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            marginTop: 4,
                          }}
                        >
                          {item.email || "-"}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            marginTop: 4,
                          }}
                        >
                          CI: {item.ci || "-"} • CPF: {item.cpf || "-"}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            marginTop: 4,
                          }}
                        >
                          Função: {item.funcao || "-"}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            marginTop: 4,
                          }}
                        >
                          Perfil institucional: <b>{roleLabel(item.systemRole)}</b> •
                          Acesso: <b> {accessProfileLabel(item.accessProfile)}</b>
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            marginTop: 4,
                          }}
                        >
                          Visualização:{" "}
                          <b>{item.permissions?.canView ? "SIM" : "NÃO"}</b> • Edição:{" "}
                          <b>{item.permissions?.canEdit ? "SIM" : "NÃO"}</b> •
                          Gerenciar usuários:{" "}
                          <b>{item.permissions?.canManageUsers ? "SIM" : "NÃO"}</b> •
                          Status: <b>{item.isActive !== false ? "ATIVO" : "INATIVO"}</b>
                        </div>
                      </div>

                      {canManageThisItem && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            className="unitsSecondaryBtn"
                            onClick={() => startEdit(item)}
                          >
                            <Pencil size={14} />
                            <span>Editar</span>
                          </button>

                          <button
                            type="button"
                            className="unitsSecondaryBtn"
                            onClick={() => handleDelete(item)}
                            style={{
                              background: "#fee2e2",
                              color: "#991b1b",
                              borderColor: "#fecaca",
                            }}
                          >
                            <Trash2 size={14} />
                            <span>Excluir</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {visibleChildren.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {visibleChildren.map((child) => renderUnitNode(child, level + 1))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!canManageAccess && !loading && !loadingUnits) {
    return (
      <div className="dashboardShell">
        <AppSidebar
          user={user}
          claims={claims}
          active="access"
          onGoHome={onGoHome}
          onGoCreateEvent={onGoCreateEvent}
          onGoUnits={onGoUnits}
          onGoAccess={onGoAccess}
        />

        <main className="dashboardMain">
          <div className="unitsTopbar">
            <div>
              <div className="unitsWelcome">Controle institucional</div>
              <h1 className="unitsTitle">Perfis de acesso</h1>
              <div className="unitsSubline">
                Você não possui permissão para gerenciar acessos.
              </div>
            </div>

            <button className="unitsBackBtn" onClick={onBack} type="button">
              <ArrowLeft size={16} />
              <span>Voltar</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboardShell">
      <AppSidebar
        user={user}
        claims={claims}
        active="access"
        onGoHome={onGoHome}
        onGoCreateEvent={onGoCreateEvent}
        onGoUnits={onGoUnits}
        onGoAccess={onGoAccess}
      />

      <main className="dashboardMain">
        <div className="unitsTopbar">
          <div>
            <div className="unitsWelcome">Controle institucional</div>
            <h1 className="unitsTitle">Perfis de acesso</h1>
            <div className="unitsSubline">
              {isAdminLike
                ? "Cadastre usuários e defina o tipo de acesso de cada perfil."
                : "Como P-3, você pode cadastrar e gerenciar perfis P-3, Auxiliar P-3 e Somente visualização da sua unidade e subordinadas."}
            </div>
          </div>

          <button className="unitsBackBtn" onClick={onBack} type="button">
            <ArrowLeft size={16} />
            <span>Voltar</span>
          </button>
        </div>

        <div className="unitsGrid">
          <section className="unitsCard">
            <div className="unitsCardHeader">
              <div className="unitsCardIcon">
                {editingId ? <Pencil size={18} /> : <UserCog size={18} />}
              </div>
              <div>
                <h2>{editingId ? "Editar perfil" : "Cadastrar perfil"}</h2>
                <p>
                  {isAdminLike
                    ? "Preencha os dados funcionais e o nível de acesso."
                    : "Cadastre perfis P-3, Auxiliar P-3 ou Somente visualização dentro do seu escopo hierárquico."}
                </p>
              </div>
            </div>

            <form className="unitsForm" onSubmit={handleSubmit}>
              <div className="unitsField">
                <label>Posto / Graduação</label>
                <input
                  type="text"
                  value={postoGrad}
                  onChange={(e) => {
                    setPostoGrad(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: CAP QOPM"
                />
              </div>

              <div className="unitsField">
                <label>Nome completo</label>
                <input
                  type="text"
                  value={nomeCompleto}
                  onChange={(e) => {
                    setNomeCompleto(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: João da Silva"
                />
              </div>

              <div className="unitsField">
                <label>CI</label>
                <input
                  type="text"
                  value={ci}
                  onChange={(e) => {
                    setCi(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: 1234567-8"
                />
              </div>

              <div className="unitsField">
                <label>CPF</label>
                <input
                  type="text"
                  value={cpf}
                  onChange={(e) => {
                    setCpf(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: 000.000.000-00"
                />
              </div>

              <div className="unitsField">
                <label>E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: usuario@pm.am.gov.br"
                />
              </div>

              <div className="unitsField">
                <label>Unidade de lotação</label>
                <select
                  value={unitId}
                  onChange={(e) => {
                    setUnitId(e.target.value);
                    limparMensagens();
                  }}
                  disabled={loadingUnits}
                >
                  <option value="">
                    {loadingUnits ? "Carregando unidades..." : "Selecione"}
                  </option>

                  {availableUnitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="unitsField">
                <label>Função</label>
                <input
                  type="text"
                  value={funcao}
                  onChange={(e) => {
                    setFuncao(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: Chefe da P-3"
                />
              </div>

              <div className="unitsField">
                <label>Perfil institucional</label>
                <select
                  value={systemRole}
                  onChange={(e) => {
                    setSystemRole(e.target.value);
                    limparMensagens();
                  }}
                >
                  {isAdminLike && <option value="ADMIN">Admin</option>}
                  {isAdminLike && <option value="AIO">AIO</option>}
                  {isAdminLike && <option value="AIO_ADMIN">AIO Admin</option>}
                  {isAdminLike && <option value="UNIT_MANAGER">Comando</option>}
                  <option value="P3">P-3</option>
                  <option value="AUXILIAR_P3">Auxiliar P-3</option>
                  <option value="UNIDADE_OPERACIONAL">Unidade Operacional</option>
                </select>
              </div>

              <div className="unitsField">
                <label>Perfil de acesso</label>
                <select
                  value={accessProfile}
                  onChange={(e) => {
                    const nextProfile = normalizeAccessProfile(e.target.value);
                    setAccessProfile(nextProfile);

                    if (!isAdminLike) {
                      if (nextProfile === "AUXILIAR_P3") {
                        setSystemRole("AUXILIAR_P3");
                      } else if (nextProfile === "VISUALIZACAO") {
                        setSystemRole("UNIDADE_OPERACIONAL");
                      } else {
                        setSystemRole("P3");
                      }
                    } else {
                      setSystemRole(getDefaultSystemRoleForAccessProfile(nextProfile));
                    }

                    limparMensagens();
                  }}
                >
                  {isAdminLike && <option value="COMANDO">Comando</option>}
                  <option value="P-3">P-3</option>
                  <option value="AUXILIAR_P3">Auxiliar P-3</option>
                  <option value="VISUALIZACAO">Somente visualização</option>
                </select>
              </div>

              <div className="unitsField">
                <label>Status</label>
                <select
                  value={isActive ? "ATIVO" : "INATIVO"}
                  onChange={(e) => {
                    setIsActive(e.target.value === "ATIVO");
                    limparMensagens();
                  }}
                >
                  <option value="ATIVO">Ativo</option>
                  <option value="INATIVO">Inativo</option>
                </select>
              </div>

              <div className="unitsField">
                <label>Permissões resultantes</label>
                <div className="unitsMessage success" style={{ marginTop: 0 }}>
                  Visualização: <b>SIM</b> | Edição:{" "}
                  <b>{getProfilePermissions(accessProfile).canEdit ? "SIM" : "NÃO"}</b> |
                  Gerenciar usuários:{" "}
                  <b>
                    {getProfilePermissions(accessProfile).canManageUsers
                      ? "SIM"
                      : "NÃO"}
                  </b>
                </div>
              </div>

              {(erro || sucesso) && (
                <div className={erro ? "unitsMessage error" : "unitsMessage success"}>
                  {erro || sucesso}
                </div>
              )}

              <div className="unitsActionsRow">
                <button className="unitsSaveBtn" type="submit" disabled={saving}>
                  <Save size={16} />
                  <span>
                    {saving
                      ? "Salvando..."
                      : editingId
                      ? "Atualizar perfil"
                      : "Salvar perfil"}
                  </span>
                </button>

                {editingId && (
                  <button
                    className="unitsSecondaryBtn"
                    type="button"
                    onClick={resetForm}
                  >
                    <X size={16} />
                    <span>Cancelar edição</span>
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="unitsCard">
            <div className="unitsCardHeader">
              <div className="unitsCardIcon">
                <Shield size={18} />
              </div>
              <div>
                <h2>Perfis agrupados por unidade</h2>
                <p>
                  As unidades aparecem organizadas por hierarquia, incluindo suas
                  subordinadas.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="unitsEmpty">Carregando perfis...</div>
            ) : visibleRootUnits.length === 0 && orphanItems.length === 0 ? (
              <div className="unitsEmpty">Nenhum perfil cadastrado.</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {visibleRootUnits.map((unit) => renderUnitNode(unit, 0))}

                {orphanItems.length > 0 && (
                  <div
                    style={{
                      border: "1px solid #fcd34d",
                      borderRadius: 18,
                      background: "#fffbeb",
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#92400e",
                        fontSize: 15,
                      }}
                    >
                      Perfis sem unidade resolvida
                    </div>

                    {orphanItems.map((item) => (
                      <div
                        key={`orphan-${item.id}`}
                        style={{
                          border: "1px solid #fde68a",
                          borderRadius: 14,
                          background: "#fff",
                          padding: 12,
                        }}
                      >
                        <div style={{ fontWeight: 800, color: "#111827" }}>
                          {item.postoGrad || "-"} — {item.fullName || "-"}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                          {item.email || "-"}
                        </div>
                        <div style={{ fontSize: 12, color: "#92400e", marginTop: 4 }}>
                          unitId salvo: <b>{item.unitId || "-"}</b> • unitCode salvo:{" "}
                          <b>{item.unitCode || item.code || item.sigla || "-"}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}