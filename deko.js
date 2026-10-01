/* Weihnachts-Deko: Lichterketten am Rand + fallende Emojis beim Öffnen */
(function () {
  const FARBEN = ["#e2383f", "#f4c430", "#2fa36b", "#3d8bfd", "#ff8a3d"];
  const EMOJIS = ["❄️", "❄️", "❄️", "🎅", "🎄", "🎁", "⭐", "⛄", "🦌", "🔔"];
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  // seite: "oben" | "links" | "rechts"
  function kette(el, seite) {
    el.innerHTML = "";
    if (!el.offsetParent && getComputedStyle(el).display === "none") return;
    const quer = seite === "oben";
    const L = quer ? el.clientWidth : el.clientHeight;
    if (L < 50) return;
    const bogen = 150, tiefe = 12, abstand = 37.5;
    const durch = x => tiefe * Math.sin(Math.PI * ((x % bogen) / bogen)); // Durchhang
    const punkt = (laengs, q) => seite === "oben" ? [laengs, q]
      : seite === "links" ? [q, laengs] : [el.clientWidth - q, laengs];
    const winkel = seite === "oben" ? 0 : seite === "links" ? -90 : 90;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", quer ? L : el.clientWidth);
    svg.setAttribute("height", quer ? el.clientHeight : L);
    let d = "";
    for (let x = 0; x <= L; x += 5) { const [px, py] = punkt(x, 3 + durch(x)); d += (x ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1); }
    const draht = document.createElementNS(NS, "path");
    draht.setAttribute("d", d); draht.setAttribute("class", "draht");
    svg.appendChild(draht);

    let i = 0;
    for (let x = abstand / 2; x < L; x += abstand, i++) {
      const [px, py] = punkt(x, 3 + durch(x));
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${winkel})`);
      const farbe = FARBEN[i % FARBEN.length];
      g.innerHTML = `<rect class="fassung" x="-2.6" y="0" width="5.2" height="5" rx="1"/>` +
        `<ellipse class="birne" cx="0" cy="12" rx="5" ry="7.5" style="--c:${farbe};animation-delay:${(-(i * 0.37) % 2.4).toFixed(2)}s"/>`;
      svg.appendChild(g);
    }
    el.appendChild(svg);
  }

  function allesKetten() {
    kette(document.getElementById("kette-oben"), "oben");
    kette(document.getElementById("kette-links"), "links");
    kette(document.getElementById("kette-rechts"), "rechts");
  }

  let laeuft = false;
  function schnee(anzahl) {
    if (ruhig || laeuft) return;
    laeuft = true;
    const box = document.createElement("div");
    box.className = "flocken"; box.setAttribute("aria-hidden", "true");
    let laengste = 0;
    for (let i = 0; i < anzahl; i++) {
      const f = document.createElement("span");
      f.className = "flocke";
      f.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      const dauer = 4 + Math.random() * 4, verz = Math.random() * 2.5;
      laengste = Math.max(laengste, dauer + verz);
      f.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}vw;--s:${(18 + Math.random() * 22).toFixed(0)}px;` +
        `--d:${dauer.toFixed(2)}s;--v:${verz.toFixed(2)}s;--dx:${(Math.random() * 80 - 40).toFixed(0)}px;--r:${(Math.random() * 540 - 270).toFixed(0)}deg`;
      box.appendChild(f);
    }
    document.body.appendChild(box);
    setTimeout(() => { box.remove(); laeuft = false; }, (laengste + 0.3) * 1000);
  }

  allesKetten();
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(allesKetten, 150); });
  document.fonts?.ready.then(allesKetten);
  schnee(window.innerWidth < 600 ? 32 : 55);
  document.getElementById("haupttitel").addEventListener("click", () => schnee(window.innerWidth < 600 ? 32 : 55));
})();
