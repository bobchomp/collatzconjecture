/**
 * Gates the whole app behind Supabase Auth. There is no self sign-up --
 * accounts are created manually in the Supabase dashboard -- so this
 * only handles sign-in (password) and sign-out.
 *
 * The client-side gate is a UX/convenience boundary, not the real
 * security boundary: anyone can read this file's source, same as any
 * static site. The actual protection is server-side: the
 * server_configs table's Row Level Security (scoped to auth.uid()),
 * and the scan server's own separate password. Signing in just
 * decides whether this browser gets to *see* the app and sync its
 * saved server config -- it doesn't grant any access that RLS
 * wouldn't already enforce on its own.
 */
(function () {
  "use strict";

  const SUPABASE_URL = "https://dhbldecipkxihnvmuajl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1bCeqAsuc9Ml79m4U1TleA_M5Vn5yWr";

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  window.CollatzAuth = { client };

  const authGate = document.getElementById("authGate");
  const pageContent = document.getElementById("pageContent");
  const authForm = document.getElementById("authForm");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authStatus = document.getElementById("authStatus");
  const authSignInBtn = document.getElementById("authSignInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  function setStatus(message, isError) {
    authStatus.style.color = isError ? "var(--critical)" : "var(--good-text)";
    authStatus.textContent = message;
  }

  async function showApp() {
    authGate.hidden = true;
    pageContent.hidden = false;
    authPassword.value = "";
    if (window.CollatzApp && window.CollatzApp.onSignedIn) {
      await window.CollatzApp.onSignedIn();
    }
  }

  function showGate() {
    pageContent.hidden = true;
    authGate.hidden = false;
    if (window.CollatzApp && window.CollatzApp.onSignedOut) {
      window.CollatzApp.onSignedOut();
    }
  }

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("", false);
    authSignInBtn.disabled = true;
    authSignInBtn.textContent = "Signing in…";
    const { error } = await client.auth.signInWithPassword({
      email: authEmail.value.trim(),
      password: authPassword.value,
    });
    authSignInBtn.disabled = false;
    authSignInBtn.textContent = "Sign in";
    if (error) setStatus(error.message, true);
  });

  signOutBtn.addEventListener("click", () => client.auth.signOut());

  client.auth.onAuthStateChange((_event, session) => {
    if (session) showApp();
    else showGate();
  });

  client.auth.getSession().then(({ data }) => {
    if (data.session) showApp();
    else showGate();
  });
})();
