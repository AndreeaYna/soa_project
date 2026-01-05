const form = document.getElementById("registerForm");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const errorEl = document.getElementById("errorBox");

function setError(msg) {
  if (!errorEl) return;
  errorEl.style.display = msg ? "block" : "none";
  errorEl.textContent = msg || "";
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const email = emailEl.value.trim();
  const password = passEl.value;

  try {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data?.error || "Register failed");
      return;
    }


    window.location.href = "/ui-auth/login.html";
  } catch {
    setError("Network error");
  }
});
