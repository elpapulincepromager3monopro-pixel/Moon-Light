(() => {
  "use strict";

  // ---------- Referencias ----------
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), input = $("input"), out = $("statusText"), dot = $("statusDot");
  const video = $("video"), overlay = $("overlay"), camStatus = $("camStatus");
  const fileList = $("fileList"), fileName = $("fileName"), fileTargets = $("fileTargets");
  const apiState = $("apiState");

  const state = {
    dir: null,
    currentFileName: null,
    editHandle: null,
    camOn: false,
    motionOn: false,
    listening: false,
    msgCount: 0,
    start: Date.now(),
    busy: false
  };

  // ---------- Utilidades ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function setStatus(txt, on = true) {
    out.textContent = txt;
    dot.classList.toggle("off", !on);
  }
  function fmtDate() { return new Date().toLocaleTimeString("es-ES"); }

  // ---------- Uptime ----------
  setInterval(() => {
    const s = Math.floor((Date.now() - state.start) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    $("statUptime").textContent = `${h}:${m}`;
  }, 1000);

  // ---------- Mensajería ----------
  function addMsg(who, content, extraClass = "") {
    const div = document.createElement("div");
    div.className = `msg ${who === "user" ? "user" : "moon"} ${extraClass}`;
    if (content instanceof Node) div.appendChild(content);
    else div.innerHTML = `<span class="who">${who === "user" ? "TÚ" : "MOON LIGHT"} · ${fmtDate()}</span>${content}`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    if (who === "user") state.msgCount++;
    $("statMsgs").textContent = state.msgCount;
    return div;
  }
  function moonSay(text) {
    return addMsg("moon", esc(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) =>
      `<span class="who">code</span><pre style="background:#03101d;padding:8px;border-radius:6px;border:1px solid #0e3a5e;overflow:auto">${esc(body)}</pre>`));
  }

  // ---------- Cerebro local (modo sin API) ----------
  function parseNumBias(q) {
    const m = q.match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }
  function evalMath(expr) {
    expr = expr.replace(/,/g, ".").replace(/x/gi, "*").replace(/÷/g, "/");
    if (!/^[\d\s+\-*/().^%&|<>!=]+$/.test(expr)) return null;
    const core = expr.replace(/[+\-*/^%()\s]/g, "");
    if (!/\(?\s*-?\d/.test(expr.trim()) || core.length === 0) return null;
    try {
      const out = Function(`"use strict"; return (${expr.replace(/\^/g, "**")});`)();
      if (typeof out !== "number" || !isFinite(out)) return null;
      return out;
    } catch { return null; }
  }
  async function wikiSummary(query) {
    try {
      const r = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&utf8=1&srlimit=1`);
      const j = await r.json();
      const hit = j.query?.search?.[0];
      if (!hit) return null;
      const r2 = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
      const s = await r2.json();
      if (!s.extract) return null;
      return `📘 *Wikipedia — ${s.title}*\n\n${s.extract.slice(0, 900)}${s.extract.length > 900 ? "…" : ""}\n\nFuente: ${s.content_urls?.desktop?.page || ""}`;
    } catch { return null; }
  }

  async function localBrain(qRaw) {
    const q = qRaw.toLowerCase();
    const when = async (m) => {
      const t = new Date();
      if (/(qué hora|hora es)/.test(q)) return `Son las ${t.toLocaleTimeString("es-ES")}.`;
      if (/(qué fecha|fecha es|día es hoy|hoy es)/.test(q)) return `Hoy es ${t.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
      return null;
    };
    const w = await when();
    if (w) return w;

    if (/(hola|buenas|hey|saludos)/.test(q) && state.msgCount <= 1)
      return "Buenas. MOON LIGHT a tu servicio. Estoy en modo LOCAL: uso mi enciclopedia integrada. Actívalo al máximo configurando una API en el panel NUBE/CEREBRO.";

    const math = evalMath(qRaw);
    if (math !== null) return `El resultado es: ${String(math).replace(".", ",")}.`;

    const wiki = await wikiSummary(qRaw.replace(/^(que es|qué es|que significa|qué significa|explícame|explica|dime|resume)\s+/i, ""));
    if (wiki) return wiki;

    return "No estoy conectado a un cerebro potente todavía. Configura una API (NVIDIA NIM, OpenRouter u OpenAI) en el panel NUBE/CEREBRO y respondo a cualquier materia con total dominio. Por ahora puedo: matemáticas, hora/fecha y búsquedas enciclopédicas.";
  }

  // ---------- Motor de IA (API o local) ----------
  function getConfig() {
    try { return JSON.parse(localStorage.getItem("jarvis.api") || "null"); }
    catch { return null; }
  }
  async function callAI(history) {
    const cfg = getConfig();
    if (!cfg || !cfg.key || !cfg.base || !cfg.model) return null;
    const body = { model: cfg.model, messages: history, temperature: 0.6, max_tokens: 2048 };
    try {
      const r = await fetch(cfg.base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j.choices?.[0]?.message?.content || null;
    } catch (e) {
      throw new Error("No pude conectar con la API (" + e.message + ").");
    }
  }

  const history = [
    { role: "system", content: "Eres MOON LIGHT, una inteligencia artificial avanzada. Responde en español, con actitud profesional, directa y un toque ingenioso. Eres experto en todas las materias." }
  ];

  async function answer(text, extras) {
    const userMsg = { role: "user", content: text };
    setStatus("PENSANDO", true);
    state.busy = true;
    try {
      let reply;
      try { reply = await callAI([...history, userMsg]); }
      catch (e) { moonSay("⚠️ " + esc(e.message)); reply = null; }
      if (!reply) reply = await localBrain(text);
      history.push(userMsg, { role: "assistant", content: reply });
      moonSay(reply);
    } catch (e) {
      moonSay("⚠️ Fallo interno: " + esc(e.message));
    } finally {
      state.busy = false;
      setStatus(state.camOn ? "VISIÓN ACTIVA" : "EN LÍNEA");
    }
  }

  // ---------- Chat ----------
  async function send() {
    const t = input.value.trim();
    if (!t || state.busy) return;
    input.value = "";
    addMsg("user", esc(t));
    await answer(t);
  }
  $("btnSend").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("btnClear").addEventListener("click", () => {
    chat.innerHTML = "";
    history.length = 1;
  });

  // ---------- Voz ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (SR) {
    rec = new SR();
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const txt = e.results[0][0].transcript;
      addMsg("user", esc(txt) + ' <span class="who">🎤 voz</span>');
      answer(txt);
    };
    rec.onend = () => { $("btnMic").textContent = "🎤"; state.listening = false; };
    rec.onerror = () => { $("btnMic").textContent = "🎤"; state.listening = false; };
  }
  $("btnMic").addEventListener("click", () => {
    if (!rec) { alert("Este navegador no soporta reconocimiento de voz. Prueba con Chrome."); return; }
    if (state.listening) { rec.stop(); return; }
    state.listening = true;
    $("btnMic").textContent = "⏺";
    try { rec.start(); } catch {}
  });

  // ---------- Cámara ----------
  let camStream = null, motionAllowed = false, lastFrame = null;
  const ctx = overlay.getContext("2d");
  const motionBtn = $("btnMotion"), shotBtn = $("btnShot");

  async function toggleCam() {
    if (state.camOn) {
      camStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      state.camOn = false;
      camStatus.textContent = "CÁMARA APAGADA";
      $("btnCam").textContent = "Activar";
      motionBtn.disabled = true; shotBtn.disabled = true;
      setStatus("EN LÍNEA");
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = camStream;
      state.camOn = true;
      camStatus.textContent = "CÁMARA ACTIVA";
      $("btnCam").textContent = "Desactivar";
      motionBtn.disabled = false; shotBtn.disabled = false;
      overlay.width = video.videoWidth || 320;
      overlay.height = video.videoHeight || 240;
      setStatus("VISIÓN ACTIVA");
    } catch (e) {
      alert("No pude acceder a la cámara: " + e.message);
    }
  }
  $("btnCam").addEventListener("click", toggleCam);

  // Snap: botón capturar
  shotBtn.addEventListener("click", () => {
    if (!state.camOn) return;
    const snap = document.createElement("canvas");
    snap.width = video.videoWidth; snap.height = video.videoHeight;
    snap.getContext("2d").drawImage(video, 0, 0);
    const img = document.createElement("img");
    img.src = snap.toDataURL("image/jpeg", 0.8);
    addMsg("user", img);
    setStatus("ANALIZANDO IMAGEN");
    setTimeout(() => {
      moonSay("Imagen capturada. En modo LOCAL no puedo analizar imágenes; con una API potente (ej. NVIDIA NIM con vision) sí. ¿Quieres que la guarde?");
      setStatus(state.camOn ? "VISIÓN ACTIVA" : "EN LÍNEA");
    }, 900);
  });

  // Movimiento → "manipular" con la cámara
  let motionCount = 0;
  function detectMotion() {
    if (!state.camOn || !motionAllowed || video.readyState < 2) return requestAnimationFrame(detectMotion);
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    const cur = ctx.getImageData(0, 0, overlay.width, overlay.height);
    if (!lastFrame) { lastFrame = cur; return requestAnimationFrame(detectMotion); }
    let diff = 0;
    const d = cur.data, p = lastFrame.data;
    for (let i = 0; i < d.length; i += 40) {
      diff += Math.abs(d[i] - p[i]) + Math.abs(d[i + 1] - p[i + 1]) + Math.abs(d[i + 2] - p[i + 2]);
    }
    lastFrame = cur;
    const score = diff / (d.length / 40);
    const moving = score > 28;
    // HUD
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = moving ? "rgba(255,51,85,0.8)" : "rgba(0,229,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, overlay.width - 8, overlay.height - 8);
    if (moving) ctx.strokeRect(14, 14, overlay.width - 28, overlay.height - 28);
    if (moving) {
      camStatus.textContent = "MOVIMIENTO DETECTADO";
      motionCount++;
      if (motionCount === 5) { addMsg("moon", "He detectado tu movimiento en cámara. Estoy observando. 👁"); motionCount = 0; }
    } else {
      camStatus.textContent = "CÁMARA ACTIVA · VIGILANDO";
    }
    requestAnimationFrame(detectMotion);
  }
  motionBtn.addEventListener("click", () => {
    motionAllowed = !motionAllowed;
    motionBtn.classList.toggle("primary", motionAllowed);
    camStatus.textContent = motionAllowed ? "VIGILANCIA ACTIVA" : "CÁMARA ACTIVA";
  });

  // ---------- Gestor de archivos (solo carpeta elegida) ----------
  async function openFolder() {
    if (!window.showDirectoryPicker) {
      alert("Este navegador no soporta acceso a archivos. Prueba con Chrome/Edge.");
      return;
    }
    try {
      state.dir = await window.showDirectoryPicker({ mode: "readwrite" });
      $("fileHint").innerHTML = `📁 Carpeta: <b>${esc(state.dir.name)}</b>. MOON LIGHT solo trabaja aquí.`;
      await listFiles();
    } catch (e) { /* cancelado */ }
  }
  $("btnFolder").addEventListener("click", openFolder);

  async function listFiles() {
    fileList.innerHTML = "";
    fileTargets.innerHTML = "";
    if (!state.dir) return;
    for await (const [name, h] of state.dir.entries()) {
      if (h.kind === "file") {
        const item = document.createElement("div");
        item.className = "fileItem";
        const f = await h.getFile();
        const kb = (f.size / 1024).toFixed(1);
        item.innerHTML = `<span class="name">${esc(name)}</span><span class="size">${kb} KB</span>`;
        item.addEventListener("click", () => selectFile(name, h, item));
        fileList.appendChild(item);
        const opt = document.createElement("option");
        opt.value = name;
        fileTargets.appendChild(opt);
      }
    }
  }

  async function selectFile(name, handle, el) {
    state.currentFileName = name;
    state.editHandle = handle;
    document.querySelectorAll(".fileItem.sel").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel");
    fileName.value = name;
    $("editorTitle").textContent = "EDITOR · " + name;
    const f = await handle.getFile();
    $("editor").value = await f.text();
    $("editorModal").classList.remove("hidden");
  }

  function getCurrentName() {
    let n = fileName.value.trim();
    if (!n) n = state.currentFileName;
    if (!n) { alert("Escribe un nombre de archivo."); return null; }
    return n.toLowerCase().endsWith(".txt") || n.includes(".") ? n : n + ".txt";
  }

  $("btnNewFile").addEventListener("click", async () => {
    const n = getCurrentName();
    if (!n) return;
    if (!state.dir) {
      // Borrar dentro de la carpeta elegida
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: n });
        const w = await h.createWritable();
        await w.write(""); await w.close();
        $("editor").value = ""; $("editorTitle").textContent = "EDITOR · " + n;
        $("editorModal").classList.remove("hidden");
        return;
      }
      alert("Primero abre una carpeta en ARCHIVOS para crear archivos.");
      return;
    }
    try {
      const h = await state.dir.getFileHandle(n, { create: true });
      const w = await h.createWritable();
      await w.write($("editor").value || "");
      await w.close();
      await listFiles();
      await selectFile(n, h, null);
    } catch (e) { alert("Error: " + e.message); }
  });

  $("btnSaveFile").addEventListener("click", async () => {
    const text = $("editor").value;
    if (!state.dir) {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker();
        const w = await h.createWritable();
        await w.write(text); await w.close();
        alert("Guardado.");
        return;
      }
      alert("Primero abre una carpeta en ARCHIVOS para guardar.");
      return;
    }
    const n = getCurrentName();
    try {
      if (!state.editHandle || n !== state.currentFileName) {
        state.editHandle = await state.dir.getFileHandle(n || "archivo.txt", { create: true });
        state.currentFileName = n;
      }
      const w = await state.editHandle.createWritable();
      await w.write(text); await w.close();
      await listFiles();
      alert("✔ Guardado: " + state.currentFileName);
    } catch (e) { alert("Error: " + e.message); }
  });

  $("btnDeleteFile").addEventListener("click", async () => {
    const n = (fileName.value.trim() || state.currentFileName);
    if (!n) { alert("Escribe o selecciona un archivo."); return; }
    if (!confirm(`¿Borrar "${n}"? Esta acción no se puede deshacer.`)) return;
    if (state.dir) {
      try { await state.dir.removeEntry(n); } catch (e) { alert("Error: " + e.message); return; }
      await listFiles();
    } else {
      alert("Primero abre una carpeta en ARCHIVOS para poder borrar archivos.");
      return;
    }
    $("editorModal").classList.add("hidden");
    alert("✔ Borrado: " + n);
  });

  // Mejorar con IA
  $("btnAutoImprove").addEventListener("click", async () => {
    const content = $("editor").value;
    if (!content) { alert("El archivo está vacío. Escribe algo primero."); return; }
    setStatus("MEJORANDO ARCHIVO", true);
    const old = $("btnAutoImprove").disabled;
    $("btnAutoImprove").disabled = true;
    try {
      let improved = null;
      try {
        improved = await callAI([{ role: "system", content: "Eres un ingeniero experto. Reescribe o mejora el archivo que te dan y responde SOLO con el nuevo contenido completo, sin explicaciones." }, { role: "user", content: "Archivo a mejorar:\n\n" + content }]);
      } catch {}
      if (!improved) improved = await improveLocal(content);
      $("editor").value = improved;
      alert("✔ Archivo mejorado. Revísalo y pulsa GUARDAR.");
    } finally {
      $("btnAutoImprove").disabled = old;
      setStatus("EN LÍNEA");
    }
  });

  function improveLocal(content) {
    const lines = content.split("\n");
    return lines.map((l) => l.trim()).filter(Boolean).map((l, i) =>
      i === 0 ? (l.endsWith(".") ? l : l + ".") : l
    ).join("\n");
  }

  $("btnCloseEditor").addEventListener("click", () => $("editorModal").classList.add("hidden"));

  // ---------- API / Nube ----------
  const provider = $("apiProvider"), customWrap = $("customWrap"), baseI = $("apiBase"), modelI = $("apiModel"), keyI = $("apiKey");
  provider.addEventListener("change", () => {
    customWrap.classList.toggle("hidden", provider.value !== "custom");
    if (provider.value === "https://integrate.api.nvidia.com/v1") modelI.value = modelI.value || "nvidia/nemotron-3-ultra-550b-a55b";
    if (provider.value === "https://openrouter.ai/api/v1") modelI.value = modelI.value || "nvidia/nemotron-3-ultra-550b-a55b";
    if (provider.value === "https://api.openai.com/v1") modelI.value = modelI.value || "gpt-4o-mini";
  });
  $("btnApi").addEventListener("click", () => {
    const cfg = getConfig();
    if (cfg) {
      provider.value = ["https://integrate.api.nvidia.com/v1", "https://openrouter.ai/api/v1", "https://api.openai.com/v1"].includes(cfg.base) ? cfg.base : "custom";
      customWrap.classList.toggle("hidden", provider.value !== "custom");
      baseI.value = cfg.base; modelI.value = cfg.model; keyI.value = cfg.key;
    }
    $("apiModal").classList.remove("hidden");
  });
  $("btnCloseApi").addEventListener("click", () => $("apiModal").classList.add("hidden"));

  function updateApiState() {
    const cfg = getConfig();
    if (cfg && cfg.key && cfg.model) {
      apiState.innerHTML = `🌐 Motor: <b>${esc(cfg.model)}</b><br/>Conectado a la nube.`;
      $("statMode").textContent = "NUBE";
    } else {
      apiState.innerHTML = "Sin API: modo LOCAL (enciclopedia).<br/>Configura una API para potenciarlo.";
      $("statMode").textContent = "LOCAL";
    }
  }
  $("btnSaveApi").addEventListener("click", () => {
    const base = provider.value === "custom" ? baseI.value.trim() : provider.value;
    if (!base || !modelI.value.trim()) { alert("Completa la URL y el modelo."); return; }
    localStorage.setItem("jarvis.api", JSON.stringify({ base, model: modelI.value.trim(), key: keyI.value.trim() }));
    updateApiState();
    $("apiModal").classList.add("hidden");
  });
  $("btnTestApi").addEventListener("click", async () => {
    const cfg = { base: (provider.value === "custom" ? baseI.value.trim() : provider.value), model: modelI.value.trim(), key: keyI.value.trim() };
    if (!cfg.base || !cfg.model || !cfg.key) { alert("Completa URL, modelo y clave."); return; }
    $("btnTestApi").textContent = "Probando…";
    try {
      const r = await fetch(cfg.base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "Responde solo OK" }], max_tokens: 5 })
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      alert("✔ Conexión exitosa. MOON LIGHT está en línea.");
    } catch (e) {
      alert("✘ Fallo: " + e.message);
    } finally { $("btnTestApi").textContent = "Probar conexión"; }
  });
  $("btnClearApi").addEventListener("click", () => {
    localStorage.removeItem("jarvis.api");
    updateApiState();
    $("apiModal").classList.add("hidden");
  });

  // ---------- Comandos rápidos en consola ----------
  window.moonlight = {
    openFolder, listFiles,
    ask: (txt) => { addMsg("user", esc(txt)); answer(txt); }
  };

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- Inicio ----------
  updateApiState();
  moonSay("Bienvenido a MOON LIGHT. Sistemas operativos al 100%. 🔵\n\n· <b>HÁBIL</b> en todas las materias (configura la NUBE para total dominio).\n· Control por <b>cámara</b> (visor + detección de movimiento) y por <b>voz</b> 🎤.\n· <b>Archivos</b>: crear, editar, mejorar y borrar dentro de la carpeta que elijas.");
  setStatus("EN LÍNEA");
})();