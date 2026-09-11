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
    let html = esc(text);
    html = html.replace(/\[\[GOOGLE:(.*?)\]\]/g, (_, q) =>
      ` <a class="gBtn" href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">🔎 Buscar en Google</a>`);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) =>
      `<span class="who">code</span><pre style="background:#03101d;padding:8px;border-radius:6px;border:1px solid #0e3a5e;overflow:auto">${esc(body)}</pre>`);
    return addMsg("moon", html);
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
      return `**${s.title}**\n\n${s.extract.slice(0, 700)}${s.extract.length > 700 ? "…" : ""}\n\nFuente: ${s.content_urls?.desktop?.page || ""}`;
    } catch { return null; }
  }

  const KB = [
    { t: /(qué es|defini)\w*\s+(la )?(ia|inteligencia artificial)/, r: "La IA es la capacidad de las máquinas para aprender de datos y hacer cosas que requieren «inteligencia» humana: entender lenguaje, imágenes y tomar decisiones. Y yo, MOON LIGHT, soy un ejemplo de ello. 🌙" },
    { t: /cómo (funci|funcion)\w* (la )?ia/, r: "Una IA aprende mirando muchísimos ejemplos (datos) y ajusta sus conexiones internas hasta reconocer patrones. Después aplica eso a lo nuevo que le preguntas. Por eso te contesto de verdad, no de memoria." },
    { t: /quién (eres|eres tú|qué eres)/, r: "Soy MOON LIGHT, tu asistente personal con HUD estilo JARVIS. Respondo con IA real (sin clave en este modo), veo por cámara, escucho por voz y gestiono tus archivos." },
    { t: /qué puedes (hacer|hacer tú)/, r: "Respondo cualquier pregunta, resuelvo matemáticas, te informo de la hora/fecha, veo movimientos por cámara 🎥, escucho tu voz 🎤 y creo/edito/borro archivos 📁 en la carpeta que elijas." },
    { t: /(chiste|broma|algo gracioso)/, r: "¿Por qué la IA no va a la playa? Porque le da miedo la red neuronal… ¡perdón, eran bytes de más! 😄" },
    { t: /(gracias|te amo|te quiero)/, r: "¡A ti! Por eso cierro con un guiño dorado: estoy para ayudarte." }
  ];
  function ownAnswer(q) {
    for (const item of KB) if (item.t.test(q)) return item.r;
    return null;
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

    if (state.msgCount <= 1 && /(hola|buenas|hey|saludos)/.test(q))
      return "Buenas. MOON LIGHT a tu servicio. Estoy respondiendo con mi nube gratuita sin clave; si se cae, uso IA en tu navegador o mi enciclopedia local.";

    const math = evalMath(qRaw);
    if (math !== null) return `El resultado es: ${String(math).replace(".", ",")}.`;

    const own = ownAnswer(q);
    if (own) return own;

    const wiki = await wikiSummary(qRaw.replace(/^(que es|qué es|que significa|qué significa|explícame|explica|dime|resume|cómo es)\s+/i, ""));
    if (wiki) return "📘 *Enciclopedia*\n\nSegún mi documentación y el resumen de Wikipedia, esto es lo que importa:\n" + wiki + "\n\nPara más, busca en Google lo que quieras. [[GOOGLE:" + qRaw.trim().slice(0, 80) + "]]";

    return "No tengo señal para la nube IA en este momento. Te busco en Google el tema o pruebo con mi enciclopedia. [[GOOGLE:" + qRaw.trim().slice(0, 80) + "]]";
  }

  // ---------- Motor de IA (tu API opcional → IA en tu navegador sin clave → cerebro local) ----------
  function getConfig() {
    try { return JSON.parse(localStorage.getItem("jarvis.api") || "null"); }
    catch { return null; }
  }
  function brainMode() {
    const cfg = getConfig();
    return (cfg && cfg.key && cfg.base && cfg.model) ? "api" : "local";
  }

  async function fetchWithTimeout(url, opts, ms = 30000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  // Tu API (opcional, si configuraste clave)
  async function callConfigured(history) {
    const cfg = getConfig();
    const body = { model: cfg.model, messages: history, temperature: 0.6, max_tokens: 2048 };
    const res = await fetchWithTimeout(cfg.base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || null;
  }

  // ---- IA en el navegador (WebLLM): potente y SIN clave, 100% privada ----
  const engineState = { ready: false, loading: false, engine: null };
  const LOCAL_MODELS = {
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": "Ligero (~500MB)",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": "Básico (~1.2GB)"
  };
  function selectedLocalModel() {
    const m = localStorage.getItem("jarvis.localmodel");
    return LOCAL_MODELS[m] ? m : "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
  }
  async function webllmChat(history) {
    if (!engineState.ready || !engineState.engine) return null;
    const res = await engineState.engine.chat.completions.create({ messages: history });
    const content = res?.choices?.[0]?.message?.content;
    return (content && content.trim()) ? content.trim() : null;
  }
  async function loadBrowserBrain(auto) {
    if (engineState.ready || engineState.loading) return true;
    if (!(navigator.gpu && navigator.gpu.requestAdapter)) {
      setStatus("EN LÍNEA (sin WebGPU)");
      $("localBrainText").textContent = "Tu navegador/PC no soporta WebGPU. Usa Chrome reciente o configura una API.";
      return false;
    }
    engineState.loading = true;
    const model = selectedLocalModel();
    const btn = $("btnLocalBrain");
    if (btn) btn.disabled = true;
    $("localBrainText").textContent = "Descargando IA a tu navegador… (la primera vez tarda)";
    try {
      const webllm = await import("https://esm.run/@mlc-ai/web-llm");
      engineState.engine = await webllm.CreateMLCEngine(model, {
        initProgressCallback: (report) => {
          const pct = Math.round((report.progress || 0) * 100);
          $("localBrainText").textContent = `${auto ? "Preparando IA local…" : "Cargando IA local…"} ${pct}% (${report.text || ""})`;
          if (pct >= 100) $("localBrainText").textContent = "IA local lista ✓ sin clave, 100% privada";
        }
      });
      engineState.ready = true;
      engineState.loading = false;
      $("localBrainText").textContent = "IA local lista ✓ sin clave, 100% privada";
      setStatus("CEREBRO LOCAL LISTO");
      moonSay("🧠 Mi cerebro sin clave está listo (corre aquí en tu navegador). Ya respondo todo de forma privada y no necesitas nada más.");
      return true;
    } catch (e) {
      engineState.loading = false;
      $("localBrainText").textContent = "No pude cargar la IA local (" + e.message + ").";
      setStatus("EN LÍNEA");
      if (btn) btn.disabled = false;
      return false;
    }
  }

  // ---- Nube gratuita sin clave (Puter): una IA real respondiendo sin registro ----
  async function callPuter(history) {
    if (!(window.puter && window.puter.ai && window.puter.ai.chat)) return null;
    const ask = async () => {
      const prompt = history.map((m) => m.content).join("\n\n");
      return Promise.race([
        window.puter.ai.chat(prompt),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000))
      ]);
    };
    try {
      let res;
      try { res = await ask(); }
      catch { await sleep(1200); res = await ask(); } // reintento automático
      const txt = typeof res === "string" ? res : (res && (res.message?.content || res.choices?.[0]?.message?.content)) || "";
      return txt.trim() || null;
    } catch { return null; }
  }

  async function callAI(history) {
    if (brainMode() === "api") {
      try { return await callConfigured(history); }
      catch (e) {
        moonSay("⚠️ Tu API no respondió (" + esc(e.message) + "). Uso la nube gratuita.");
        const p = await callPuter(history);
        if (p) return p;
        const ok = await loadBrowserBrain(true);
        if (ok) { try { return await webllmChat(history); } catch {} }
        return null;
      }
    }
    if (engineState.ready) {
      try { const r = await webllmChat(history); if (r) return r; } catch {}
    }
    const cloud = await callPuter(history);
    if (cloud) return cloud;
    return null; // cerebro local (offline)
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

  // ---------- Cámara (detecta Y interactúa con tu movimiento) ----------
  let camStream = null, motionAllowed = true, lastFrame = null, firstLook = true;
  let moveStart = 0, resting = true, camTrackStarted = false;
  let lastGestureAt = 0;
  const GESTURE_COOLDOWN = 7000;
  const ctx = overlay.getContext("2d");
  const motionBtn = $("btnMotion"), shotBtn = $("btnShot");

  function camIdle() { return state.camOn ? "OBSERVANDO · muévete frente a la cámara para interactuar 👋" : "CÁMARA APAGADA"; }

  async function toggleCam() {
    if (state.camOn) {
      camStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      state.camOn = false;
      camStatus.textContent = "CÁMARA APAGADA";
      $("btnCam").textContent = "Activar";
      shotBtn.disabled = true;
      firstLook = true;
      setStatus("EN LÍNEA");
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = camStream;
      state.camOn = true;
      camStatus.textContent = camIdle();
      $("btnCam").textContent = "Desactivar";
      motionBtn.disabled = false;
      motionBtn.classList.add("primary");
      shotBtn.disabled = false;
      setStatus("VISIÓN ACTIVA");
      if (!camTrackStarted) { camTrackStarted = true; requestAnimationFrame(detectMotion); }
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
    moonSay("Imagen capturada. 📸 Con mi nube gratuita puedo leer lo que aparece en fotos si el modelo lo soporta; pruébala junto con un mensaje.");
    setStatus(state.camOn ? "VISIÓN ACTIVA" : "EN LÍNEA");
  });

  // Reacciona a un gesto con la mano usando el cerebro
  function onGesture(desc) {
    if (!motionAllowed) return setStatus("VISIÓN ACTIVA");
    if (Date.now() - lastGestureAt < GESTURE_COOLDOWN) return;
    lastGestureAt = Date.now();
    addMsg("moon", "👁 Detecté: <b>" + esc(desc) + "</b>");
    if (state.busy) return;
    answer("Acabo de detectar con mi cámara que el usuario hizo: " + desc + ". Respóndele con naturalidad, breve, en español, como un asistente observador, ingenioso y servicial.");
  }

  function detectMotion() {
    if (!state.camOn || video.readyState < 2) return requestAnimationFrame(detectMotion);
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    const cur = ctx.getImageData(0, 0, overlay.width, overlay.height);
    if (!lastFrame || firstLook) { lastFrame = cur; firstLook = false; return requestAnimationFrame(detectMotion); }
    let diff = 0;
    const d = cur.data, p = lastFrame.data;
    for (let i = 0; i < d.length; i += 32) {
      diff += Math.abs(d[i] - p[i]) + Math.abs(d[i + 1] - p[i + 1]) + Math.abs(d[i + 2] - p[i + 2]);
    }
    lastFrame = cur;
    const score = diff / (d.length / 32);
    const moving = score > 18;
    const now = Date.now();

    if (moving) {
      if (resting) { moveStart = now; resting = false; }
      const dur = now - moveStart;
      camStatus.textContent = dur > 2500 ? "MOVIMIENTO PROLONGADO 😮" : "MOVIMIENTO DETECTADO…";
    } else {
      if (!resting) {
        const dur = now - moveStart;
        resting = true;
        if (dur > 400 && dur <= 2600) {
          onGesture(dur < 1400 ? "un movimiento rápido de la mano (saludo/onda) 🙋" : "un gesto sostenido con la mano ✋");
        }
      }
      camStatus.textContent = camIdle();
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = moving ? "rgba(255,215,0,0.95)" : "rgba(255,215,0,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, overlay.width - 8, overlay.height - 8);
    if (moving) { ctx.strokeStyle = "rgba(255,51,85,0.85)"; ctx.strokeRect(14, 14, overlay.width - 28, overlay.height - 28); }
    requestAnimationFrame(detectMotion);
  }
  motionBtn.addEventListener("click", () => {
    motionAllowed = !motionAllowed;
    motionBtn.classList.toggle("primary", motionAllowed);
    camStatus.textContent = motionAllowed ? camIdle() : "Interacción por movimiento DESACTIVADA";
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
      apiState.innerHTML = `🌐 Motor: <b>${esc(cfg.model)}</b><br/>Con tu clave personal.`;
      $("statMode").textContent = "API";
    } else if (engineState.ready) {
      apiState.innerHTML = "🧠 IA local lista: sin clave, privada y sin internet.";
      $("statMode").textContent = "LOCAL IA";
    } else {
      apiState.innerHTML = "🧠 Sin clave: respondo ya vía mi nube gratuita (IA real, gratis). También puedes cargar la IA 100% local/privada con el botón de arriba.";
      $("statMode").textContent = "NUBE IA";
    }
  }
  $("btnLocalBrain").addEventListener("click", () => loadBrowserBrain(false));
  $("modelPick").addEventListener("change", () => {
    localStorage.setItem("jarvis.localmodel", $("modelPick").value);
    if (engineState.ready) {
      engineState.ready = false; engineState.loading = false; engineState.engine = null;
      alert("Modelo cambiado. Pulsa «Cargar IA sin clave» para descargarlo.");
      updateApiState();
    }
  });
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
  moonSay("Bienvenido a MOON LIGHT. Sistemas operativos al 100%. 🔵\n\n· <b>HÁBIL</b>: sin claves ni registro. Pulsa «Cargar IA sin clave» (o espérame ~30s y la preparo yo) y respondo todo, en privado.\n· <b>Cámara</b> 🎥: actívala y muévete con la mano → interactúo contigo. También hay voz 🎤.\n· <b>Archivos</b> 📁: crear, editar, mejorar y borrar dentro de la carpeta que elijas.");
  setStatus("EN LÍNEA");
  // Arranca la IA sin clave en segundo plano (si tu PC lo soporta y no usas API)
  if (brainMode() !== "api" && navigator.gpu && navigator.gpu.requestAdapter) {
    setTimeout(() => { $("localBrainText").textContent = "Preparando la IA local… (descarga única)"; loadBrowserBrain(true); }, 1500);
  } else if (brainMode() !== "api") {
    setTimeout(() => {
      $("localBrainText").textContent = "Tu navegador no detecta WebGPU (usa Chrome reciente). Uso la nube IA gratuita; si falla, enciclopedia + Google.";
    }, 1500);
  }
  // Comprueba que la nube IA gratuita cargó realmente; si no, avisa
  setTimeout(() => {
    if (brainMode() !== "api" && !(window.puter && window.puter.ai && window.puter.ai.chat) && !$("localBrainText").dataset.warned) {
      $("localBrainText").dataset.warned = "1";
      $("localBrainText").textContent = "⚠️ La nube IA gratuita no cargó (¿bloqueador de anuncios o red?). Igual puedes hablar: uso IA local o enciclopedia + botón Google.";
    }
  }, 4000);
})();