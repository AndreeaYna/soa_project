const TOKEN_KEY = "token";

const GATEWAY_ME = "/auth/me";
const API_CREATE_ORDER = "/api/orders";
const WS_PATH = "/ws";

// UI refs
const wsBadge = document.getElementById("wsBadge");
const wsText = document.getElementById("wsText");
const btnLogout = document.getElementById("btnLogout");
const btnLogin = document.getElementById("btnLogin");
const btnRegister = document.getElementById("btnRegister");

const avatar = document.getElementById("avatar");
const userEmail = document.getElementById("userEmail");
const userRole = document.getElementById("userRole");

const alertBox = document.getElementById("alert");

const planSelect = document.getElementById("planSelect");
const priceLabel = document.getElementById("priceLabel");
const btnSubscribe = document.getElementById("btnSubscribe");

const subStatus = document.getElementById("subStatus");
const subPlan = document.getElementById("subPlan");
const lastOrderNice = document.getElementById("lastOrderNice");
const lastPaymentNice = document.getElementById("lastPaymentNice");
const lastOrderRaw = document.getElementById("lastOrderRaw");

const feed = document.getElementById("feed");

function setAlert(msg, type = "info") {
  if (!alertBox) return;
  alertBox.style.display = msg ? "block" : "none";
  alertBox.textContent = msg || "";
  alertBox.className = "alert " + (type === "error" ? "alert-error" : "alert-info");
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setLoggedOutUI() {
  userEmail.textContent = "Not logged in";
  userRole.textContent = "guest";
  avatar.textContent = "U";

  btnLogout.style.display = "none";
  btnLogin.style.display = "inline-flex";
  btnRegister.style.display = "inline-flex";
}

function setLoggedInUI(email, role) {
  userEmail.textContent = email;
  userRole.textContent = role || "user";
  avatar.textContent = (email?.[0] || "U").toUpperCase();

  btnLogout.style.display = "inline-flex";
  btnLogin.style.display = "none";
  btnRegister.style.display = "none";
}

async function loadMe() {
  const token = getToken();
  if (!token) {
    setLoggedOutUI();
    return null;
  }

  try {
    const res = await fetch(GATEWAY_ME, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      localStorage.removeItem(TOKEN_KEY);
      setLoggedOutUI();
      return null;
    }

    const data = await res.json();
    const me = data?.user;
    if (!me?.email) {
      setLoggedOutUI();
      return null;
    }

    setLoggedInUI(me.email, me.role);
    return me;
  } catch {
    // backend down
    setLoggedOutUI();
    return null;
  }
}

function getSelectedPlan() {
  const opt = planSelect.options[planSelect.selectedIndex];
  return {
    planId: opt.value,
    planName: opt.dataset.name || opt.value,
    amount: Number(opt.dataset.amount || 0),
  };
}

function fmtMoney(amount) {
  return `${Number(amount).toFixed(2)} EUR`;
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function addFeedItem(title, lines = []) {
  const el = document.createElement("div");
  el.className = "feedItem";

  const h = document.createElement("div");
  h.className = "feedTitle";
  h.textContent = title;

  const body = document.createElement("div");
  body.className = "feedBody";
  body.innerHTML = lines.map(l => `<div>${l}</div>`).join("");

  el.appendChild(h);
  el.appendChild(body);
  feed.prepend(el);
}

async function createOrder() {
  setAlert("");

  const me = await loadMe();
  if (!me) {
    setAlert("You must be logged in to purchase a subscription.", "error");
    return;
  }

  const token = getToken();
  const plan = getSelectedPlan();

  try {
    const res = await fetch(API_CREATE_ORDER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: plan.amount,
        planId: plan.planId,
        planName: plan.planName,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAlert(data?.error || "Order failed", "error");
      return;
    }

    lastOrderRaw.textContent = JSON.stringify(data, null, 2);
    lastOrderNice.textContent = `${plan.planName} — ${fmtMoney(plan.amount)} (order created)`;

    subStatus.textContent = "Active ✅";
    subPlan.textContent = `${plan.planName} — ${fmtMoney(plan.amount)} / month`;

    addFeedItem("Order created", [
      fmtTime(Date.now()),
      `<b>${plan.planName}</b> • ${fmtMoney(plan.amount)}`,
      `orderId: ${data._id || data.id || "?"}`,
    ]);

    setAlert("Order created. Wait for payment confirmation in the feed.", "info");
  } catch {
    setAlert("Network error", "error");
  }
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);

  ws.onopen = () => {
    wsBadge.classList.remove("err");
    wsBadge.classList.add("ok");
    wsText.textContent = "WS: connected";
  };

  ws.onclose = () => {
    wsBadge.classList.remove("ok");
    wsBadge.classList.add("err");
    wsText.textContent = "WS: disconnected";
    setTimeout(connectWS, 1000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { msg = { raw: ev.data }; }

    if (msg?.type === "payment.charged") {
      lastPaymentNice.textContent = `${fmtMoney(msg.amount)} paid (source: ${msg.source || "?"})`;
      addFeedItem("Payment confirmed ✅", [
        fmtTime(msg.ts || Date.now()),
        `${fmtMoney(msg.amount)} • order ${msg.orderId || "?"}`,
        `source: ${msg.source || "?"}`,
      ]);
      return;
    }

    addFeedItem("Event", [`<pre>${escapeHtml(JSON.stringify(msg, null, 2))}</pre>`]);
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// events
planSelect?.addEventListener("change", () => {
  const plan = getSelectedPlan();
  priceLabel.textContent = fmtMoney(plan.amount);
});

btnSubscribe?.addEventListener("click", createOrder);

btnLogout?.addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  setLoggedOutUI();
  setAlert("Logged out.", "info");
});

(async function init() {
  const plan = getSelectedPlan();
  priceLabel.textContent = fmtMoney(plan.amount);

  await loadMe();
  connectWS();
})();
