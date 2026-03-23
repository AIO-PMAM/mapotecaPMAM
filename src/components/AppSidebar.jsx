import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import {
  LayoutDashboard,
  PlusCircle,
  Building2,
  Settings,
  Shield,
  Users,
} from "lucide-react";

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

  return raw;
}

export default function AppSidebar({
  user,
  claims,
  active = "home",
  onGoHome,
  onGoCreateEvent,
  onGoUnits,
  onGoAccess,
}) {
  const canViewAll = !!claims?.canViewAll;
  const role = claims?.role || "-";
  const unitId = claims?.unitId || "-";
  const accessProfile = normalizeAccessProfile(claims?.accessProfile || "");
  const isReadOnlyProfile =
    accessProfile === "VISUALIZACAO" ||
    claims?.permissions?.canEdit === false;

  async function logout() {
    await signOut(auth);
  }

  return (
    <aside className="dashboardSidebar">
      <div className="sidebarBrand">
        <div className="brandLogo">
          <Shield size={22} />
        </div>
        <div>
          <div className="brandTitle">Mapoteca PMAM</div>
          <div className="brandSubtitle">Painel Operacional</div>
        </div>
      </div>

      <nav className="sidebarNav">
        <button
          className={`navItem ${active === "home" ? "navItemActive" : ""}`}
          onClick={() => onGoHome?.()}
          type="button"
        >
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </button>

        {!isReadOnlyProfile && (
          <button
            className={`navItem navItemCreate ${
              active === "create-event" ? "navItemActiveCreate" : ""
            }`}
            onClick={() => onGoCreateEvent?.()}
            type="button"
          >
            <PlusCircle size={18} />
            <span>Criar Evento</span>
          </button>
        )}

        {!isReadOnlyProfile && (
          <button
            className={`navItem ${active === "units" ? "navItemActive" : ""}`}
            onClick={() => onGoUnits?.()}
            type="button"
          >
            <Building2 size={18} />
            <span>Unidades</span>
          </button>
        )}

        {!isReadOnlyProfile && (
          <button
            className={`navItem ${active === "access" ? "navItemActive" : ""}`}
            onClick={() => onGoAccess?.()}
            type="button"
          >
            <Users size={18} />
            <span>Acessos</span>
          </button>
        )}

        <button
          className={`navItem ${active === "settings" ? "navItemActive" : ""}`}
          onClick={() => onGoSettings?.()}
          type="button"
        >
          <Settings size={18} />
          <span>Configurações</span>
        </button>
      </nav>

      <div className="sidebarUserCard">
        <div className="userMail">{user?.email || "-"}</div>
        <div className="userMeta">
          Role: <b>{role}</b>
        </div>
        <div className="userMeta">
          Unidade: <b>{unitId}</b>
        </div>
        <div className="userMeta">
          Visão total: <b>{canViewAll ? "SIM" : "NÃO"}</b>
        </div>
        <div className="userMeta">
          Perfil de acesso: <b>{accessProfile || "-"}</b>
        </div>

        <button className="logoutBtn" onClick={logout} type="button">
          Sair
        </button>
      </div>
    </aside>
  );
}