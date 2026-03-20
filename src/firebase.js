import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDSRcNCe9AViPpSPgObxdfhq6tK8p3Xpzk",
  authDomain: "mapoteca-pmam.firebaseapp.com",
  projectId: "mapoteca-pmam",

  // CONFIRA NO CONSOLE DO FIREBASE > STORAGE
  // Se no console aparecer .firebasestorage.app, use esse.
  // Se aparecer .appspot.com, mantenha esse.
  storageBucket: "mapoteca-pmam.firebasestorage.app",

  messagingSenderId: "19309737191",
  appId: "1:19309737191:web:f5cebce010f9b4ee509e42",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;