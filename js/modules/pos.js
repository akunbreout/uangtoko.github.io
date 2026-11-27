import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../config/firebase.js";
import { getCurrentUser, getStoreName, requestOwnerPin } from "./auth.js";
import {
  formatRupiah,
  formatMultiUnitStock,
  openBarcodeScannerModal
} from "./inventory.js";

// State lokal real-time (sinkron otomatis dengan IndexedDB saat offline)
let productsList = [];
let allBatchesList = []; // Menyimpan semua batch (termasuk qty_remaining == 0 untuk keperluan restore void/retur)
let recentTransactions = [];
let cartItems = [];

let unsubProducts = null;
let unsubBatches = null;
let unsubTransactions = null;

// --- RENDER UTAMA MODUL KASIR (POS) ---

export function renderPosView(container) {
  const user = getCurrentUser();
  if (!user) return;

  container.innerHTML = `
    <!-- Sub-Tab Kasir vs Riwayat & Void/Retur -->
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button type="button" id="tab-pos-cashier" class="btn-primary">Layar Kasir (POS)</button>
      <button type="button" id="tab-pos-history" class="btn-secondary">Riwayat & Void / Retur</button>
    </div>

    <!-- VIEW 1: LAYAR KASIR -->
    <div id="pos-cashier-view">
      <div class="grid-2" style="align-items:start;">
        <!-- Kolom Kiri: Scan Barcode & Pilih Produk -->
        <div>
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
              <h3 style="margin:0;">Scan / Cari Barang</h3>
              <button type="button" id="btn-pos-cam" class="btn-primary btn-sm">Scan Kamera</button>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:10px;">
              <input
                type="text"
                id="pos-barcode-input"
                placeholder="Scan barcode dus/eceran atau ketik nama produk..."
                autocomplete="off"
              />
              <button type="button" id="btn-pos-scan-submit" class="btn-secondary">Tambah</button>
            </div>
            <p id="pos-scan-alert" class="hidden" style="font-size:0.85rem; font-weight:600; margin-bottom:8px;"></p>

            <!-- Daftar Cepat Produk & Pilihan Satuan (Dus / Eceran) -->
            <div id="pos-product-catalog" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
              <p class="text-muted">Memuat katalog produk...</p>
            </div>
          </div>
        </div>

        <!-- Kolom Kanan: Keranjang & Pembayaran -->
        <div>
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <h3 style="margin:0;">Keranjang Belanja</h3>
              <button type="button" id="btn-clear-cart" class="btn-danger btn-sm hidden">Kosongkan</button>
            </div>

            <div id="pos-cart-list" style="margin-bottom:14px;">
              <p class="text-muted">Keranjang masih kosong. Scan barcode atau pilih produk.</p>
            </div>

            <div style="border-top:2px solid var(--border); padding-top:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:1.15rem; font-weight:700; margin-bottom:12px;">
                <span>Total Tagihan</span>
                <span id="pos-grand-total" style="color:var(--accent);">Rp 0</span>
              </div>

              <form id="pos-checkout-form">
                <div class="grid-2">
                  <div class="form-group">
                    <label for="pos-pay-method">Metode Pembayaran</label>
                    <select id="pos-pay-method" required>
                      <option value="Tunai">Tunai (Cash)</option>
                      <option value="QRIS">QRIS</option>
                      <option value="Transfer">Transfer Bank</option>
                      <option value="Tempo">Tempo / Piutang (Bon)</option>
                    </select>
                  </div>
                  <div class="form-group" id="group-amount-paid">
                    <label for="pos-amount-paid">Uang Diterima (Rp)</label>
                    <input type="number" id="pos-amount-paid" min="0" placeholder="0" />
                  </div>
                </div>

                <div class="form-group" id="group-customer-name">
                  <label for="pos-customer-name" id="label-customer-name">Nama Pelanggan (Opsional)</label>
                  <input type="text" id="pos-customer-name" placeholder="Contoh: Ibu Siti / Umum" />
                </div>

                <div id="pos-change-box" style="background:#f8fafc; border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:12px; display:flex; justify-content:space-between; font-weight:700;">
                  <span>Kembalian:</span>
                  <span id="pos-change-amount" style="color:var(--success);">Rp 0</span>
                </div>

                <button type="submit" id="btn-pos-checkout" class="btn-success btn-block" style="padding:12px; font-size:1rem;" disabled>
                  Proses Pembayaran & Cetak Struk
                </button>
                <p id="pos-checkout-msg" style="margin-top:8px; font-weight:600;"></p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 2: RIWAYAT TRANSAKSI, VOID & RETUR -->
    <div id="pos-history-view" class="hidden">
      <div class="card">
        <h3>Riwayat Transaksi Terakhir</h3>
        <p class="text-muted">Pembatalan (Void) atau Retur barang oleh Kasir wajib diverifikasi dengan <strong>PIN Owner</strong> dan otomatis mengembalikan stok ke batch FIFO.</p>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead>
              <tr>
                <th>No. Nota / Waktu</th>
                <th>Item & Pembayaran</th>
                <th>Total</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody id="pos-history-tbody">
              <tr><td colspan="5" class="text-muted">Memuat riwayat transaksi...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MODAL STRUK DIGITAL -->
    <div id="modal-receipt" class="modal-backdrop hidden">
      <div class="modal-box" style="max-width:380px;">
        <div id="receipt-printable-area" style="font-family:monospace; font-size:0.85rem; line-height:1.45;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button type="button" id="btn-print-receipt" class="btn-primary">Cetak Struk</button>
          <button type="button" id="btn-close-receipt" class="btn-secondary">Tutup</button>
        </div>
      </div>
    </div>
  `;

  setupPosSubTabs();
  setupPosInteractions();
  subscribePosData();
}

// --- LISTENER REAL-TIME FIRESTORE ---

function subscribePosData() {
  if (unsubProducts) unsubProducts();
  if (unsubBatches) unsubBatches();
  if (unsubTransactions) unsubTransactions();

  unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
    productsList = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderCatalogList(document.getElementById("pos-barcode-input")?.value || "");
    renderCart();
  });

  unsubBatches = onSnapshot(collection(db, "batches"), (snap) => {
    allBatchesList = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.created_at_ms || 0) - (b.created_at_ms || 0));
  });

  unsubTransactions = onSnapshot(collection(db, "transactions"), (snap) => {
    recentTransactions = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0))
      .slice(0, 40);
    renderTransactionHistory();
  });
}

// --- NAVIGASI SUB-TAB ---

function setupPosSubTabs() {
  const btnCashier = document.getElementById("tab-pos-cashier");
  const btnHistory = document.getElementById("tab-pos-history");
  const viewCashier = document.getElementById("pos-cashier-view");
  const viewHistory = document.getElementById("pos-history-view");

  btnCashier.onclick = () => {
    btnCashier.className = "btn-primary";
    btnHistory.className = "btn-secondary";
    viewCashier.classList.remove("hidden");
    viewHistory.classList.add("hidden");
  };

  btnHistory.onclick = () => {
    btnHistory.className = "btn-primary";
    btnCashier.className = "btn-secondary";
    viewHistory.classList.remove("hidden");
    viewCashier.classList.add("hidden");
    renderTransactionHistory();
  };
}

// --- SCANNER, KATALOG & LOGIKA KERANJANG MULTI-SATUAN ---

function setupPosInteractions() {
  const searchInput = document.getElementById("pos-barcode-input");
  const btnScanSubmit = document.getElementById("btn-pos-scan-submit");
  const btnCam = document.getElementById("btn-pos-cam");
  const btnClear = document.getElementById("btn-clear-cart");
  const payMethodSelect = document.getElementById("pos-pay-method");
  const amountPaidInput = document.getElementById("pos-amount-paid");

  const handleBarcodeOrSearch = (rawQuery) => {
    const query = String(rawQuery || "").trim();
    if (!query) return;

    // 1. Cek kecocokan persis dengan barcode satuan (Dus atau Eceran)
    for (const p of productsList) {
      const matchedUnit = (p.units || []).find((u) => u.barcode === query);
      if (matchedUnit) {
        addToCart(p.id, matchedUnit.unit_name, 1);
        searchInput.value = "";
        renderCatalogList("");
        return;
      }
    }

    // 2. Jika bukan barcode persis, filter katalog berdasarkan nama
    renderCatalogList(query);
    showPosAlert(`Menampilkan hasil pencarian untuk "${query}".`, false);
  };

  searchInput.oninput = () => renderCatalogList(searchInput.value);
  searchInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBarcodeOrSearch(searchInput.value);
    }
  };
  btnScanSubmit.onclick = () => handleBarcodeOrSearch(searchInput.value);

  btnCam.onclick = () => {
    openBarcodeScannerModal((code) => {
      handleBarcodeOrSearch(code);
    });
  };

  btnClear.onclick = () => {
    cartItems = [];
    renderCart();
  };

  payMethodSelect.onchange = () => {
    const method = payMethodSelect.value;
    const custLabel = document.getElementById("label-customer-name");
    const custInput = document.getElementById("pos-customer-name");
    const paidGroup = document.getElementById("group-amount-paid");
    const changeBox = document.getElementById("pos-change-box");

    if (method === "Tempo") {
      custLabel.textContent = "Nama Pelanggan (Wajib untuk Tempo/Bon)";
      custInput.required = true;
      paidGroup.classList.add("hidden");
      changeBox.classList.add("hidden");
    } else if (method === "Tunai") {
      custLabel.textContent = "Nama Pelanggan (Opsional)";
      custInput.required = false;
      paidGroup.classList.remove("hidden");
      changeBox.classList.remove("hidden");
      updatePaymentSummary();
    } else {
      // QRIS atau Transfer (nominal pas)
      custLabel.textContent = "Nama Pelanggan (Opsional)";
      custInput.required = false;
      paidGroup.classList.add("hidden");
      changeBox.classList.add("hidden");
    }
  };

  amountPaidInput.oninput = updatePaymentSummary;

  document.getElementById("pos-checkout-form").onsubmit = handleCheckoutSubmit;

  document.getElementById("btn-close-receipt").onclick = () => {
    document.getElementById("modal-receipt").classList.add("hidden");
  };
  document.getElementById("btn-print-receipt").onclick = () => {
    window.print();
  };
}

function showPosAlert(message, isError = true) {
  const el = document.getElementById("pos-scan-alert");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--danger)" : "var(--success)";
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

// Hitung total satuan terkecil yang sudah masuk keranjang untuk produk tertentu
function getCartReservedBaseQty(productId) {
  return cartItems
    .filter((item) => item.product_id === productId)
    .reduce((sum, item) => sum + item.qty * item.ratio, 0);
}

function addToCart(productId, unitName, addQty = 1) {
  const product = productsList.find((p) => p.id === productId);
  if (!product) return;

  const unitObj = (product.units || []).find((u) => u.unit_name === unitName);
  if (!unitObj) return;

  const availableBase = Number(product.total_stock_base) || 0;
  const reservedBase = getCartReservedBaseQty(productId);
  const neededBase = addQty * (Number(unitObj.ratio) || 1);

  if (reservedBase + neededBase > availableBase) {
    showPosAlert(
      `Stok ${product.name} tidak mencukupi! Sisa stok: ${formatMultiUnitStock(availableBase, product.units, product.base_unit)}.`,
      true
    );
    return;
  }

  const existingIdx = cartItems.findIndex(
    (c) => c.product_id === productId && c.unit_name === unitName
  );

  if (existingIdx >= 0) {
    cartItems[existingIdx].qty += addQty;
  } else {
    cartItems.push({
      product_id: product.id,
      product_name: product.name,
      base_unit: product.base_unit,
      unit_name: unitObj.unit_name,
      ratio: Number(unitObj.ratio) || 1,
      sell_price: Number(unitObj.sell_price) || 0,
      qty: addQty
    });
  }

  showPosAlert(`+ ${addQty} ${unitObj.unit_name} ${product.name}`, false);
  renderCart();
}

function renderCatalogList(keyword = "") {
  const catalogEl = document.getElementById("pos-product-catalog");
  if (!catalogEl) return;

  const q = keyword.trim().toLowerCase();
  const filtered = productsList.filter(
    (p) =>
      !q ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.barcode_index || []).some((b) => b.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    catalogEl.innerHTML = `<p class="text-muted">Produk tidak ditemukan.</p>`;
    return;
  }

  catalogEl.innerHTML = filtered
    .slice(0, 25)
    .map((p) => {
      const stockBase = Number(p.total_stock_base) || 0;
      const unitButtons = (p.units || [])
        .map((u) => {
          const disabled = stockBase < (Number(u.ratio) || 1) ? "disabled" : "";
          return `
            <button
              type="button"
              class="btn-secondary btn-sm btn-pick-unit"
              data-pid="${p.id}"
              data-unit="${u.unit_name}"
              ${disabled}
              style="font-size:0.78rem;"
            >
              + ${u.unit_name} (${formatRupiah(u.sell_price)})
            </button>
          `;
        })
        .join("");

      return `
        <div style="border:1px solid var(--border); border-radius:8px; padding:10px; background:#f8fafc;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">
            <strong>${p.name}</strong>
            <span class="text-muted" style="font-size:0.78rem;">
              Stok: ${formatMultiUnitStock(stockBase, p.units, p.base_unit)}
            </span>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${unitButtons}
          </div>
        </div>
      `;
    })
    .join("");

  catalogEl.querySelectorAll(".btn-pick-unit").forEach((btn) => {
    btn.onclick = () => addToCart(btn.dataset.pid, btn.dataset.unit, 1);
  });
}

function renderCart() {
  const cartEl = document.getElementById("pos-cart-list");
  const btnClear = document.getElementById("btn-clear-cart");
  const btnCheckout = document.getElementById("btn-pos-checkout");
  if (!cartEl) return;

  if (cartItems.length === 0) {
    cartEl.innerHTML = `<p class="text-muted">Keranjang masih kosong. Scan barcode atau pilih produk.</p>`;
    btnClear.classList.add("hidden");
    btnCheckout.disabled = true;
    updatePaymentSummary();
    return;
  }

  btnClear.classList.remove("hidden");
  btnCheckout.disabled = false;

  cartEl.innerHTML = cartItems
    .map((item, idx) => {
      const subtotal = item.qty * item.sell_price;
      const baseNote =
        item.ratio > 1 ? ` (= ${item.qty * item.ratio} ${item.base_unit})` : "";
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border);">
          <div style="flex:1;">
            <strong>${item.product_name}</strong><br/>
            <span class="text-muted" style="font-size:0.82rem;">
              ${item.unit_name} @ ${formatRupiah(item.sell_price)}${baseNote}
            </span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" class="btn-secondary btn-sm btn-qty-dec" data-idx="${idx}">-</button>
            <strong style="min-width:24px; text-align:center;">${item.qty}</strong>
            <button type="button" class="btn-secondary btn-sm btn-qty-inc" data-idx="${idx}">+</button>
          </div>
          <div style="min-width:92px; text-align:right; font-weight:700;">
            ${formatRupiah(subtotal)}
          </div>
        </div>
      `;
    })
    .join("");

  cartEl.querySelectorAll(".btn-qty-dec").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.idx);
      if (cartItems[i].qty > 1) {
        cartItems[i].qty -= 1;
      } else {
        cartItems.splice(i, 1);
      }
      renderCart();
    };
  });

  cartEl.querySelectorAll(".btn-qty-inc").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.idx);
      const item = cartItems[i];
      addToCart(item.product_id, item.unit_name, 1);
    };
  });

  updatePaymentSummary();
}

function getCartTotal() {
  return cartItems.reduce((sum, item) => sum + item.qty * item.sell_price, 0);
}

function updatePaymentSummary() {
  const total = getCartTotal();
  const totalEl = document.getElementById("pos-grand-total");
  const paidInput = document.getElementById("pos-amount-paid");
  const changeEl = document.getElementById("pos-change-amount");
  if (!totalEl) return;

  totalEl.textContent = formatRupiah(total);

  const paid = Number(paidInput?.value) || 0;
  const change = paid - total;
  if (changeEl) {
    changeEl.textContent = change >= 0 ? formatRupiah(change) : `Kurang ${formatRupiah(Math.abs(change))}`;
    changeEl.style.color = change >= 0 ? "var(--success)" : "var(--danger)";
  }
}

// --- CHECKOUT & KALKULASI POTONG BATCH HPP FIFO OTOMATIS ---

async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("pos-checkout-msg");
  const user = getCurrentUser();
  if (!user || cartItems.length === 0) return;

  const totalAmount = getCartTotal();
  const paymentMethod = document.getElementById("pos-pay-method").value;
  const customerName = document.getElementById("pos-customer-name").value.trim() || "Pelanggan Umum";
  const amountPaidInput = Number(document.getElementById("pos-amount-paid").value) || 0;

  if (paymentMethod === "Tunai" && amountPaidInput < totalAmount) {
    msgEl.style.color = "var(--danger)";
    msgEl.textContent = "Nominal uang tunai yang diterima kurang dari total tagihan!";
    return;
  }

  if (paymentMethod === "Tempo" && !document.getElementById("pos-customer-name").value.trim()) {
    msgEl.style.color = "var(--danger)";
    msgEl.textContent = "Nama pelanggan wajib diisi untuk transaksi Tempo / Piutang!";
    return;
  }

  const amountPaid = paymentMethod === "Tunai" ? amountPaidInput : paymentMethod === "Tempo" ? 0 : totalAmount;
  const changeAmount = paymentMethod === "Tunai" ? Math.max(0, amountPaid - totalAmount) : 0;
  const paymentStatus = paymentMethod === "Tempo" ? "unpaid" : "paid";

  try {
    // 1. Validasi final ketersediaan stok & simulasi potong batch FIFO di memori
    const virtualBatchRemaining = {};
    allBatchesList.forEach((b) => {
      virtualBatchRemaining[b.id] = Number(b.qty_remaining) || 0;
    });

    const productDeductions = {}; // product_id -> total base_qty deducted
    const processedItems = [];
    let grandTotalHpp = 0;

    for (const item of cartItems) {
      const baseQtyNeeded = item.qty * item.ratio;
      productDeductions[item.product_id] = (productDeductions[item.product_id] || 0) + baseQtyNeeded;

      const prod = productsList.find((p) => p.id === item.product_id);
      if (!prod || (Number(prod.total_stock_base) || 0) < productDeductions[item.product_id]) {
        throw new Error(`Stok ${item.product_name} tidak cukup untuk menyelesaikan transaksi.`);
      }

      // Ambil batch aktif produk ini urut dari terlama (FIFO)
      const prodBatches = allBatchesList.filter(
        (b) => b.product_id === item.product_id && virtualBatchRemaining[b.id] > 0
      );

      let remainingToAllocate = baseQtyNeeded;
      let itemHppTotal = 0;
      const fifoAllocations = [];

      for (const batch of prodBatches) {
        if (remainingToAllocate <= 0) break;
        const avail = virtualBatchRemaining[batch.id];
        const take = Math.min(avail, remainingToAllocate);
        const unitCost = Number(batch.unit_cost_base) || 0;

        virtualBatchRemaining[batch.id] = avail - take;
        remainingToAllocate -= take;
        itemHppTotal += take * unitCost;

        fifoAllocations.push({
          batch_id: batch.id,
          qty_taken: take,
          unit_cost_base: unitCost
        });
      }

      // Pengaman jika ada selisih historis tanpa batch aktif
      if (remainingToAllocate > 0) {
        const fallbackBatch = allBatchesList.filter((b) => b.product_id === item.product_id).pop();
        const fallbackCost = fallbackBatch ? Number(fallbackBatch.unit_cost_base) || 0 : 0;
        itemHppTotal += remainingToAllocate * fallbackCost;
      }

      grandTotalHpp += itemHppTotal;
      processedItems.push({
        product_id: item.product_id,
        product_name: item.product_name,
        base_unit: item.base_unit,
        unit_name: item.unit_name,
        ratio: item.ratio,
        qty: item.qty,
        base_qty: baseQtyNeeded,
        sell_price: item.sell_price,
        subtotal: item.qty * item.sell_price,
        item_hpp: itemHppTotal,
        fifo_allocations: fifoAllocations
      });
    }

    // 2. Eksekusi writeBatch atomik (aman untuk Offline-First & Firestore Rules)
    const batchWrite = writeBatch(db);
    const nowMs = Date.now();
    const invoiceNo = `INV-${new Date(nowMs).toISOString().slice(2, 10).replace(/-/g, "")}-${String(nowMs).slice(-4)}`;

    // Update setiap dokumen batch FIFO yang terpotong
    for (const batch of allBatchesList) {
      const originalQty = Number(batch.qty_remaining) || 0;
      const updatedQty = virtualBatchRemaining[batch.id];
      if (updatedQty !== originalQty) {
        batchWrite.update(doc(db, "batches", batch.id), {
          qty_remaining: updatedQty,
          updated_at: serverTimestamp()
        });
      }
    }

    // Update stok total pada setiap produk
    for (const [pid, deductedBase] of Object.entries(productDeductions)) {
      const prod = productsList.find((p) => p.id === pid);
      batchWrite.update(doc(db, "products", pid), {
        total_stock_base: Math.max(0, (Number(prod.total_stock_base) || 0) - deductedBase),
        updated_at: serverTimestamp()
      });
    }

    // Simpan dokumen transaksi lengkap dengan data HPP & Laba Kotor
    const txRef = doc(collection(db, "transactions"));
    const txPayload = {
      invoice_no: invoiceNo,
      cashier_id: user.uid,
      cashier_name: user.name,
      items: processedItems,
      total_amount: totalAmount,
      total_hpp: grandTotalHpp,
      gross_profit: totalAmount - grandTotalHpp,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      customer_name: customerName,
      amount_paid: amountPaid,
      change_amount: changeAmount,
      status: "completed",
      void_reason: "",
      authorized_by_pin: false,
      created_at_ms: nowMs,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    };
    batchWrite.set(txRef, txPayload);

    await batchWrite.commit();

    // Reset keranjang & tampilkan struk
    cartItems = [];
    document.getElementById("pos-amount-paid").value = "";
    document.getElementById("pos-customer-name").value = "";
    msgEl.textContent = "";
    renderCart();
    showReceiptModal(txPayload);
  } catch (err) {
    msgEl.style.color = "var(--danger)";
    msgEl.textContent = "Checkout gagal: " + err.message;
  }
}

// --- MODAL STRUK DIGITAL ---

function showReceiptModal(tx) {
  const modal = document.getElementById("modal-receipt");
  const area = document.getElementById("receipt-printable-area");
  const dateStr = new Date(tx.created_at_ms).toLocaleString("id-ID");

  const itemsLines = (tx.items || [])
    .map(
      (it) => `
      <div style="margin-bottom:6px;">
        <div><strong>${it.product_name}</strong></div>
        <div style="display:flex; justify-content:space-between;">
          <span>${it.qty} ${it.unit_name} x ${formatRupiah(it.sell_price)}</span>
          <span>${formatRupiah(it.subtotal)}</span>
        </div>
      </div>
    `
    )
    .join("");

  area.innerHTML = `
    <div style="text-align:center; border-bottom:1px dashed #333; padding-bottom:8px; margin-bottom:8px;">
      <strong style="font-size:1.05rem;">${getStoreName()}</strong><br/>
      <span>No: ${tx.invoice_no}</span><br/>
      <span>${dateStr}</span><br/>
      <span>Kasir: ${tx.cashier_name}</span>
    </div>
    <div style="border-bottom:1px dashed #333; padding-bottom:8px; margin-bottom:8px;">
      ${itemsLines}
    </div>
    <div style="display:flex; justify-content:space-between; font-weight:700;">
      <span>TOTAL</span>
      <span>${formatRupiah(tx.total_amount)}</span>
    </div>
    <div style="display:flex; justify-content:space-between;">
      <span>Metode (${tx.payment_method})</span>
      <span>${tx.payment_status === "unpaid" ? "TEMPO / BON" : formatRupiah(tx.amount_paid)}</span>
    </div>
    ${
      tx.payment_method === "Tunai"
        ? `<div style="display:flex; justify-content:space-between;"><span>Kembali</span><span>${formatRupiah(tx.change_amount)}</span></div>`
        : ""
    }
    <div style="margin-top:6px;">Pelanggan: ${tx.customer_name}</div>
    <div style="text-align:center; margin-top:12px; border-top:1px dashed #333; padding-top:8px;">
      Terima kasih telah berbelanja!
    </div>
  `;

  modal.classList.remove("hidden");
}

// --- RIWAYAT TRANSAKSI, VOID & RETUR (WAJIB PIN OWNER) ---

function renderTransactionHistory() {
  const tbody = document.getElementById("pos-history-tbody");
  if (!tbody) return;

  if (recentTransactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Belum ada riwayat transaksi.</td></tr>`;
    return;
  }

  tbody.innerHTML = recentTransactions
    .map((tx) => {
      const timeStr = new Date(tx.created_at_ms || 0).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
      const itemSummary = (tx.items || [])
        .map((it) => `${it.product_name} (${it.qty} ${it.unit_name})`)
        .join(", ");

      let statusBadge = `<span class="badge" style="background:var(--success);">Selesai</span>`;
      if (tx.status === "voided") {
        statusBadge = `<span class="badge" style="background:var(--danger);">VOID</span>`;
      } else if (tx.status === "returned") {
        statusBadge = `<span class="badge" style="background:var(--warning);">RETUR</span>`;
      }

      const actionButtons =
        tx.status === "completed"
          ? `
            <div style="display:flex; flex-direction:column; gap:4px;">
              <button type="button" class="btn-secondary btn-sm btn-view-struk" data-id="${tx.id}">Struk</button>
              <button type="button" class="btn-danger btn-sm btn-tx-reverse" data-id="${tx.id}" data-mode="voided">Void</button>
              <button type="button" class="btn-secondary btn-sm btn-tx-reverse" data-id="${tx.id}" data-mode="returned">Retur</button>
            </div>
          `
          : `<button type="button" class="btn-secondary btn-sm btn-view-struk" data-id="${tx.id}">Struk</button>`;

      return `
        <tr>
          <td>
            <strong>${tx.invoice_no || tx.id.slice(0, 8)}</strong><br/>
            <span class="text-muted" style="font-size:0.78rem;">${timeStr} • ${tx.cashier_name}</span>
          </td>
          <td style="font-size:0.83rem;">
            ${itemSummary}<br/>
            <span class="text-muted">${tx.payment_method} (${tx.customer_name || "Umum"})</span>
            ${tx.void_reason ? `<br/><span style="color:var(--danger);">Alasan: ${tx.void_reason}</span>` : ""}
          </td>
          <td><strong>${formatRupiah(tx.total_amount)}</strong></td>
          <td>${statusBadge}</td>
          <td>${actionButtons}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".btn-view-struk").forEach((btn) => {
    btn.onclick = () => {
      const tx = recentTransactions.find((t) => t.id === btn.dataset.id);
      if (tx) showReceiptModal(tx);
    };
  });

  tbody.querySelectorAll(".btn-tx-reverse").forEach((btn) => {
    btn.onclick = () => handleVoidOrReturn(btn.dataset.id, btn.dataset.mode);
  });
}

async function handleVoidOrReturn(txId, targetStatus) {
  const tx = recentTransactions.find((t) => t.id === txId);
  if (!tx || tx.status !== "completed") return;

  const actionLabel = targetStatus === "voided" ? "VOID (Batal Transaksi)" : "RETUR Barang";
  const reason = prompt(`Masukkan alasan ${actionLabel} untuk nota ${tx.invoice_no}:`);
  if (!reason || !reason.trim()) return;

  // Wajib otorisasi PIN Owner (berfungsi baik saat online maupun offline)
  const approved = await requestOwnerPin(
    `${actionLabel} nota ${tx.invoice_no} senilai ${formatRupiah(tx.total_amount)}. Masukkan PIN Owner:`
  );
  if (!approved) {
    alert("Tindakan dibatalkan: PIN Owner tidak valid.");
    return;
  }

  try {
    const batchWrite = writeBatch(db);
    const productRestores = {};
    const batchRestores = {};

    for (const item of tx.items || []) {
      const baseQty = Number(item.base_qty) || item.qty * item.ratio;
      productRestores[item.product_id] = (productRestores[item.product_id] || 0) + baseQty;

      // Kembalikan stok ke batch FIFO asal agar hitung HPP tetap presisi
      for (const alloc of item.fifo_allocations || []) {
        batchRestores[alloc.batch_id] = (batchRestores[alloc.batch_id] || 0) + (Number(alloc.qty_taken) || 0);
      }
    }

    for (const [bid, restoreQty] of Object.entries(batchRestores)) {
      const batchDoc = allBatchesList.find((b) => b.id === bid);
      if (batchDoc && restoreQty > 0) {
        batchWrite.update(doc(db, "batches", bid), {
          qty_remaining: (Number(batchDoc.qty_remaining) || 0) + restoreQty,
          updated_at: serverTimestamp()
        });
      }
    }

    for (const [pid, restoreBase] of Object.entries(productRestores)) {
      const prodDoc = productsList.find((p) => p.id === pid);
      if (prodDoc && restoreBase > 0) {
        batchWrite.update(doc(db, "products", pid), {
          total_stock_base: (Number(prodDoc.total_stock_base) || 0) + restoreBase,
          updated_at: serverTimestamp()
        });
      }
    }

    // Update status transaksi sesuai field yang diizinkan Firestore Rules
    batchWrite.update(doc(db, "transactions", tx.id), {
      status: targetStatus,
      void_reason: reason.trim(),
      authorized_by_pin: true,
      updated_at: serverTimestamp()
    });

    await batchWrite.commit();
    alert(`${actionLabel} berhasil diproses dan stok otomatis dikembalikan ke batch FIFO.`);
  } catch (err) {
    alert(`Gagal memproses ${actionLabel}: ` + err.message);
  }
}
