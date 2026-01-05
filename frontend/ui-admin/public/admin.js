const TOKEN_KEY = "token";

const STATUS_ENDPOINT = "/auth/me";

const USERS_ENDPOINT = "/auth/admin/users";
const USER_ROLE_ENDPOINT = (id) => `/auth/admin/users/${encodeURIComponent(id)}/role`;
const USER_DELETE_ENDPOINT = (id) => `/auth/admin/users/${encodeURIComponent(id)}`;

const ORDERS_RECENT_ENDPOINT = (limit) =>
  `/api/admin/orders/recent?limit=${encodeURIComponent(limit)}`;
const ORDER_DELETE_ENDPOINT = (id) => `/api/admin/orders/${encodeURIComponent(id)}`;

const PAYMENTS_RECENT_ENDPOINT = (limit) =>
  `/api/admin/payments/recent?limit=${encodeURIComponent(limit)}`;
const AUDIT_ENDPOINT = (limit) => `/api/admin/audit?limit=${encodeURIComponent(limit)}`;

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = "/ui-auth/login.html";
}

function parseJwt(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function isAdminFromToken(token) {
  const claims = parseJwt(token);
  if (!claims) return false;
  return String(claims.role || "").toLowerCase() === "admin";
}

function displayNameFromToken(token) {
  const c = parseJwt(token) || {};
  return c.email || c.username || c.sub || "admin";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function apiFetch(path, { method = "GET", headers = {}, body } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const h = { ...headers };

  if (token) h.Authorization = `Bearer ${token}`;
  if (body && !h["Content-Type"]) h["Content-Type"] = "application/json";

  return fetch(path, {
    method,
    headers: h,
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

async function readTextSafe(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function setErrorRow(tbody, colSpan, msg) {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${colSpan}">${escapeHtml(msg)}</td></tr>`;
}

/* ---------------- Guard ---------------- */
const token = localStorage.getItem(TOKEN_KEY);
if (!token) logout();
if (!isAdminFromToken(token)) window.location.href = "/";

/* ---------------- Header UI ---------------- */
document.getElementById("logoutBtn")?.addEventListener("click", logout);

const display = displayNameFromToken(token);
document.getElementById("name").textContent = display;
document.getElementById("role").textContent = "admin";
document.getElementById("avatar").textContent = (display?.[0] || "A").toUpperCase();

/* ---------------- Tabs / Views ---------------- */
const tabs = Array.from(document.querySelectorAll(".tab"));
const views = {
  overview: document.getElementById("view-overview"),
  users: document.getElementById("view-users"),
  orders: document.getElementById("view-orders"),
  payments: document.getElementById("view-payments"),
  audit: document.getElementById("view-audit"),
};

function setActive(viewName) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === viewName));
  Object.entries(views).forEach(([k, el]) => el?.classList.toggle("hidden", k !== viewName));

  const title = document.getElementById("pageTitle");
  if (title) {
    if (viewName === "users") title.textContent = "Admin · Users";
    else if (viewName === "orders") title.textContent = "Admin · Orders";
    else if (viewName === "payments") title.textContent = "Admin · Payments";
    else if (viewName === "audit") title.textContent = "Admin · Audit";
    else title.textContent = "Admin";
  }

  window.location.hash = viewName;
}

tabs.forEach((t) => t.addEventListener("click", () => setActive(t.dataset.view)));
document.getElementById("goUsersBtn")?.addEventListener("click", () => setActive("users"));
document.getElementById("goOrdersBtn")?.addEventListener("click", () => setActive("orders"));
document.getElementById("goAuditBtn")?.addEventListener("click", () => setActive("audit"));

const initial = (window.location.hash || "#overview").replace("#", "");
setActive(views[initial] ? initial : "overview");

/* ---------------- Overview: status ---------------- */
(async () => {
  const out = document.getElementById("statusOut");
  if (!out) return;

  try {
    const res = await apiFetch(STATUS_ENDPOINT);
    if (res.status === 401) return logout(); 
    const text = await readTextSafe(res);
    out.textContent = res.ok ? text : `Error ${res.status}\n${text}`;
  } catch {
    out.textContent = "Network error";
  }
})();

/* ---------------- Users ---------------- */
let cachedUsers = [];

function renderUsers(users) {
  const tbody = document.getElementById("usersTbody");
  if (!tbody) return;

  if (!users || users.length === 0) {
    setErrorRow(tbody, 4, "No data");
    return;
  }

  tbody.innerHTML = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.email || "")}</td>
      <td><span class="pillrole">${escapeHtml(u.role || "")}</span></td>
      <td>${escapeHtml(u.createdAt || "")}</td>
      <td class="actions">
        <button class="btn tiny ghost" data-action="toggleRole" data-id="${escapeHtml(u.id)}" data-role="${escapeHtml(u.role)}">
          ${u.role === "admin" ? "Make user" : "Make admin"}
        </button>
        <button class="btn tiny danger" data-action="deleteUser" data-id="${escapeHtml(u.id)}">
          Delete
        </button>
      </td>
    </tr>
  `).join("");
}

async function loadUsers() {
  const tbody = document.getElementById("usersTbody");
  if (tbody) setErrorRow(tbody, 4, "Loading...");

  try {
    const filter = String(document.getElementById("usersFilter")?.value || "").trim();
    const url = filter ? `${USERS_ENDPOINT}?email=${encodeURIComponent(filter)}` : USERS_ENDPOINT;

    const res = await apiFetch(url);
    const text = await readTextSafe(res);

    if (!res.ok) {
      if (tbody) setErrorRow(tbody, 4, `Error ${res.status}: ${text}`);
      return;
    }

    const data = text ? JSON.parse(text) : [];
    cachedUsers = Array.isArray(data) ? data : [];
    renderUsers(cachedUsers);
  } catch {
    if (tbody) setErrorRow(tbody, 4, "Network error");
  }
}

document.getElementById("loadUsersBtn")?.addEventListener("click", loadUsers);
document.getElementById("usersFilter")?.addEventListener("input", () => {
  const q = String(document.getElementById("usersFilter")?.value || "").toLowerCase().trim();
  if (!q) return renderUsers(cachedUsers);
  renderUsers(cachedUsers.filter((u) => String(u.email || "").toLowerCase().includes(q)));
});

document.getElementById("usersTbody")?.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;

  if (action === "toggleRole") {
    const currentRole = String(btn.dataset.role || "");
    const nextRole = currentRole === "admin" ? "user" : "admin";

    btn.disabled = true;
    try {
      const res = await apiFetch(USER_ROLE_ENDPOINT(id), { method: "PATCH", body: { role: nextRole } });
      if (!res.ok) {
        alert(`Role update failed: ${res.status}\n${await readTextSafe(res)}`);
        return;
      }
      await loadUsers();
    } finally {
      btn.disabled = false;
    }
  }

  if (action === "deleteUser") {
    if (!confirm("Delete user?")) return;

    btn.disabled = true;
    try {
      const res = await apiFetch(USER_DELETE_ENDPOINT(id), { method: "DELETE" });
      if (!res.ok) {
        alert(`Delete failed: ${res.status}\n${await readTextSafe(res)}`);
        return;
      }
      await loadUsers();
    } finally {
      btn.disabled = false;
    }
  }
});

/* ---------------- Orders ---------------- */
function renderOrders(items) {
  const tbody = document.getElementById("ordersTbody");
  if (!tbody) return;

  if (!items || items.length === 0) {
    setErrorRow(tbody, 7, "No data");
    return;
  }

  tbody.innerHTML = items.map((o) => {
    const id = String(o._id || o.id || "");
    const userEmail = o.userEmail || "";
    const userId = o.userId || "";
    const userCell = userEmail ? userEmail : userId;

    const plan = o.planName || o.planId || "";
    const amount = (o.amount ?? "");
    const created = o.createdAt || "";

    return `
      <tr>
        <td>${escapeHtml(id)}</td>
        <td>${escapeHtml(userCell)}</td>
        <td>${escapeHtml(plan)}</td>
        <td>${escapeHtml(String(amount))}</td>
        <td>${escapeHtml(created)}</td>
        <td class="actions">
          <button class="btn tiny danger" data-action="deleteOrder" data-id="${escapeHtml(id)}">Delete</button>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadOrders() {
  const tbody = document.getElementById("ordersTbody");
  if (tbody) setErrorRow(tbody, 7, "Loading...");

  const limit = Number(document.getElementById("ordersLimit")?.value || 50) || 50;

  try {
    const res = await apiFetch(ORDERS_RECENT_ENDPOINT(limit));
    const text = await readTextSafe(res);

    if (!res.ok) {
      if (tbody) setErrorRow(tbody, 7, `Error ${res.status}: ${text}`);
      return;
    }

    const data = text ? JSON.parse(text) : [];
    const items = Array.isArray(data) ? data : (data.orders || data.items || []);
    renderOrders(items);
  } catch {
    if (tbody) setErrorRow(tbody, 7, "Network error");
  }
}

document.getElementById("loadOrdersBtn")?.addEventListener("click", loadOrders);

document.getElementById("ordersTbody")?.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("button");
  if (!btn) return;

  if (btn.dataset.action !== "deleteOrder") return;
  const id = btn.dataset.id;
  if (!id) return;

  if (!confirm("Delete order?")) return;

  btn.disabled = true;
  try {
    const res = await apiFetch(ORDER_DELETE_ENDPOINT(id), { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed: ${res.status}\n${await readTextSafe(res)}`);
      return;
    }
    await loadOrders();
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- Payments ---------------- */
async function loadPayments() {
  const out = document.getElementById("paymentsOut");
  if (!out) return;

  const limit = Number(document.getElementById("paymentsLimit")?.value || 50) || 50;

  out.textContent = "Loading...";
  try {
    const res = await apiFetch(PAYMENTS_RECENT_ENDPOINT(limit));
    const text = await readTextSafe(res);

    if (!res.ok) {
      out.textContent = `Error ${res.status}\n${text}`;
      return;
    }
    const data = text ? JSON.parse(text) : [];
    out.textContent = JSON.stringify(data, null, 2);
  } catch {
    out.textContent = "Network error";
  }
}
document.getElementById("loadPaymentsBtn")?.addEventListener("click", loadPayments);

/* ---------------- Audit ---------------- */
async function loadAudit() {
  const out = document.getElementById("auditOut");
  if (!out) return;

  const limit = Number(document.getElementById("auditLimit")?.value || 25) || 25;

  out.textContent = "Loading...";
  try {
    const res = await apiFetch(AUDIT_ENDPOINT(limit));
    const text = await readTextSafe(res);

    if (!res.ok) {
      out.textContent = `Error ${res.status}\n${text}`;
      return;
    }
    const data = text ? JSON.parse(text) : {};
    out.textContent = JSON.stringify(data, null, 2);
  } catch {
    out.textContent = "Network error";
  }
}
document.getElementById("loadAuditBtn")?.addEventListener("click", loadAudit);
