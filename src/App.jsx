import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";

import Login from "./pages/Login";
import Home from "./pages/Home";
import CreateEvent from "./pages/CreateEvent";
import Units from "./pages/Units";
import AccessControl from "./pages/AccessControl";

import "leaflet/dist/leaflet.css";

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function uniqueCodes(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => normalizeCode(item))
        .filter(Boolean)
    )
  );
}

function buildMergedClaims(tokenClaims = {}, userDocData = {}) {
  const merged = {
    ...userDocData,
    ...tokenClaims,
  };

  const accessProfile =
    String(
      tokenClaims?.accessProfile ||
        userDocData?.accessProfile ||
        tokenClaims?.profile ||
        userDocData?.profile ||
        tokenClaims?.role ||
        userDocData?.role ||
        tokenClaims?.systemRole ||
        userDocData?.systemRole ||
        ""
    ).trim() || "";

  const role =
    String(
      tokenClaims?.role ||
        userDocData?.role ||
        tokenClaims?.systemRole ||
        userDocData?.systemRole ||
        tokenClaims?.profile ||
        userDocData?.profile ||
        tokenClaims?.accessProfile ||
        userDocData?.accessProfile ||
        ""
    ).trim() || "";

  const roles = uniqueStrings([
    ...toArray(tokenClaims?.roles),
    ...toArray(userDocData?.roles),
    ...toArray(tokenClaims?.role),
    ...toArray(userDocData?.role),
    ...toArray(tokenClaims?.profile),
    ...toArray(userDocData?.profile),
    ...toArray(tokenClaims?.accessProfile),
    ...toArray(userDocData?.accessProfile),
    ...toArray(tokenClaims?.systemRole),
    ...toArray(userDocData?.systemRole),
  ]);

  const accessScopeUnitIds = uniqueStrings([
    ...toArray(userDocData?.accessScopeUnitIds),
    ...toArray(tokenClaims?.accessScopeUnitIds),
    ...toArray(userDocData?.unitIds),
    ...toArray(tokenClaims?.unitIds),
    ...toArray(userDocData?.ancestorUnitIds),
  ]);

  const accessScopeUnitCodes = uniqueCodes([
    ...toArray(userDocData?.accessScopeUnitCodes),
    ...toArray(tokenClaims?.accessScopeUnitCodes),
    ...toArray(userDocData?.unitCodes),
    ...toArray(tokenClaims?.unitCodes),
    ...toArray(userDocData?.commands),
    ...toArray(tokenClaims?.commands),
  ]);

  const accessScopeUnitNames = uniqueStrings([
    ...toArray(userDocData?.accessScopeUnitNames),
    ...toArray(tokenClaims?.accessScopeUnitNames),
    ...toArray(userDocData?.unitName),
  ]);

  const primaryUnitId = String(
    userDocData?.unitId ||
      userDocData?.currentUnitId ||
      tokenClaims?.unitId ||
      tokenClaims?.currentUnitId ||
      accessScopeUnitIds[0] ||
      ""
  ).trim();

  const primaryUnitCode = normalizeCode(
    userDocData?.unitCode ||
      userDocData?.command ||
      tokenClaims?.unitCode ||
      tokenClaims?.command ||
      accessScopeUnitCodes[0] ||
      ""
  );

  const unitIds = uniqueStrings([
    primaryUnitId,
    ...accessScopeUnitIds,
    ...toArray(tokenClaims?.unitIds),
    ...toArray(userDocData?.unitIds),
  ]);

  const unitCodes = uniqueCodes([
    primaryUnitCode,
    ...accessScopeUnitCodes,
    ...toArray(tokenClaims?.unitCodes),
    ...toArray(userDocData?.unitCodes),
  ]);

  const commands = uniqueCodes([
    primaryUnitCode,
    ...toArray(tokenClaims?.command),
    ...toArray(tokenClaims?.commands),
    ...toArray(userDocData?.command),
    ...toArray(userDocData?.commands),
    ...accessScopeUnitCodes,
  ]);

  const permissions = {
    ...(userDocData?.permissions || {}),
    ...(tokenClaims?.permissions || {}),
  };

  const canViewAll =
    tokenClaims?.canViewAll === true ||
    userDocData?.canViewAll === true ||
    permissions?.canViewAll === true ||
    accessProfile.toUpperCase() === "AIO_ADMIN";

  const canManageAll =
    tokenClaims?.canManageAll === true ||
    userDocData?.canManageAll === true ||
    tokenClaims?.canEditAll === true ||
    userDocData?.canEditAll === true ||
    permissions?.canManageAll === true ||
    permissions?.canEditAll === true ||
    accessProfile.toUpperCase() === "AIO_ADMIN";

  const isAio =
    tokenClaims?.isAio === true ||
    userDocData?.isAio === true ||
    accessProfile.toUpperCase() === "AIO" ||
    accessProfile.toUpperCase() === "AIO_ADMIN" ||
    role.toUpperCase() === "AIO" ||
    role.toUpperCase() === "AIO_ADMIN" ||
    roles.some((item) => normalizeCode(item) === "AIO") ||
    roles.some((item) => normalizeCode(item) === "AIO_ADMIN") ||
    accessScopeUnitCodes.includes("AIO");

  return {
    ...merged,
    email: normalizeEmail(tokenClaims?.email || userDocData?.email || ""),
    role,
    roles,
    accessProfile,
    systemRole:
      tokenClaims?.systemRole ||
      userDocData?.systemRole ||
      accessProfile ||
      role ||
      "",
    unitId: primaryUnitId,
    currentUnitId: primaryUnitId,
    unitIds,
    unitCode: primaryUnitCode,
    unitCodes,
    command: primaryUnitCode || commands[0] || "",
    commands,
    accessScopeUnitIds,
    accessScopeUnitCodes,
    accessScopeUnitNames,
    permissions,
    canViewAll,
    canManageAll,
    canEditAll: canManageAll,
    isAio,
    profileSource: userDocData?.profileSource || tokenClaims?.profileSource || "",
    status: userDocData?.status || tokenClaims?.status || "",
    isActive:
      userDocData?.isActive === false
        ? false
        : String(userDocData?.status || "").toUpperCase() === "INACTIVE"
        ? false
        : true,
  };
}

function buildResolvedUser(firebaseUser, mergedClaims) {
  if (!firebaseUser) return null;

  return {
    uid: firebaseUser.uid,
    email: normalizeEmail(firebaseUser.email || mergedClaims?.email || ""),
    displayName: firebaseUser.displayName || "",
    photoURL: firebaseUser.photoURL || "",
    phoneNumber: firebaseUser.phoneNumber || "",
    emailVerified: !!firebaseUser.emailVerified,

    fullName:
      mergedClaims?.fullName ||
      mergedClaims?.name ||
      firebaseUser.displayName ||
      "",
    postoGrad: mergedClaims?.postoGrad || "",
    funcao: mergedClaims?.funcao || "",
    ci: mergedClaims?.ci || "",
    cpf: mergedClaims?.cpf || "",

    role: mergedClaims?.role || "",
    roles: mergedClaims?.roles || [],
    accessProfile: mergedClaims?.accessProfile || "",
    systemRole: mergedClaims?.systemRole || "",

    unitId: mergedClaims?.unitId || "",
    unitIds: mergedClaims?.unitIds || [],
    unitCode: mergedClaims?.unitCode || "",
    unitCodes: mergedClaims?.unitCodes || [],

    command: mergedClaims?.command || "",
    commands: mergedClaims?.commands || [],

    accessScopeUnitIds: mergedClaims?.accessScopeUnitIds || [],
    accessScopeUnitCodes: mergedClaims?.accessScopeUnitCodes || [],
    accessScopeUnitNames: mergedClaims?.accessScopeUnitNames || [],

    permissions: mergedClaims?.permissions || {},
    canViewAll: mergedClaims?.canViewAll === true,
    canManageAll: mergedClaims?.canManageAll === true,
    canEditAll: mergedClaims?.canManageAll === true,
    isAio: mergedClaims?.isAio === true,

    status: mergedClaims?.status || "",
    isActive: mergedClaims?.isActive !== false,

    profileSource: mergedClaims?.profileSource || "",
  };
}

async function findUserProfile(authUser) {
  const uid = String(authUser?.uid || "").trim();
  const email = normalizeEmail(authUser?.email || "");

  const collectionsToTry = ["users", "access_profiles"];

  for (const collectionName of collectionsToTry) {
    try {
      const snapById = await getDoc(doc(db, collectionName, uid));
      if (snapById.exists()) {
        return {
          data: snapById.data() || {},
          source: `${collectionName}/${uid}`,
        };
      }
    } catch (error) {
      console.error(`[PROFILE] erro ao buscar por ID em ${collectionName}:`, error);
    }

    try {
      const qByUid = query(
        collection(db, collectionName),
        where("uid", "==", uid),
        limit(1)
      );
      const qsByUid = await getDocs(qByUid);

      if (!qsByUid.empty) {
        return {
          data: qsByUid.docs[0].data() || {},
          source: `${collectionName} (campo uid)`,
        };
      }
    } catch (error) {
      console.error(
        `[PROFILE] erro ao buscar por campo uid em ${collectionName}:`,
        error
      );
    }

    try {
      if (email) {
        const qByEmail = query(
          collection(db, collectionName),
          where("email", "==", email),
          limit(1)
        );
        const qsByEmail = await getDocs(qByEmail);

        if (!qsByEmail.empty) {
          return {
            data: qsByEmail.docs[0].data() || {},
            source: `${collectionName} (campo email)`,
          };
        }
      }
    } catch (error) {
      console.error(
        `[PROFILE] erro ao buscar por email em ${collectionName}:`,
        error
      );
    }
  }

  return {
    data: {},
    source: "NAO_ENCONTRADO",
  };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("home");

  function goHome() {
    setScreen("home");
  }

  function goCreateEvent() {
    setScreen("create-event");
  }

  function goUnits() {
    setScreen("units");
  }

  function goAccess() {
    setScreen("access");
  }

  function goSettings() {
    setScreen("settings");
  }

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;

      setLoading(true);

      if (!firebaseUser) {
        setUser(null);
        setClaims(null);
        setScreen("home");
        if (active) setLoading(false);
        return;
      }

      try {
        const token = await firebaseUser.getIdTokenResult(true);
        const tokenClaims = token?.claims || {};

        let userDocData = {};
        let profileSource = "NAO_ENCONTRADO";

        try {
          const profileResult = await findUserProfile(firebaseUser);
          userDocData = profileResult.data || {};
          profileSource = profileResult.source || "NAO_ENCONTRADO";
        } catch (userDocError) {
          console.error("Erro ao carregar documento do usuário:", userDocError);
        }

        const mergedClaims = buildMergedClaims(tokenClaims, {
          ...userDocData,
          profileSource,
        });

        const resolvedUser = buildResolvedUser(firebaseUser, mergedClaims);

        if (!active) return;

        setUser(resolvedUser);
        setClaims(mergedClaims);
      } catch (error) {
        console.error("Erro ao carregar sessão do usuário:", error);

        if (!active) return;

        const fallbackUser = buildResolvedUser(firebaseUser, {});
        setUser(fallbackUser);
        setClaims({});
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "18px",
        }}
      >
        Carregando sistema...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (screen === "create-event") {
    return (
      <CreateEvent
        user={user}
        claims={claims}
        onBack={goHome}
        onCreated={goHome}
        onGoHome={goHome}
        onGoCreateEvent={goCreateEvent}
        onGoUnits={goUnits}
        onGoAccess={goAccess}
        onGoSettings={goSettings}
      />
    );
  }

  if (screen === "units") {
    return (
      <Units
        user={user}
        claims={claims}
        onBack={goHome}
        onGoHome={goHome}
        onGoCreateEvent={goCreateEvent}
        onGoUnits={goUnits}
        onGoAccess={goAccess}
        onGoSettings={goSettings}
      />
    );
  }

  if (screen === "access") {
    return (
      <AccessControl
        user={user}
        claims={claims}
        onBack={goHome}
        onGoHome={goHome}
        onGoCreateEvent={goCreateEvent}
        onGoUnits={goUnits}
        onGoAccess={goAccess}
        onGoSettings={goSettings}
      />
    );
  }

  if (screen === "settings") {
    return (
      <Settings
        user={user}
        claims={claims}
        onBack={goHome}
        onGoHome={goHome}
        onGoCreateEvent={goCreateEvent}
        onGoUnits={goUnits}
        onGoAccess={goAccess}
        onGoSettings={goSettings}
      />
    );
  }

  return (
    <Home
      user={user}
      claims={claims}
      onCreateEvent={goCreateEvent}
      onOpenUnits={goUnits}
      onGoHome={goHome}
      onGoCreateEvent={goCreateEvent}
      onGoUnits={goUnits}
      onGoAccess={goAccess}
      onGoSettings={goSettings}
    />
  );
}