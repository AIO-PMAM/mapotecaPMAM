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
  writeBatch,
} from "firebase/firestore";
import {
  ArrowLeft,
  FolderTree,
  PlusCircle,
  Save,
  Pencil,
  X,
  Trash2,
  ChevronRight,
} from "lucide-react";
import "../styles/home.css";
import "../styles/units.css";

const ROOT_KEY = "__root__";

function sortUnits(a, b) {
  const aLabel = `${a.code || ""} ${a.name || ""}`.trim();
  const bLabel = `${b.code || ""} ${b.name || ""}`.trim();
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

function normalizeUnitRow(row = {}) {
  const legacyType = String(row.type || "").toUpperCase();

  return {
    id: row.id || "",
    name: String(row.name || "").trim(),
    code: String(row.code || "").trim().toUpperCase(),
    category:
      row.category ||
      (legacyType === "GESTORA"
        ? "COMANDO"
        : legacyType === "SUBORDINADA"
        ? "UNIDADE"
        : "UNIDADE"),
    isManager:
      typeof row.isManager === "boolean"
        ? row.isManager
        : legacyType === "GESTORA",
    parentUnitId: row.parentUnitId || null,
    isActive: row.isActive !== false,

    parentUnitCode: row.parentUnitCode || null,
    parentUnitName: row.parentUnitName || null,

    rootUnitId: row.rootUnitId || null,
    rootUnitCode: row.rootUnitCode || "",
    rootUnitName: row.rootUnitName || "",

    ancestorUnitIds: Array.isArray(row.ancestorUnitIds)
      ? row.ancestorUnitIds.filter(Boolean)
      : [],
    ancestorUnitCodes: Array.isArray(row.ancestorUnitCodes)
      ? row.ancestorUnitCodes.filter(Boolean)
      : [],
    ancestorUnitNames: Array.isArray(row.ancestorUnitNames)
      ? row.ancestorUnitNames.filter(Boolean)
      : [],

    hierarchyPath: row.hierarchyPath || "",
    hierarchyPathIds: Array.isArray(row.hierarchyPathIds)
      ? row.hierarchyPathIds.filter(Boolean)
      : [],
    hierarchyLevel:
      typeof row.hierarchyLevel === "number" ? row.hierarchyLevel : 0,
  };
}

function buildHierarchyMetadata(unit, unitMap) {
  const safeParentId =
    unit.parentUnitId && unitMap[unit.parentUnitId] ? unit.parentUnitId : null;

  const ancestorUnits = [];
  const visited = new Set([unit.id]);

  let currentParentId = safeParentId;

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);

    const parent = unitMap[currentParentId];
    if (!parent) break;

    ancestorUnits.unshift(parent);
    currentParentId = parent.parentUnitId || null;
  }

  const immediateParent =
    safeParentId && unitMap[safeParentId] ? unitMap[safeParentId] : null;

  const pathUnits = [...ancestorUnits, unit];
  const rootUnit = ancestorUnits[0] || unit;

  return {
    parentUnitId: immediateParent?.id || null,
    parentUnitCode: immediateParent?.code || null,
    parentUnitName: immediateParent?.name || null,

    ancestorUnitIds: ancestorUnits.map((item) => item.id),
    ancestorUnitCodes: ancestorUnits.map((item) => item.code || ""),
    ancestorUnitNames: ancestorUnits.map((item) => item.name || ""),

    rootUnitId: rootUnit?.id || unit.id,
    rootUnitCode: rootUnit?.code || unit.code || "",
    rootUnitName: rootUnit?.name || unit.name || "",

    hierarchyPath: pathUnits
      .map((item) => item.code || item.name || "UNIDADE")
      .filter(Boolean)
      .join(" > "),
    hierarchyPathIds: pathUnits.map((item) => item.id).filter(Boolean),
    hierarchyLevel: ancestorUnits.length,
  };
}

export default function Units({
  user,
  claims,
  onBack,
  onGoHome,
  onGoCreateEvent,
  onGoUnits,
  onGoAccess,
}) {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const [nome, setNome] = useState("");
  const [sigla, setSigla] = useState("");
  const [category, setCategory] = useState("COMANDO");
  const [parentUnitId, setParentUnitId] = useState("");
  const [isManager, setIsManager] = useState(true);

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadUnits() {
    setLoading(true);

    try {
      const q = query(collection(db, "units"), orderBy("name", "asc"));
      const snap = await getDocs(q);

      const rows = snap.docs.map((d) => normalizeUnitRow({ id: d.id, ...d.data() }));
      rows.sort(sortUnits);

      setUnits(rows);
    } catch (error) {
      console.error(error);
      setErro("Não foi possível carregar as unidades.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUnits();
  }, []);

  const unitMap = useMemo(() => {
    const map = {};
    for (const unit of units) {
      map[unit.id] = unit;
    }
    return map;
  }, [units]);

  const childrenMap = useMemo(() => {
    const map = {};

    for (const unit of units) {
      const key = unit.parentUnitId || ROOT_KEY;
      if (!map[key]) map[key] = [];
      map[key].push(unit);
    }

    Object.keys(map).forEach((key) => {
      map[key].sort(sortUnits);
    });

    return map;
  }, [units]);

  const unitIds = useMemo(() => new Set(units.map((u) => u.id)), [units]);

  const rootUnits = useMemo(() => {
    return units
      .filter((u) => !u.parentUnitId || !unitIds.has(u.parentUnitId))
      .sort(sortUnits);
  }, [units, unitIds]);

  useEffect(() => {
    if (!units.length) return;

    setCollapsedGroups((prev) => {
      const next = { ...prev };

      units.forEach((unit) => {
        if (next[unit.id] === undefined) {
          next[unit.id] = true;
        }
      });

      return next;
    });
  }, [units]);

  const descendantIds = useMemo(() => {
    if (!editingId) return new Set();
    const set = new Set([editingId]);
    collectDescendants(editingId, childrenMap, set);
    return set;
  }, [editingId, childrenMap]);

  const editingHasChildren = useMemo(() => {
    if (!editingId) return false;
    return units.some((u) => u.parentUnitId === editingId);
  }, [units, editingId]);

  const managerUnits = useMemo(() => {
    return units
      .filter((u) => u.isManager && !descendantIds.has(u.id))
      .sort(sortUnits);
  }, [units, descendantIds]);

  async function syncHierarchyMetadata(nextUnitsRaw) {
    const normalizedUnits = (nextUnitsRaw || []).map((item) => normalizeUnitRow(item));

    if (!normalizedUnits.length) return;

    const nextUnitMap = {};
    normalizedUnits.forEach((unit) => {
      nextUnitMap[unit.id] = {
        ...unit,
        parentUnitId:
          unit.parentUnitId && normalizedUnits.some((u) => u.id === unit.parentUnitId)
            ? unit.parentUnitId
            : null,
      };
    });

    const batch = writeBatch(db);

    normalizedUnits.forEach((unit) => {
      const normalizedUnit = nextUnitMap[unit.id];
      const hierarchy = buildHierarchyMetadata(normalizedUnit, nextUnitMap);

      batch.set(
        doc(db, "units", unit.id),
        {
          parentUnitId: hierarchy.parentUnitId,
          parentUnitCode: hierarchy.parentUnitCode,
          parentUnitName: hierarchy.parentUnitName,

          ancestorUnitIds: hierarchy.ancestorUnitIds,
          ancestorUnitCodes: hierarchy.ancestorUnitCodes,
          ancestorUnitNames: hierarchy.ancestorUnitNames,

          rootUnitId: hierarchy.rootUnitId,
          rootUnitCode: hierarchy.rootUnitCode,
          rootUnitName: hierarchy.rootUnitName,

          hierarchyPath: hierarchy.hierarchyPath,
          hierarchyPathIds: hierarchy.hierarchyPathIds,
          hierarchyLevel: hierarchy.hierarchyLevel,

          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
          updatedByEmail: user?.email || null,
        },
        { merge: true }
      );
    });

    await batch.commit();
  }

  function limparMensagens() {
    if (erro) setErro("");
    if (sucesso) setSucesso("");
  }

  function resetForm() {
    setEditingId(null);
    setNome("");
    setSigla("");
    setCategory("COMANDO");
    setParentUnitId("");
    setIsManager(true);
    limparMensagens();
  }

  function startEdit(unit) {
    limparMensagens();

    setEditingId(unit.id);
    setNome(unit.name || "");
    setSigla(unit.code || "");
    setCategory(unit.category || "UNIDADE");
    setParentUnitId(unit.parentUnitId || "");
    setIsManager(!!unit.isManager);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function prepareAddSubordinate(parentUnit) {
    limparMensagens();

    setEditingId(null);
    setNome("");
    setSigla("");
    setCategory("UNIDADE");
    setParentUnitId(parentUnit.id);
    setIsManager(false);

    if (collapsedGroups[parentUnit.id]) {
      setCollapsedGroups((prev) => ({
        ...prev,
        [parentUnit.id]: false,
      }));
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function toggleGroup(unitId) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  }

  function validarFormulario() {
    if (!nome.trim()) {
      setErro("Informe o nome da unidade.");
      return false;
    }

    if (!sigla.trim()) {
      setErro("Informe a sigla da unidade.");
      return false;
    }

    const duplicada = units.find((u) => {
      const sameCode =
        String(u.code || "").toUpperCase() === sigla.trim().toUpperCase();
      const anotherRecord = u.id !== editingId;
      return sameCode && anotherRecord;
    });

    if (duplicada) {
      setErro("Já existe uma unidade cadastrada com essa sigla.");
      return false;
    }

    if (parentUnitId && descendantIds.has(parentUnitId)) {
      setErro("A unidade superior selecionada é inválida.");
      return false;
    }

    if (
      parentUnitId &&
      !managerUnits.some((unit) => unit.id === parentUnitId)
    ) {
      setErro("A unidade superior selecionada não pode receber subordinadas.");
      return false;
    }

    if (editingHasChildren && !isManager) {
      setErro(
        "Não é possível marcar como 'não' uma unidade que já possui subordinadas."
      );
      return false;
    }

    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    limparMensagens();

    if (!validarFormulario()) return;

    setSaving(true);

    try {
      const payload = {
        name: nome.trim(),
        code: sigla.trim().toUpperCase(),
        category,
        parentUnitId: parentUnitId || null,
        isManager,
        isActive: true,
      };

      if (editingId) {
        await updateDoc(doc(db, "units", editingId), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
          updatedByEmail: user?.email || null,
        });

        const nextUnits = units.map((unit) =>
          unit.id === editingId ? { ...unit, ...payload, id: editingId } : unit
        );

        await syncHierarchyMetadata(nextUnits);
        setSucesso("Unidade atualizada com sucesso.");
      } else {
        const ref = await addDoc(collection(db, "units"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || null,
          createdByEmail: user?.email || null,
          createdByRole: claims?.role || null,
        });

        const nextUnits = [
          ...units,
          {
            id: ref.id,
            ...payload,
          },
        ];

        await syncHierarchyMetadata(nextUnits);
        setSucesso("Unidade cadastrada com sucesso.");
      }

      resetForm();
      await loadUnits();
    } catch (error) {
      console.error(error);
      setErro("Não foi possível salvar a unidade.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(unit) {
    limparMensagens();

    const hasChildren = units.some((u) => u.parentUnitId === unit.id);

    if (hasChildren) {
      setErro(
        "Não é possível excluir uma unidade que possui subordinadas vinculadas."
      );
      return;
    }

    const confirmed = window.confirm(
      `Deseja realmente excluir a unidade "${unit.code} - ${unit.name}"?`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "units", unit.id));

      if (editingId === unit.id) {
        resetForm();
      }

      const remainingUnits = units.filter((u) => u.id !== unit.id);

      if (remainingUnits.length > 0) {
        await syncHierarchyMetadata(remainingUnits);
      }

      setSucesso("Unidade excluída com sucesso.");
      await loadUnits();
    } catch (error) {
      console.error(error);
      setErro("Não foi possível excluir a unidade.");
    }
  }

  function renderUnitNode(unit, level = 0) {
    const children = childrenMap[unit.id] || [];
    const hasChildren = children.length > 0;
    const isCollapsed = !!collapsedGroups[unit.id];

    return (
      <div
        key={unit.id}
        className={`treeNode ${hasChildren ? "hasChildren" : ""}`}
        style={{ "--tree-level": level }}
      >
        <div className="treeNodeHeader">
          <button
            type="button"
            className="treeNodeMain"
            onClick={() => hasChildren && toggleGroup(unit.id)}
          >
            {hasChildren ? (
              <ChevronRight
                size={16}
                className={`treeChevron ${
                  isCollapsed ? "collapsed" : "expanded"
                }`}
              />
            ) : (
              <span className="treeLeafDot" />
            )}

            <div className="treeNodeIdentity">
              <div className="treeNodeTitleRow">
                <span className="treeNodeCode">{unit.code}</span>
                <span className="treeNodeName">{unit.name}</span>
              </div>

              <div className="treeNodeMeta">
                <span className={`treeBadge ${unit.isManager ? "" : "softGray"}`}>
                  {unit.isManager ? "Gestora" : "Operacional"}
                </span>

                <span className="treeBadge soft">{unit.category || "UNIDADE"}</span>

                {unit.parentUnitId && (
                  <span className="treeNodeSubText">
                    Subordinada a {unit.parentUnitCode || "SUPERIOR"}
                  </span>
                )}

                {!unit.parentUnitId && (
                  <span className="treeNodeSubText">Raiz da estrutura</span>
                )}
              </div>

              {!!unit.hierarchyPath && (
                <div className="treeNodeSubText" style={{ marginTop: 4 }}>
                  {unit.hierarchyPath}
                </div>
              )}
            </div>
          </button>

          <div className="treeNodeActions">
            {unit.isManager && (
              <button
                className="treeIconBtn add"
                type="button"
                title="Adicionar subordinada"
                onClick={() => prepareAddSubordinate(unit)}
              >
                <PlusCircle size={16} />
              </button>
            )}

            <button
              className="treeIconBtn"
              type="button"
              title="Editar unidade"
              onClick={() => startEdit(unit)}
            >
              <Pencil size={16} />
            </button>

            <button
              className="treeIconBtn danger"
              type="button"
              title="Excluir unidade"
              onClick={() => handleDelete(unit)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {!isCollapsed && hasChildren && (
          <div className="treeChildren">
            {children.map((child) => renderUnitNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="dashboardShell">
      <AppSidebar
        user={user}
        claims={claims}
        active="units"
        onGoHome={onGoHome}
        onGoCreateEvent={onGoCreateEvent}
        onGoUnits={onGoUnits}
        onGoAccess={onGoAccess}
      />

      <main className="dashboardMain">
        <div className="unitsTopbar">
          <div>
            <div className="unitsWelcome">Cadastro institucional</div>
            <h1 className="unitsTitle">Unidades e Subordinações</h1>
            <div className="unitsSubline">
              Cadastre unidades, vincule subordinações e gerencie a estrutura
              hierárquica institucional.
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
                {editingId ? <Pencil size={18} /> : <PlusCircle size={18} />}
              </div>
              <div>
                <h2>{editingId ? "Editar unidade" : "Cadastrar unidade"}</h2>
                <p>
                  Cadastre qualquer unidade da estrutura, definindo a unidade
                  superior e se ela poderá gerenciar subordinadas.
                </p>
              </div>
            </div>

            <form className="unitsForm" onSubmit={handleSubmit}>
              <div className="unitsField">
                <label>Nome da unidade</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => {
                    setNome(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: Comando de Policiamento Metropolitano"
                />
              </div>

              <div className="unitsField">
                <label>Sigla</label>
                <input
                  type="text"
                  value={sigla}
                  onChange={(e) => {
                    setSigla(e.target.value);
                    limparMensagens();
                  }}
                  placeholder="Ex.: CPM"
                />
              </div>

              <div className="unitsField">
                <label>Categoria</label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    limparMensagens();
                  }}
                >
                  <option value="COMANDO">Comando</option>
                  <option value="CPA">CPA</option>
                  <option value="BATALHAO">Batalhão</option>
                  <option value="CICOM">CICOM</option>
                  <option value="CIPM">CIPM</option>
                  <option value="COMPANHIA">Companhia</option>
                  <option value="UNIDADE">Unidade</option>
                </select>
              </div>

              <div className="unitsField">
                <label>Unidade superior</label>
                <select
                  value={parentUnitId}
                  onChange={(e) => {
                    setParentUnitId(e.target.value);
                    limparMensagens();
                  }}
                >
                  <option value="">Sem unidade superior</option>
                  {managerUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} - {unit.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="unitsField">
                <label>Possui subordinadas?</label>
                <select
                  value={isManager ? "SIM" : "NAO"}
                  onChange={(e) => {
                    const nextValue = e.target.value === "SIM";

                    if (!nextValue && editingHasChildren) {
                      setErro(
                        "Esta unidade já possui subordinadas e deve permanecer como gestora."
                      );
                      return;
                    }

                    setIsManager(nextValue);
                    limparMensagens();
                  }}
                >
                  <option value="SIM">Sim</option>
                  <option value="NAO">Não</option>
                </select>
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
                      ? "Atualizar unidade"
                      : "Salvar unidade"}
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
                <FolderTree size={18} />
              </div>
              <div>
                <h2>Estrutura hierárquica</h2>
                <p>
                  Clique na unidade para expandir ou recolher. Use o botão “+”
                  para adicionar subordinadas.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="unitsEmpty">Carregando unidades...</div>
            ) : rootUnits.length === 0 ? (
              <div className="unitsEmpty">Nenhuma unidade cadastrada.</div>
            ) : (
              <div className="unitsTree cleanTree">
                {rootUnits.map((unit) => renderUnitNode(unit))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}