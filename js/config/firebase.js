import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Ganti dengan konfigurasi Web App dari Firebase Console proyek lu
const firebaseConfig = {
  apiKey: "AIzaSyCIAeQ40SwBmzkQqHu-gJUlBAxlRC2F7R0",
  authDomain: "kasir-toko-882be.firebaseapp.com",
  projectId: "kasir-toko-882be",
  storageBucket: "kasir-toko-882be.firebasestorage.app",
  messagingSenderId: "714572074883",
  appId: "1:714572074883:web:99f6dfed1bb4a236d4f0b6",
  measurementId: "G-XJG1FBXYCW"
};

// 1. Inisialisasi Firebase App
export const app = initializeApp(firebaseConfig);

// 2. Inisialisasi Authentication
export const auth = getAuth(app);

// 3. Inisialisasi Firestore dengan Offline Persistence (IndexedDB Auto-Sync)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Helper pantau status jaringan real-time
export function initNetworkMonitor(badgeElement) {
  const updateStatus = () => {
    if (navigator.onLine) {
      badgeElement.textContent = "Online";
      badgeElement.classList.remove("offline");
      badgeElement.classList.add("online");
    } else {
      badgeElement.textContent = "Offline (Auto-Sync)";
      badgeElement.classList.remove("online");
      badgeElement.classList.add("offline");
    }
  };

  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
  updateStatus();
}

export { onAuthStateChanged, signInWithEmailAndPassword, signOut };
