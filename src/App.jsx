import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import Login from "./pages/Login";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          const userRef = doc(db, "users", u.uid);
          await getDoc(userRef);
          setUser(u);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Erro no App:", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (loading) return <div>Carregando...</div>;
  if (!user) return <Login />;
  return <div>Usuário logado</div>;
}