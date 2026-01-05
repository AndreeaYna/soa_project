const TOKEN_KEY = "token";

const form = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const errorEl = document.getElementById("errorBox");

function setError(msg) {
  if (!errorEl) return;
  errorEl.style.display = msg ? "block" : "none";
  errorEl.textContent = msg || "";
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

  const roleValue =
    claims.role ||
    claims.roles ||
    claims.authorities ||
    claims.scope;

  if (Array.isArray(roleValue)) {
    return roleValue.some((r) => String(r).toLowerCase().includes("admin"));
  }

  return String(roleValue || "").toLowerCase().includes("admin");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const email = emailEl.value.trim();
  const password = passEl.value;

  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data?.error || "Login failed");
      return;
    }

    const token = data?.token;
    if (!token) {
      setError("Login failed: missing token");
      return;
    }

    localStorage.setItem(TOKEN_KEY, token);

    const isAdmin = isAdminFromToken(token);
    window.location.href = isAdmin ? "/ui-admin/admin.html" : "/";
  } catch {
    setError("Network error");
  }
});
