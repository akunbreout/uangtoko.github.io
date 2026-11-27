import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  auth,
  db,
  signInWithEmailAndPassword,
  signOut
} from "../config/firebase.js";

// State sesi aktif di memori
let currentUserProfile = null;
let cachedPinHash = null;
let cachedStoreName = "TOKO INTERNAL";

export function getCurrentUser() {
  return currentUserProfile;
}

export function getStoreName() {
  return cachedStoreName;
}

// Hash SHA-256 (Web Crypto + Fallback untuk server lokal non-HTTPS)
export async function hashPin(pinText) {
  const cleanPin = String(pinText).trim();
  if (window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(cleanPin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback ringan jika crypto.subtle tidak tersedia di context HTTP LAN
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < cleanPin.length; i++) {
    const ch = cleanPin.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Login ke Firebase Auth
export async function loginUser(email, password) {
  return await signInWithEmailAndPassword(auth, email.trim(), password);
}

// Logout
export async function logoutUser() {
  currentUserProfile = null;
  await signOut(auth);
}

// Ambil profil role & cache hash PIN Owner untuk validasi offline
export async function loadUserSessionData(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error("Data profil user belum terdaftar di database Firestore.");
  }

  const userData = userSnap.data();
  if (!userData.active) {
    await signOut(auth);
    throw new Error("Akun ini dinonaktifkan oleh Owner.");
  }

  currentUserProfile = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    name: userData.name || firebaseUser.email.split("@")[0],
    role: userData.role // 'owner' | 'staf' | 'kasir'
  };

  // Muat pengaturan toko & hash PIN Owner (tersimpan di IndexedDB untuk offline)
  try {
    const secSnap = await getDoc(doc(db, "settings", "security"));
    if (secSnap.exists()) {
      const secData = secSnap.data();
      cachedPinHash = secData.owner_pin_hash || null;
      if (secData.store_name) cachedStoreName = secData.store_name;
    }
  } catch (err) {
    console.warn("Gagal memuat settings/security:", err.message);
  }

  return currentUserProfile;
}

// Simpan / Ubah PIN Owner & Nama Toko (Khusus Role Owner)
export async function saveOwnerSecuritySettings(storeName, newPin) {
  if (!currentUserProfile || currentUserProfile.role !== "owner") {
    throw new Error("Hanya Owner yang diizinkan mengubah pengaturan keamanan.");
  }

  const payload = {
    store_name: storeName.trim() || "TOKO INTERNAL",
    updated_at: serverTimestamp()
  };

  if (newPin && newPin.trim().length > 0) {
    if (!/^\d{6}$/.test(newPin.trim())) {
      throw new Error("PIN Owner harus terdiri dari tepat 6 digit angka.");
    }
    const hashed = await hashPin(newPin.trim());
    payload.owner_pin_hash = hashed;
    cachedPinHash = hashed;
  }

  await setDoc(doc(db, "settings", "security"), payload, { merge: true });
  cachedStoreName = payload.store_name;
}

// Dialog Modal Verifikasi PIN Owner (Bisa jalan offline penuh)
export function requestOwnerPin(reasonText = "Tindakan ini memerlukan otorisasi Owner.") {
  return new Promise((resolve) => {
    // Jika yang login adalah Owner sendiri dan PIN belum diatur, izinkan langsung
    if (currentUserProfile?.role === "owner" && !cachedPinHash) {
      resolve(true);
      return;
    }

    if (!cachedPinHash) {
      alert("PIN Owner belum diatur! Minta Owner mengatur PIN 6 digit di menu Pengaturan.");
      resolve(false);
      return;
    }

    const modal = document.getElementById("modal-pin");
    const reasonEl = document.getElementById("pin-reason");
    const inputEl = document.getElementById("owner-pin-input");
    const errorEl = document.getElementById("pin-error");
    const btnConfirm = document.getElementById("btn-pin-confirm");
    const btnCancel = document.getElementById("btn-pin-cancel");

    reasonEl.textContent = reasonText;
    inputEl.value = "";
    errorEl.classList.add("hidden");
    modal.classList.remove("hidden");
    setTimeout(() => inputEl.focus(), 50);

    const cleanup = () => {
      modal.classList.add("hidden");
      btnConfirm.onclick = null;
      btnCancel.onclick = null;
      inputEl.onkeydown = null;
    };

    const verify = async () => {
      const entered = inputEl.value.trim();
      if (entered.length !== 6) {
        errorEl.textContent = "Masukkan 6 digit angka PIN.";
        errorEl.classList.remove("hidden");
        return;
      }

      const enteredHash = await hashPin(entered);
      if (enteredHash === cachedPinHash) {
        cleanup();
        resolve(true);
      } else {
        errorEl.textContent = "PIN Owner salah!";
        errorEl.classList.remove("hidden");
        inputEl.value = "";
        inputEl.focus();
      }
    };

    btnConfirm.onclick = verify;
    btnCancel.onclick = () => {
      cleanup();
      resolve(false);
    };
    inputEl.onkeydown = (e) => {
      if (e.key === "Enter") verify();
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      }
    };
  });
}
