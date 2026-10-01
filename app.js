/* =====================================================================
   Weihnachtswunschliste – App
   Aufbau:
     1. Hilfsfunktionen
     2. Datenzugriff: "supabaseApi" (echt) oder "demoApi" (zum Ausprobieren)
     3. Zustand + Laden
     4. Ansichten: Start, Bereich/Alle, Korb
     5. Admin: Login, Bearbeiten
     6. Start
   ===================================================================== */

const CONFIG = window.WUNSCHLISTE_CONFIG || {};
const $ = id => document.getElementById(id);

/* ---------- 1. Hilfsfunktionen ---------- */

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, z => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[z]));
}
// Nur echte Web-Links zulassen (kein "javascript:" o. Ä.)
function sichererLink(url) {
  try { const u = new URL(url); return (u.protocol === "https:" || u.protocol === "http:") ? u.href : ""; }
  catch { return ""; }
}
function sicheresBild(url) {
  if (!url) return "";
  if (url.startsWith("data:image/")) return url;
  return sichererLink(url);
}
function speicherLesen(key) { try { return localStorage.getItem(key); } catch { return null; } }
function speicherSchreiben(key, wert) { try { localStorage.setItem(key, wert); } catch { /* egal */ } }

function euro(preis) {
  if (preis === null || preis === undefined || preis === "") return "";
  return Number(preis).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
function sterneHtml(n) {
  n = Number(n) || 0;
  return `<span class="sterne" aria-label="${n} von 5 Sternen" title="Priorität: ${n} von 5">${"★".repeat(n)}<span class="aus">${"★".repeat(5 - n)}</span></span>`;
}
function anzahlText(n) { return n === 1 ? "1 Wunsch" : n + " Wünsche"; }

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Persönlicher Code dieses Browsers – damit nur du deine Reservierungen wieder freigeben kannst
function besucherToken() {
  let t = speicherLesen("wunschliste-token");
  if (!t) {
    t = (crypto.randomUUID ? crypto.randomUUID() + crypto.randomUUID() : String(Math.random()).slice(2) + Date.now() + String(Math.random()).slice(2)).replace(/-/g, "");
    speicherSchreiben("wunschliste-token", t);
  }
  return t;
}

const GESCHENK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>';
const STIFT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';

/* ---------- 2. Datenzugriff ---------- */

const FEHLERTEXTE = {
  VERGEBEN: "Das hat gerade schon jemand anderes in den Korb gelegt.",
  NICHT_GEFUNDEN: "Diesen Wunsch gibt es nicht mehr.",
  ZU_VIELE: "Du hast schon sehr viele Sachen im Korb.",
  UNGUELTIG: "Da ist etwas schiefgelaufen. Lade die Seite bitte neu."
};
function fehlerText(err) {
  const m = String(err?.message || err || "");
  for (const k in FEHLERTEXTE) if (m.includes(k)) return FEHLERTEXTE[k];
  if (m.includes("Invalid login")) return "E-Mail oder Passwort stimmt nicht.";
  if (m.includes("Failed to fetch")) return "Keine Verbindung. Bist du online?";
  return "Fehler: " + m;
}

function supabaseApi() {
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  const pruefe = ({ data, error }) => { if (error) throw error; return data; };
  return {
    demo: false,
    async laden() {
      const [kategorien, wuensche] = await Promise.all([
        sb.from("kategorien").select("*").order("reihenfolge").order("erstellt").then(pruefe),
        sb.from("wuensche").select("*").order("reihenfolge").order("erstellt").then(pruefe)
      ]);
      return { kategorien, wuensche };
    },
    async belegung() { return pruefe(await sb.rpc("belegung")); },
    async meine(token) { return pruefe(await sb.rpc("meine_reservierungen", { p_token: token })); },
    async reservieren(wunschId, token, notiz) { return pruefe(await sb.rpc("reservieren", { p_wunsch: wunschId, p_token: token, p_notiz: notiz || "" })); },
    async freigeben(id, token) { return pruefe(await sb.rpc("freigeben", { p_id: id, p_token: token })); },
    async istAdmin() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return false;
      return !!pruefe(await sb.rpc("ist_admin"));
    },
    async login(email, pw) {
      pruefe(await sb.auth.signInWithPassword({ email, password: pw }));
      if (!pruefe(await sb.rpc("ist_admin"))) { await sb.auth.signOut(); throw new Error("Dieses Konto ist kein Admin."); }
    },
    async logout() { await sb.auth.signOut(); },
    async speichereWunsch(w) {
      const { id, ...felder } = w;
      if (id) return pruefe(await sb.from("wuensche").update(felder).eq("id", id).select().single());
      return pruefe(await sb.from("wuensche").insert(felder).select().single());
    },
    async loescheWunsch(id) { pruefe(await sb.from("wuensche").delete().eq("id", id)); },
    async speichereKategorie(k) {
      const { id, ...felder } = k;
      if (id) return pruefe(await sb.from("kategorien").update(felder).eq("id", id).select().single());
      return pruefe(await sb.from("kategorien").insert(felder).select().single());
    },
    async loescheKategorie(id) { pruefe(await sb.from("kategorien").delete().eq("id", id)); },
    async bildHochladen(datei) {
      const endung = (datei.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const pfad = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${endung}`;
      pruefe(await sb.storage.from("bilder").upload(pfad, datei, { contentType: datei.type, upsert: false }));
      return sb.storage.from("bilder").getPublicUrl(pfad).data.publicUrl;
    }
  };
}

function demoApi() {
  const d = JSON.parse(JSON.stringify(window.DEMO_DATEN || { kategorien: [], wuensche: [] }));
  let admin = false;
  // Damit man sieht, wie "vergeben" aussieht: zwei Reservierungen von "jemand anderem"
  const res = [];
  const bvb = d.wuensche.find(w => w.name.startsWith("BVB"));
  const lego = d.wuensche.find(w => w.name.startsWith("Lego Speed"));
  if (bvb) res.push({ id: "demo-a", wunsch_id: bvb.id, token: "jemand-anderes", notiz: "" });
  if (lego) res.push({ id: "demo-b", wunsch_id: lego.id, token: "jemand-anderes", notiz: "76916 Porsche 963" });
  const neueId = () => "d" + Math.random().toString(36).slice(2);
  const warte = () => new Promise(r => setTimeout(r, 120));
  return {
    demo: true,
    async laden() { await warte(); return JSON.parse(JSON.stringify(d)); },
    async belegung() {
      if (admin) return [];
      const m = {};
      res.forEach(r => { (m[r.wunsch_id] ||= { wunsch_id: r.wunsch_id, anzahl: 0, notizen: [] }); m[r.wunsch_id].anzahl++; if (r.notiz) m[r.wunsch_id].notizen.push(r.notiz); });
      return Object.values(m);
    },
    async meine(token) { return res.filter(r => r.token === token).map(({ id, wunsch_id, notiz }) => ({ id, wunsch_id, notiz })); },
    async reservieren(wunschId, token, notiz) {
      await warte();
      const w = d.wuensche.find(x => x.id === wunschId);
      if (!w) throw new Error("NICHT_GEFUNDEN");
      if (!w.sammel && res.some(r => r.wunsch_id === wunschId)) throw new Error("VERGEBEN");
      const id = neueId(); res.push({ id, wunsch_id: wunschId, token, notiz: notiz || "" }); return id;
    },
    async freigeben(id, token) { const i = res.findIndex(r => r.id === id && r.token === token); if (i >= 0) res.splice(i, 1); return i >= 0; },
    async istAdmin() { return admin; },
    async login() { await warte(); admin = true; },
    async logout() { admin = false; },
    async speichereWunsch(w) {
      if (w.id) { Object.assign(d.wuensche.find(x => x.id === w.id), w); return w; }
      const neu = { ...w, id: neueId(), reihenfolge: 999 }; d.wuensche.push(neu); return neu;
    },
    async loescheWunsch(id) { d.wuensche = d.wuensche.filter(w => w.id !== id); },
    async speichereKategorie(k) {
      if (k.id) { Object.assign(d.kategorien.find(x => x.id === k.id), k); return k; }
      const neu = { ...k, id: neueId() }; d.kategorien.push(neu); return neu;
    },
    async loescheKategorie(id) { d.kategorien = d.kategorien.filter(k => k.id !== id); d.wuensche = d.wuensche.filter(w => w.kategorie_id !== id); },
    async bildHochladen(datei) {
      return new Promise((ok, fehler) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fehler; r.readAsDataURL(datei); });
    }
  };
}

const api = (CONFIG.supabaseUrl && CONFIG.supabaseKey && window.supabase) ? supabaseApi() : demoApi();
const TOKEN = besucherToken();

/* ---------- 3. Zustand ---------- */

const zustand = {
  kategorien: [],
  wuensche: [],
  belegung: {},      // wunsch_id -> { anzahl, notizen }
  meine: [],         // [{ id, wunsch_id, notiz }]
  admin: false,
  geladen: false,
  fehler: "",
  filter: { prio: "0", preis: "alle", sortierung: "prio" },
  offenSammel: null  // Wunsch-ID, bei dem das Notizfeld offen ist
};

async function belegungLaden() {
  if (zustand.admin) { zustand.belegung = {}; }
  else {
    const b = await api.belegung();
    zustand.belegung = Object.fromEntries(b.map(x => [x.wunsch_id, x]));
  }
  zustand.meine = await api.meine(TOKEN);
  // Reservierungen zu gelöschten Wünschen ignorieren
  const ids = new Set(zustand.wuensche.map(w => w.id));
  zustand.meine = zustand.meine.filter(m => ids.has(m.wunsch_id));
  korbZahl();
}

async function allesLaden() {
  try {
    zustand.admin = await api.istAdmin();
    const { kategorien, wuensche } = await api.laden();
    zustand.kategorien = kategorien;
    zustand.wuensche = wuensche;
    await belegungLaden();
    zustand.geladen = true; zustand.fehler = "";
  } catch (e) {
    zustand.fehler = fehlerText(e);
  }
  adminLeiste();
  zeichnen();
}

function korbZahl() {
  const n = zustand.meine.length;
  $("korb-zahl").textContent = n;
  $("korb-zahl").hidden = n === 0;
}

/* ---------- 4. Ansichten ---------- */

const inhalt = $("inhalt");

function wuenscheVon(katId) { return zustand.wuensche.filter(w => w.kategorie_id === katId); }
function kategorieVon(id) { return zustand.kategorien.find(k => k.id === id); }
function meineZu(wunschId) { return zustand.meine.filter(m => m.wunsch_id === wunschId); }

function zeichnen() {
  const ziel = decodeURIComponent(location.hash.slice(1));
  const titel = CONFIG.titel || "Weihnachtswunschliste";
  document.querySelectorAll("#korb-knopf").forEach(a => a.setAttribute("aria-current", ziel === "korb" ? "page" : "false"));

  if (zustand.fehler) {
    inhalt.innerHTML = `<div class="leer"><p>${esc(zustand.fehler)}</p><button class="knopf knopf-leise" type="button" data-aktion="neu-laden">Nochmal versuchen</button></div>`;
    return;
  }
  if (!zustand.geladen) { inhalt.innerHTML = `<p class="leer">Wünsche werden geladen …</p>`; return; }

  if (ziel === "korb") { document.title = "Mein Korb · " + titel; return zeigeKorb(); }
  if (ziel === "alle") { document.title = "Alle Wünsche · " + titel; return zeigeListe(null); }
  const kat = kategorieVon(ziel);
  if (kat) { document.title = kat.titel + " · " + titel; return zeigeListe(kat); }
  document.title = titel;
  zeigeStart();
}

function zeigeStart() {
  const admin = zustand.admin;
  const kacheln = zustand.kategorien.map(k => {
    const n = wuenscheVon(k.id).length;
    return `
      <div class="anhaenger-box">
        <a class="anhaenger" href="#${esc(k.id)}">
          <span class="anhaenger-titel">${esc(k.titel)}</span>
          <span class="anhaenger-unter">${esc(k.untertitel)}</span>
          <span class="anhaenger-fuss"><span class="anhaenger-zahl">${anzahlText(n)}</span>${sterneHtml(k.prioritaet)}</span>
        </a>
        ${admin ? `<button class="knopf knopf-leise knopf-rund stift" type="button" data-aktion="kat-bearbeiten" data-id="${esc(k.id)}" aria-label="${esc(k.titel)} bearbeiten">${STIFT}</button>` : ""}
      </div>`;
  }).join("");

  inhalt.innerHTML = `
    <div class="ansicht">
      <nav class="raster" aria-label="Bereiche">
        ${kacheln}
        <div class="anhaenger-box">
          <a class="anhaenger anhaenger-alle" href="#alle">
            <span class="anhaenger-titel">Alle Wünsche</span>
            <span class="anhaenger-unter">Alles auf einen Blick, mit Filter</span>
            <span class="anhaenger-fuss"><span class="anhaenger-zahl">${anzahlText(zustand.wuensche.length)}</span></span>
          </a>
        </div>
        ${admin ? `<button class="anhaenger anhaenger-neu" type="button" data-aktion="kat-neu">+ Bereich hinzufügen</button>` : ""}
      </nav>
    </div>`;
}

function filtern(liste) {
  const f = zustand.filter;
  const minPrio = Number(f.prio);
  let ohnePreis = 0;
  let ergebnis = liste.filter(w => w.prioritaet >= minPrio);
  if (f.preis !== "alle") {
    const [von, bis] = f.preis.split("-").map(Number);
    ergebnis = ergebnis.filter(w => {
      if (w.preis === null || w.preis === undefined) { ohnePreis++; return false; }
      const p = Number(w.preis);
      return p >= von && (isNaN(bis) || p < bis);
    });
  }
  const preisWert = w => (w.preis === null || w.preis === undefined) ? null : Number(w.preis);
  const sortierer = {
    prio: (a, b) => b.prioritaet - a.prioritaet || (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0),
    "preis-auf": (a, b) => (preisWert(a) ?? Infinity) - (preisWert(b) ?? Infinity),
    "preis-ab": (a, b) => (preisWert(b) ?? -Infinity) - (preisWert(a) ?? -Infinity)
  }[f.sortierung];
  ergebnis.sort(sortierer);
  // Vergebene Sachen nach unten (nur für Besucher)
  if (!zustand.admin) {
    const istWeg = w => !w.sammel && zustand.belegung[w.id] && meineZu(w.id).length === 0;
    ergebnis.sort((a, b) => istWeg(a) - istWeg(b));
  }
  return { ergebnis, ohnePreis };
}

function zeigeListe(kat) {
  const f = zustand.filter;
  const basis = kat ? wuenscheVon(kat.id) : zustand.wuensche;
  const { ergebnis, ohnePreis } = filtern([...basis]);

  const tabs = [`<a class="tab" href="#alle" ${!kat ? 'aria-current="page"' : ""}>Alle</a>`]
    .concat(zustand.kategorien.map(k => `<a class="tab" href="#${esc(k.id)}" ${kat && k.id === kat.id ? 'aria-current="page"' : ""}>${esc(k.titel)}</a>`)).join("");

  const opt = (wert, text, aktuell) => `<option value="${wert}" ${wert === aktuell ? "selected" : ""}>${text}</option>`;

  let info = `${ergebnis.length} von ${basis.length}`;
  if (ohnePreis) info += ` · ${ohnePreis} ohne Preisangabe ausgeblendet`;

  const leerText = basis.length === 0
    ? (zustand.admin ? "Hier ist noch nichts. Leg oben den ersten Wunsch an." : "Hier stehen noch keine Wünsche.")
    : "Mit diesem Filter passt gerade nichts. Stell den Filter etwas weiter ein.";

  inhalt.innerHTML = `
    <div class="ansicht">
      <a class="zurueck" href="#">← Alle Bereiche</a>
      <div class="kat-kopf">
        <div>
          <h2>${kat ? esc(kat.titel) : "Alle Wünsche"}</h2>
          <p>${kat ? esc(kat.untertitel) + " · " : ""}${anzahlText(basis.length)}</p>
        </div>
        ${zustand.admin ? `<div class="aktion">
          ${kat ? `<button class="knopf knopf-leise" type="button" data-aktion="kat-bearbeiten" data-id="${esc(kat.id)}">Bereich bearbeiten</button>` : ""}
          <button class="knopf knopf-voll" type="button" data-aktion="wunsch-neu" data-kat="${kat ? esc(kat.id) : ""}">+ Wunsch hinzufügen</button>
        </div>` : ""}
      </div>
      <nav class="tabs" aria-label="Bereiche">${tabs}</nav>
      <div class="filter" role="group" aria-label="Filter">
        <div class="filter-feld">
          <label for="f-prio">Priorität</label>
          <select id="f-prio" data-filter="prio">
            ${opt("0", "Alle", f.prio)}${opt("5", "★★★★★ nur", f.prio)}${opt("4", "ab ★★★★", f.prio)}${opt("3", "ab ★★★", f.prio)}${opt("2", "ab ★★", f.prio)}
          </select>
        </div>
        <div class="filter-feld">
          <label for="f-preis">Preis</label>
          <select id="f-preis" data-filter="preis">
            ${opt("alle", "Alle", f.preis)}${opt("0-25", "bis 25 €", f.preis)}${opt("25-50", "25 – 50 €", f.preis)}${opt("50-100", "50 – 100 €", f.preis)}${opt("100-", "über 100 €", f.preis)}
          </select>
        </div>
        <div class="filter-feld">
          <label for="f-sort">Sortieren</label>
          <select id="f-sort" data-filter="sortierung">
            ${opt("prio", "Wichtigste zuerst", f.sortierung)}${opt("preis-auf", "Preis aufsteigend", f.sortierung)}${opt("preis-ab", "Preis absteigend", f.sortierung)}
          </select>
        </div>
        <span class="filter-info">${info}</span>
      </div>
      ${ergebnis.length ? `<ul class="liste">${ergebnis.map(w => wunschHtml(w, !kat)).join("")}</ul>` : `<p class="leer">${leerText}</p>`}
    </div>`;
}

function linksHtml(links) {
  const gueltig = (links || []).map(sichererLink).filter(Boolean);
  if (gueltig.length === 0) return "";
  if (gueltig.length === 1) return `<a class="link" href="${esc(gueltig[0])}" target="_blank" rel="noopener">Zum Produkt ↗</a>`;
  return `<span class="links">${gueltig.map((l, i) => `<a class="link link-klein" href="${esc(l)}" target="_blank" rel="noopener" title="Beispiel ${i + 1}">${i + 1} ↗</a>`).join("")}</span>`;
}

function wunschHtml(w, mitBereich) {
  const admin = zustand.admin;
  const beleg = zustand.belegung[w.id];
  const meine = meineZu(w.id);
  const istMeins = meine.length > 0;
  const vergeben = !admin && !w.sammel && beleg && !istMeins;
  const bild = sicheresBild(w.bild_url);
  const kat = mitBereich ? kategorieVon(w.kategorie_id) : null;

  let marken = "";
  if (w.sammel) marken += `<span class="marke marke-sammel" title="Davon kann man mehrere verschiedene besorgen">Mehrfach möglich</span>`;
  if (vergeben) marken += `<span class="marke marke-vergeben">Schon vergeben</span>`;
  if (istMeins && !admin) marken += `<span class="marke marke-meins">In deinem Korb</span>`;

  let aktion = "";
  let extra = "";
  if (admin) {
    aktion = `<button class="knopf knopf-leise" type="button" data-aktion="wunsch-bearbeiten" data-id="${esc(w.id)}">Bearbeiten</button>`;
  } else if (w.sammel) {
    const andere = (beleg?.notizen || []);
    if (andere.length) extra += `<div class="notizen">Schon besorgt: ${andere.map(n => `<b>${esc(n)}</b>`).join(", ")}</div>`;
    else if (beleg?.anzahl) extra += `<div class="notizen">Davon wurde schon ${beleg.anzahl === 1 ? "einmal" : beleg.anzahl + "-mal"} etwas besorgt.</div>`;
    if (zustand.offenSammel === w.id) {
      extra += `<form class="sammel-form" data-sammel="${esc(w.id)}">
          <input id="notiz-${esc(w.id)}" name="notiz" maxlength="200" placeholder="Was genau? z. B. Setnummer oder Name" aria-label="Was genau besorgst du?" required>
          <button class="knopf knopf-voll" type="submit">In den Korb</button>
          <button class="knopf knopf-leise" type="button" data-aktion="sammel-zu">Abbrechen</button>
        </form>`;
    } else {
      aktion = `<button class="knopf knopf-voll" type="button" data-aktion="sammel-auf" data-id="${esc(w.id)}">Ich besorge etwas davon</button>`;
    }
  } else if (istMeins) {
    aktion = `<button class="knopf knopf-leise" type="button" data-aktion="freigeben" data-id="${esc(meine[0].id)}">Aus Korb entfernen</button>`;
  } else if (!vergeben) {
    aktion = `<button class="knopf knopf-voll" type="button" data-aktion="reservieren" data-id="${esc(w.id)}">In den Korb</button>`;
  }

  return `
    <li class="wunsch ${vergeben ? "vergeben" : ""} ${istMeins && !admin ? "meins" : ""}">
      <div class="bild">${bild ? `<img src="${esc(bild)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : GESCHENK}</div>
      <div class="wunsch-text">
        <div class="wunsch-zeile"><h3>${esc(w.name)}</h3>${sterneHtml(w.prioritaet)}</div>
        ${marken || kat ? `<div class="wunsch-zeile">${kat ? `<span class="kat-name">${esc(kat.titel)}</span>` : ""}${marken}</div>` : ""}
        ${w.beschreibung ? `<p>${esc(w.beschreibung)}</p>` : ""}
        ${extra}
        <div class="wunsch-fuss">
          ${w.preis !== null && w.preis !== undefined ? `<span class="preis">${euro(w.preis)}</span>` : ""}
          ${linksHtml(w.links)}
          ${aktion ? `<span class="aktion">${aktion}</span>` : ""}
        </div>
      </div>
    </li>`;
}

function zeigeKorb() {
  if (zustand.admin) {
    inhalt.innerHTML = `<div class="ansicht"><a class="zurueck" href="#">← Alle Bereiche</a><p class="leer">Im Bearbeitungsmodus gibt es keinen Korb – sonst wäre die Überraschung weg.</p></div>`;
    return;
  }
  const eintraege = zustand.meine.map(m => {
    const w = zustand.wuensche.find(x => x.id === m.wunsch_id);
    if (!w) return "";
    const kat = kategorieVon(w.kategorie_id);
    const bild = sicheresBild(w.bild_url);
    return `
      <li class="wunsch meins">
        <div class="bild">${bild ? `<img src="${esc(bild)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : GESCHENK}</div>
        <div class="wunsch-text">
          <div class="wunsch-zeile"><h3>${esc(w.name)}</h3></div>
          <div class="wunsch-zeile"><span class="kat-name">${esc(kat?.titel || "")}</span></div>
          ${w.beschreibung ? `<p>${esc(w.beschreibung)}</p>` : ""}
          ${m.notiz ? `<div class="notizen">Deine Auswahl: <b>${esc(m.notiz)}</b></div>` : ""}
          <div class="wunsch-fuss">
            ${w.preis !== null && w.preis !== undefined ? `<span class="preis">${euro(w.preis)}</span>` : ""}
            ${linksHtml(w.links)}
            <span class="aktion"><button class="knopf knopf-leise" type="button" data-aktion="freigeben" data-id="${esc(m.id)}">Wieder freigeben</button></span>
          </div>
        </div>
      </li>`;
  }).join("");

  inhalt.innerHTML = `
    <div class="ansicht">
      <a class="zurueck" href="#">← Alle Bereiche</a>
      <div class="kat-kopf"><div><h2>Mein Korb</h2><p>${anzahlText(zustand.meine.length)} für ${esc(CONFIG.name || "")}</p></div></div>
      <p class="korb-info">Was hier liegt, ist für alle anderen als „vergeben“ markiert. ${esc(CONFIG.name || "Der Beschenkte")} sieht davon nichts. Dein Korb ist in diesem Browser gespeichert – öffne die Seite also am besten immer auf demselben Gerät.</p>
      ${eintraege ? `<ul class="liste">${eintraege}</ul>` : `<p class="leer">Dein Korb ist noch leer. Such dir in einem Bereich etwas aus und klick auf „In den Korb“.</p>`}
    </div>`;
}

/* ---------- Klicks & Eingaben in der Liste ---------- */

inhalt.addEventListener("click", async e => {
  const knopf = e.target.closest("[data-aktion]");
  if (!knopf) return;
  const id = knopf.dataset.id;
  switch (knopf.dataset.aktion) {
    case "neu-laden": zustand.fehler = ""; zeichnen(); return allesLaden();
    case "reservieren": return reservieren(knopf, id, "");
    case "freigeben": return freigeben(knopf, id);
    case "sammel-auf": zustand.offenSammel = id; zeichnen(); $("notiz-" + id)?.focus(); return;
    case "sammel-zu": zustand.offenSammel = null; return zeichnen();
    case "wunsch-neu": return wunschDialog(null, knopf.dataset.kat);
    case "wunsch-bearbeiten": return wunschDialog(zustand.wuensche.find(w => w.id === id));
    case "kat-neu": return katDialog(null);
    case "kat-bearbeiten": e.preventDefault(); return katDialog(kategorieVon(id));
  }
});

inhalt.addEventListener("submit", e => {
  const form = e.target.closest("[data-sammel]");
  if (!form) return;
  e.preventDefault();
  const notiz = form.notiz.value.trim();
  if (!notiz) return;
  reservieren(form.querySelector("button[type=submit]"), form.dataset.sammel, notiz);
});

inhalt.addEventListener("change", e => {
  const feld = e.target.dataset.filter;
  if (!feld) return;
  zustand.filter[feld] = e.target.value;
  zeichnen();
  $(e.target.id)?.focus();
});

async function reservieren(knopf, wunschId, notiz) {
  knopf.disabled = true;
  try {
    await api.reservieren(wunschId, TOKEN, notiz);
    zustand.offenSammel = null;
    toast("Liegt in deinem Korb.");
  } catch (err) {
    toast(fehlerText(err));
  }
  await belegungLaden().catch(() => {});
  zeichnen();
}

async function freigeben(knopf, resId) {
  knopf.disabled = true;
  try { await api.freigeben(resId, TOKEN); toast("Wieder freigegeben."); }
  catch (err) { toast(fehlerText(err)); }
  await belegungLaden().catch(() => {});
  zeichnen();
}

/* ---------- 5. Admin ---------- */

function adminLeiste() {
  $("admin-knopf").textContent = zustand.admin ? "Abmelden" : "Admin";
  $("admin-hinweis").hidden = !zustand.admin;
  $("korb-knopf").hidden = zustand.admin;
}

$("admin-knopf").addEventListener("click", async () => {
  if (zustand.admin) {
    await api.logout();
    zustand.admin = false;
    toast("Abgemeldet.");
    await belegungLaden().catch(() => {});
    adminLeiste(); zeichnen();
    return;
  }
  $("login-fehler").hidden = true;
  $("login-form").reset();
  if (api.demo) $("login-email").placeholder = "Demo: irgendwas eingeben";
  $("login-dialog").showModal();
});

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const knopf = e.submitter || $("login-form").querySelector("[type=submit]");
  knopf.disabled = true;
  try {
    await api.login($("login-email").value.trim(), $("login-pw").value);
    zustand.admin = true;
    $("login-dialog").close();
    toast("Angemeldet. Viel Spaß beim Bearbeiten!");
    zustand.belegung = {};
    adminLeiste(); zeichnen();
  } catch (err) {
    $("login-fehler").textContent = fehlerText(err);
    $("login-fehler").hidden = false;
  }
  knopf.disabled = false;
});

document.querySelectorAll("[data-schliessen]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

// Sterne-Auswahl (1–5)
function sterneWahl(container, wert) {
  container.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" role="radio" aria-checked="${n === wert}" aria-label="${n} Sterne" data-wert="${n}" class="${n <= wert ? "an" : ""}">★</button>`).join("");
  container.dataset.wert = wert;
}
["w-sterne", "k-sterne"].forEach(id => $(id).addEventListener("click", e => {
  const b = e.target.closest("[data-wert]");
  if (b) sterneWahl($(id), Number(b.dataset.wert));
}));

// ----- Wunsch bearbeiten -----
let bearbeiteterWunsch = null;
let loeschenBestaetigen = false;

function bildVorschau() {
  const url = sicheresBild($("w-bild").value.trim());
  $("w-bild-vorschau").innerHTML = url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : GESCHENK;
}

function wunschDialog(w, katId) {
  bearbeiteterWunsch = w || null;
  loeschenBestaetigen = false;
  $("wunsch-dialog-titel").textContent = w ? "Wunsch bearbeiten" : "Neuer Wunsch";
  $("w-kategorie").innerHTML = zustand.kategorien.map(k => `<option value="${esc(k.id)}">${esc(k.titel)}</option>`).join("");
  if (!zustand.kategorien.length) { toast("Leg zuerst einen Bereich an."); return; }
  $("w-name").value = w?.name || "";
  $("w-kategorie").value = w?.kategorie_id || katId || zustand.kategorien[0].id;
  $("w-beschreibung").value = w?.beschreibung || "";
  $("w-preis").value = (w?.preis ?? "") === "" ? "" : Number(w.preis);
  $("w-links").value = (w?.links || []).join("\n");
  $("w-bild").value = w?.bild_url || "";
  $("w-sammel").checked = !!w?.sammel;
  sterneWahl($("w-sterne"), w?.prioritaet || 3);
  $("w-loeschen").hidden = !w;
  $("w-loeschen").textContent = "Löschen";
  $("wunsch-fehler").hidden = true;
  bildVorschau();
  $("wunsch-dialog").showModal();
}

$("w-bild").addEventListener("input", bildVorschau);

$("w-bild-datei").addEventListener("change", async e => {
  const datei = e.target.files[0];
  e.target.value = "";
  if (!datei) return;
  if (datei.size > 5 * 1024 * 1024) { toast("Das Bild ist größer als 5 MB. Nimm bitte ein kleineres."); return; }
  toast("Bild wird hochgeladen …");
  try {
    $("w-bild").value = await api.bildHochladen(datei);
    bildVorschau();
    toast("Bild hochgeladen.");
  } catch (err) { toast(fehlerText(err)); }
});

$("wunsch-form").addEventListener("submit", async e => {
  e.preventDefault();
  const preisText = $("w-preis").value.trim();
  const links = $("w-links").value.split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean);
  const kaputt = links.filter(l => !sichererLink(l));
  if (kaputt.length) {
    $("wunsch-fehler").textContent = "Dieser Link ist ungültig (muss mit https:// anfangen): " + kaputt[0];
    $("wunsch-fehler").hidden = false; return;
  }
  const daten = {
    name: $("w-name").value.trim(),
    kategorie_id: $("w-kategorie").value,
    beschreibung: $("w-beschreibung").value.trim(),
    preis: preisText === "" ? null : Number(preisText),
    links,
    bild_url: $("w-bild").value.trim(),
    prioritaet: Number($("w-sterne").dataset.wert) || 3,
    sammel: $("w-sammel").checked
  };
  if (bearbeiteterWunsch) daten.id = bearbeiteterWunsch.id;
  else daten.reihenfolge = wuenscheVon(daten.kategorie_id).length;
  const knopf = e.submitter; if (knopf) knopf.disabled = true;
  try {
    const gespeichert = await api.speichereWunsch(daten);
    if (bearbeiteterWunsch) Object.assign(bearbeiteterWunsch, gespeichert);
    else zustand.wuensche.push(gespeichert);
    $("wunsch-dialog").close();
    toast("Gespeichert.");
    zeichnen();
  } catch (err) {
    $("wunsch-fehler").textContent = fehlerText(err); $("wunsch-fehler").hidden = false;
  }
  if (knopf) knopf.disabled = false;
});

$("w-loeschen").addEventListener("click", async () => {
  if (!bearbeiteterWunsch) return;
  if (!loeschenBestaetigen) { loeschenBestaetigen = true; $("w-loeschen").textContent = "Wirklich löschen?"; return; }
  try {
    await api.loescheWunsch(bearbeiteterWunsch.id);
    zustand.wuensche = zustand.wuensche.filter(w => w.id !== bearbeiteterWunsch.id);
    $("wunsch-dialog").close(); toast("Gelöscht."); zeichnen();
  } catch (err) { $("wunsch-fehler").textContent = fehlerText(err); $("wunsch-fehler").hidden = false; }
});

// ----- Bereich bearbeiten -----
let bearbeiteteKat = null;
let katLoeschenBestaetigen = false;

function katDialog(k) {
  bearbeiteteKat = k || null;
  katLoeschenBestaetigen = false;
  $("kat-dialog-titel").textContent = k ? "Bereich bearbeiten" : "Neuer Bereich";
  $("k-titel").value = k?.titel || "";
  $("k-unter").value = k?.untertitel || "";
  sterneWahl($("k-sterne"), k?.prioritaet || 3);
  $("k-loeschen").hidden = !k;
  $("k-loeschen").textContent = "Löschen";
  $("kat-fehler").hidden = true;
  $("kat-dialog").showModal();
}

$("kat-form").addEventListener("submit", async e => {
  e.preventDefault();
  const daten = { titel: $("k-titel").value.trim(), untertitel: $("k-unter").value.trim(), prioritaet: Number($("k-sterne").dataset.wert) || 3 };
  if (bearbeiteteKat) daten.id = bearbeiteteKat.id; else daten.reihenfolge = zustand.kategorien.length;
  try {
    const gespeichert = await api.speichereKategorie(daten);
    if (bearbeiteteKat) Object.assign(bearbeiteteKat, gespeichert); else zustand.kategorien.push(gespeichert);
    $("kat-dialog").close(); toast("Gespeichert."); zeichnen();
  } catch (err) { $("kat-fehler").textContent = fehlerText(err); $("kat-fehler").hidden = false; }
});

$("k-loeschen").addEventListener("click", async () => {
  if (!bearbeiteteKat) return;
  const n = wuenscheVon(bearbeiteteKat.id).length;
  if (!katLoeschenBestaetigen) {
    katLoeschenBestaetigen = true;
    $("k-loeschen").textContent = n ? `Wirklich löschen? (${anzahlText(n)} gehen mit)` : "Wirklich löschen?";
    return;
  }
  try {
    await api.loescheKategorie(bearbeiteteKat.id);
    zustand.wuensche = zustand.wuensche.filter(w => w.kategorie_id !== bearbeiteteKat.id);
    zustand.kategorien = zustand.kategorien.filter(k => k.id !== bearbeiteteKat.id);
    $("kat-dialog").close(); toast("Bereich gelöscht.");
    if (location.hash.slice(1) === bearbeiteteKat.id) location.hash = ""; else zeichnen();
  } catch (err) { $("kat-fehler").textContent = fehlerText(err); $("kat-fehler").hidden = false; }
});

/* ---------- Hell / Dunkel ---------- */

function themeSetzen(theme) {
  document.documentElement.dataset.theme = theme;
  speicherSchreiben("wunschliste-theme", theme);
}
(function themeStart() {
  const gespeichert = speicherLesen("wunschliste-theme");
  if (gespeichert === "light" || gespeichert === "dark") document.documentElement.dataset.theme = gespeichert;
})();
$("theme-knopf").addEventListener("click", () => {
  const aktuell = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  themeSetzen(aktuell === "dark" ? "light" : "dark");
});

/* ---------- Countdown ---------- */

function countdown() {
  const jetzt = new Date();
  let fest = new Date(jetzt.getFullYear(), 11, 24);
  if (jetzt > new Date(jetzt.getFullYear(), 11, 26, 23, 59)) fest = new Date(jetzt.getFullYear() + 1, 11, 24);
  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const tage = Math.round((fest - heute) / 86400000);
  $("countdown").textContent = tage > 0 ? `Noch ${tage} ${tage === 1 ? "Tag" : "Tage"} bis Heiligabend` : "Frohe Weihnachten!";
}

/* ---------- 6. Start ---------- */

// \u00AD = weiches Trennzeichen: auf dem Handy wird "Weihnachts-wunschliste" sauber getrennt
$("haupttitel").textContent = (CONFIG.titel || "Weihnachtswunschliste").replace(/^(Weihnachts)(?=\S)/, "$1\u00AD");
$("leiste-name").textContent = CONFIG.name ? CONFIG.name + "s Wunschliste" : "Wunschliste";
$("demo-hinweis").hidden = !api.demo;
countdown();
zeichnen();
allesLaden();
window.addEventListener("hashchange", () => { zustand.offenSammel = null; zeichnen(); window.scrollTo(0, 0); });
// Belegung ab und zu aktualisieren, damit niemand etwas doppelt nimmt
function stillAktualisieren() {
  if (document.hidden || !zustand.geladen || zustand.offenSammel) return;
  if (inhalt.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")) return;
  belegungLaden().then(zeichnen).catch(() => {});
}
document.addEventListener("visibilitychange", stillAktualisieren);
setInterval(stillAktualisieren, 60000);
