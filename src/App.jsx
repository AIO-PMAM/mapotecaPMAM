import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
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
  return String(value || "").trim().toUpperCase();
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

  const role =
    String(
      tokenClaims?.role ||
        userDocData?.role ||
        tokenClaims?.profile ||
        userDocData?.profile ||
        ""
    ).trim() || "";

  const roles = uniqueStrings([
    ...toArray(tokenClaims?.roles),
    ...toArray(userDocData?.roles),
    ...toArray(tokenClaims?.role),
    ...toArray(userDocData?.role),
    ...toArray(tokenClaims?.profile),
    ...toArray(userDocData?.profile),
  ]);

  const unitIds = uniqueStrings([
    ...toArray(tokenClaims?.unitId),
    ...toArray(tokenClaims?.currentUnitId),
    ...toArray(userDocData?.unitId),
    ...toArray(userDocData?.currentUnitId),
    ...toArray(tokenClaims?.unitIds),
    ...toArray(userDocData?.unitIds),
  ]);

  const unitCodes = uniqueCodes([
    ...toArray(tokenClaims?.unitCode),
    ...toArray(tokenClaims?.command),
    ...toArray(userDocData?.unitCode),
    ...toArray(userDocData?.command),
    ...toArray(tokenClaims?.unitCodes),
    ...toArray(tokenClaims?.commands),
    ...toArray(userDocData?.unitCodes),
    ...toArray(userDocData?.commands),
  ]);

  const commands = uniqueCodes([
    ...toArray(tokenClaims?.command),
    ...toArray(tokenClaims?.commands),
    ...toArray(userDocData?.command),
    ...toArray(userDocData?.commands),
  ]);

  const canViewAll =
    tokenClaims?.canViewAll === true || userDocData?.canViewAll === true;

  const isAio =
    tokenClaims?.isAio === true ||
    userDocData?.isAio === true ||
    role.toUpperCase() === "AIO" ||
    roles.some((item) => item.toUpperCase() === "AIO") ||
    unitCodes.includes("AIO");

  return {
    ...merged,
    role,
    roles,
    unitId: unitIds[0] || "",
    currentUnitId: unitIds[0] || "",
    unitIds,
    unitCode: unitCodes[0] || "",
    unitCodes,
    command: commands[0] || unitCodes[0] || "",
    commands,
    canViewAll,
    isAio,
  };
}

function buildResolvedUser(firebaseUser, mergedClaims) {
  if (!firebaseUser) return null;

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email || "",
    displayName: firebaseUser.displayName || "",
    photoURL: firebaseUser.photoURL || "",
    phoneNumber: firebaseUser.phoneNumber || "",
    emailVerified: !!firebaseUser.emailVerified,

    role: mergedClaims?.role || "",
    roles: mergedClaims?.roles || [],
    unitId: mergedClaims?.unitId || "",
    unitIds: mergedClaims?.unitIds || [],
    unitCode: mergedClaims?.unitCode || "",
    unitCodes: mergedClaims?.unitCodes || [],
    command: mergedClaims?.command || "",
    commands: mergedClaims?.commands || [],
    canViewAll: mergedClaims?.canViewAll === true,
    isAio: mergedClaims?.isAio === true,
  };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("home");

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!active) return;

      setLoading(true);

      if (u) {
        try {
          const token = await u.getIdTokenResult(true);
          const tokenClaims = token?.claims || {};

          let userDocData = {};
          try {
            const userRef = doc(db, "users", u.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              userDocData = userSnap.data() || {};
            }
          } catch (userDocError) {
            console.error("Erro ao carregar documento do usuário:", userDocError);
          }

          const mergedClaims = buildMergedClaims(tokenClaims, userDocData);
          const resolvedUser = buildResolvedUser(u, mergedClaims);

          if (!active) return;

          setUser(resolvedUser);
          setClaims(mergedClaims);
        } catch (error) {
          console.error("Erro ao carregar claims:", error);

          if (!active) return;

          const fallbackUser = buildResolvedUser(u, {});
          setUser(fallbackUser);
          setClaims({});
        }
      } else {
        setUser(null);
        setClaims(null);
        setScreen("home");
      }

      if (active) {
        setLoading(false);
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
        onBack={() => setScreen("home")}
        onCreated={() => setScreen("home")}
        onGoHome={() => setScreen("home")}
        onGoCreateEvent={() => setScreen("create-event")}
        onGoUnits={() => setScreen("units")}
        onGoAccess={() => setScreen("access")}
      />
    );
  }

  if (screen === "units") {
    return (
      <Units
        user={user}
        claims={claims}
        onBack={() => setScreen("home")}
        onGoHome={() => setScreen("home")}
        onGoCreateEvent={() => setScreen("create-event")}
        onGoUnits={() => setScreen("units")}
        onGoAccess={() => setScreen("access")}
      />
    );
  }

  if (screen === "access") {
    return (
      <AccessControl
        user={user}
        claims={claims}
        onBack={() => setScreen("home")}
        onGoHome={() => setScreen("home")}
        onGoCreateEvent={() => setScreen("create-event")}
        onGoUnits={() => setScreen("units")}
        onGoAccess={() => setScreen("access")}
      />
    );
  }

  return (
    <Home
      user={user}
      claims={claims}
      onCreateEvent={() => setScreen("create-event")}
      onOpenUnits={() => setScreen("units")}
      onGoHome={() => setScreen("home")}
      onGoAccess={() => setScreen("access")}
    />
  );
}