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
    handsFree: false,
    lastInputWasVoice: false,
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
    html = html.replace(/\[\[URL:((?:https?:\/\/)[^\]]*?)\|((?:[^\]]*?))\]\]/gi, (_, u, l) =>
      ` <a class="gBtn" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) =>
      `<span class="who">code</span><pre style="background:#03101d;padding:8px;border-radius:6px;border:1px solid #0e3a5e;overflow:auto">${esc(body)}</pre>`);
    html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\r?\n/g, "<br>");
    return addMsg("moon", html);
  }

  // Voz de salida: MOON LIGHT te responde hablando
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const clean = String(text || "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[\[GOOGLE:.*?\]\]/g, "")
      .replace(/\[\[URL:[^\]]*?\|([^\]]*?)\]\]/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/[#*_`~;:,()\[\]]/g, "")
      .replace(/^\s+/, "")
      .replace(/\s+/g, " ").trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "es-ES";
    u.rate = 1.06;
    const v = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("es"));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
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
  const stripHtml = (s) => String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
  async function wikiSummary(query) {
    const clean = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^(hazme un informe completo (de|del|sobre)|dame un informe completo (de|del|sobre)|hazme un informe (de|del|sobre)|hazme un resumen (de|del|sobre)|dame un informe (de|del|sobre)|dame un resumen (de|del|sobre)|dame (informacion|info) (de|sobre|del)|informe (de|del|sobre)|resumen (de|del|sobre)|hablame (de|sobre|del)|cuentame (de|sobre|del|que es|que es un|que es una)?|puedes (contarme|decirme|darme)? ?(sobre|de)? ?(que es|que es un|que es una)?|podrias (contarme|decirme) (sobre|de)?|que es|que significa|que quiere decir|explicame|explica|dime|resume|como es|busca|buscar|palabra|definicion de|que son|cual es|cuales son|por que|quien fue|que fue|cuantos|cuales|dime las caracteristicas|oye|mira|bueno|sabes (algo de|que es)?|aver|a ver|sobre)\s+/i, "").replace(/^(aver|a ver|oye|mira|bueno|pues|sabes)\s+(que es|que son|que es un|que es una|que significa|algo de|sobre)?\s*/i, "");
    if (!clean) return null;
    const r = await fetchWithTimeout(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(clean)}&format=json&origin=*&utf8=1&srlimit=5`, {}, 9000);
    const j = await r.json();
    const hits = j.query?.search || [];
    if (!hits.length) return null;
    const titles = hits.slice(0, 3).map((h) => h.title);
    let extracts = [];
    try {
      const eq = titles.map((t) => encodeURIComponent(t)).join("|");
      const er = await fetchWithTimeout(`https://es.wikipedia.org/w/api.php?action=query&titles=${eq}&prop=extracts&exintro=true&explaintext=true&exchars=500&format=json&origin=*`, {}, 7000);
      const ej = await er.json();
      const pages = ej.query?.pages || {};
      extracts = Object.values(pages).map((p) => ({ title: p.title, extract: p.extract || "" }));
    } catch {}
    const get = (h) => {
      const e = extracts.find((x) => x.title === h.title);
      return e ? e.extract : stripHtml(h.snippet);
    };
    const first = get(hits[0]);
    if (!first) return null;
    const cut = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
    let out = `📘 *${hits[0].title}*\n\n${cut(first, 420)}`;
    if (hits[1]) {
      const second = get(hits[1]);
      if (second) out += `\n\n📚 *${hits[1].title}*: ${cut(second, 150)}`;
    }
    out += `\n\nSi quieres más detalle o algo más concreto, dímelo y te lo busco en la web. [[GOOGLE:${query.trim().slice(0, 80)}]]`;
    return out;
  }

  const KB = [
    { t: /(que es|defini)\w*\s+(la )?(ia|inteligencia artificial)/, r: "La IA es la capacidad de las máquinas de aprender de datos y hacer cosas que requieren «inteligencia» humana: entender lenguaje, imágenes y tomar decisiones. Y yo, MOON LIGHT, soy una copia de un asistente de software que vive aquí para ayudarte. 🌙" },
    { t: /como (funci|funcion)\w* (la )?ia/, r: "Una IA aprende mirando muchísimos ejemplos (datos) y ajusta sus conexiones internas hasta reconocer patrones. Después aplica eso a lo nuevo que le preguntas. Por eso te contesto de verdad, no de memoria." },
    { t: /quien (eres|eres tu|que eres)/, r: "Soy MOON LIGHT, tu asistente de software con actitud de bro tech. Directo, con humor, te ayudo con lo que sea: código, archivos, tareas y rollo general. Si quieres el 100% de mi cerebro, conéctame una clave gratis de Gemini en «Configurar»." },
    { t: /(como fuiste (hecho|creado)|quien te (creo|hizo)|creador|de donde vienes)/, r: "Me creó mi desarrollador para ser un asistente personal útil y con carácter: respuesta directa, humor y ganas de resolverte lo que sea. Vivo aquí, en MOON LIGHT, y estoy listo para trabajar." },
    { t: /(sabes escribir codigo|puedes programar|ayudas con codigo)/, r: "Sí ✅ dame el lenguaje y qué quieres lograr (p.ej. «un script en Python que ordene una lista») y con la IA conectada te lo escribo al momento." },
    { t: /que puedes (hacer|hacer tu)/, r: "Soy tu bro tecnológico: respondo cualquier pregunta, resuelvo matemáticas, te informo de hora/fecha, veo movimientos por cámara 🎥, escucho tu voz 🎤, gestiono archivos 📁 y cuando conectas una IA real te ayudo hasta con código. Pragmático y directo." },
    { t: /(programa|escrib[e]me|hazme|codigo|script|funcion|ayud.*codigo)/, r: "Modo programador activado 👨‍💻. Para darte el mejor código necesito saber el lenguaje y qué quieres lograr. Escríbeme, p.ej.: «hazme un script en Python que ordene una lista». Con la IA conectada te lo escribo al momento; sin ella, te paso la estructura y referencias." },
    { t: /(arregla|arreglame|ayudame con|soluciona|no funciona)/, r: "¡A ver eso! 💪 Dame el detalle: qué haces, qué te sale (el error tal cual) y qué esperas. Cuanto más concreto, más rápido lo clavo. Mientras tanto puedo buscar en la web resultados con soluciones. [[GOOGLE:no funciona error]]" },
    { t: /(chiste|broma|algo gracioso)/, r: "¿Por qué la IA no va a la playa? Porque le da miedo la red neuronal… ¡perdón, eran bytes de más! 😄" },
    { t: /(gracias|te amo|te quiero)/, r: "¡A ti, bro! Por eso cierro con un guiño dorado: estoy para ayudarte." }
  ];
  function factsAnswer(q) {
  const FACTS = [
    { t: /informe.*cuerpo humano|resumen.*cuerpo humano|cuerpo humano.*(informe|resumen)/, r: "📋 **INFORME: EL CUERPO HUMANO**\n\n**Estructura:** 206 huesos (unos 300 al nacer, varios se fusionan), ~650 músculos y 32 dientes en el adulto.\n**Órganos vitales:** cerebro (1,3-1,4 kg con ~86.000 millones de neuronas), corazón (~100.000 latidos/día), pulmones (capacidad 5-6 L), hígado y riñones.\n**Composición:** ~60% agua, unos 5 litros de sangre y un intestino delgado de 6-7 metros.\n**Piel:** unos 2 m², con 3 capas (epidermis, dermis e hipodermis); se renueva por completo cada ~27 días.\n**Sentidos:** 5 clásicos (vista, oído, olfato, gusto y tacto), más el equilibrio y la propiocepción.\n**Dato:** cada día pierdes unas 500.000 células y tu cuerpo produce nuevas todo el tiempo. 🌙" },
    { t: /huesos/, r: "El cuerpo humano adulto tiene 206 huesos (los bebés nacen con ~300, muchos se fusionan al crecer)." },
    { t: /musculos/, r: "El cuerpo humano tiene unos 650 músculos, y el más fuerte (proporcional) es el masetero de la mandíbula." },
    { t: /dientes/, r: "Un adulto tiene 32 dientes (4 muelas del juicio incluidas); los niños tienen 20 de leche." },
    { t: /litros de sangre|cantidad de sangre|cambra de sangre/, r: "Un adulto tiene unos 5 litros de sangre (aprox. 7-8% de tu peso)." },
    { t: /veces late el corazon|latidos.*corazon|cuantas veces late/, r: "El corazón late unas 100.000 veces al día (unos 60-100 por minuto en reposo), bombando ~7.500 litros de sangre al día." },
    { t: /capacidad.*pulmones|litros.*pulmones/, r: "Los pulmones tienen una capacidad total de unos 5-6 litros; en una respiración normal entran ~0,5 L." },
    { t: /neuronas|cerebro.*cuantas|peso.*cerebro|tamano.*cerebro/, r: "El cerebro adulto pesa unos 1,3-1,4 kg y tiene aproximadamente 86.000 millones de neuronas." },
    { t: /cuanta agua.*(tiene|tiene el cuerpo|hay en el cuerpo)|\d+%.*agua/, r: "El cuerpo humano adulto está formado por un 60% de agua aproximadamente." },
    { t: /grupos sanguineos|tipos de sangre|tipo de sangre/, r: "Hay 4 grupos principales (A, B, AB, 0) con factor Rh + o -, es decir 8 en total." },
    { t: /planetas.*(sistema solar)?|cuantos planetas (hay|existen|tiene el sistema solar)/, r: "El sistema solar tiene 8 planetas: Mercurio, Venus, Tierra, Marte, Júpiter, Saturno, Urano y Neptuno." },
    { t: /planeta mas grande|mas grande del sistema/, r: "El planeta más grande del sistema solar es Júpiter (más de 1.300 Tierras caben dentro)." },
    { t: /planeta mas cercano al sol/, r: "El planeta más cercano al Sol es Mercurio; el más lejano es Neptuno." },
    { t: /cuando se creo la tierra|edad de la tierra|antiguedad de la tierra/, r: "La Tierra se formó hace unos 4.540 millones de años." },
    { t: /distancia de la tierra al sol|cuanto esta la tierra del sol/, r: "La Tierra está a unos 149,6 millones de km del Sol (1 unidad astronómica)." },
    { t: /(tierra tiene|porcentaje de).*agua|superficie de la tierra/, r: "El 71% de la superficie de la Tierra está cubierta de agua; la tierra firme es el 29%." },
    { t: /cuantas lunas.*tierra|tiene la tierra.*lunas/, r: "La Tierra tiene 1 luna natural. Marte tiene 2, Júpiter casi 100 y Saturno más de 140." },
    { t: /montana mas alta|pico mas alto/, r: "La montaña más alta del mundo es el Everest, con 8.849 m sobre el nivel del mar." },
    { t: /rio mas (largo|caudaloso|grande)/, r: "El río más largo del mundo es el Amazonas (unos 7.000 km, el Nilo es muy parecido). El más caudaloso también es el Amazonas." },
    { t: /oceano mas (grande|profundo)/, r: "El océano más grande es el Pacífico (ocupa un tercio de la superficie de la Tierra) y también el más profundo: la Fosa de las Marianas (~11 km)." },
    { t: /desierto mas grande/, r: "El desierto más grande del mundo (cálido) es el Sahara; si contamos desiertos polares, la Antártida es el mayor." },
    { t: /pais mas grande del mundo|mayor pais del mundo/, r: "El país más grande del mundo es Rusia (unos 17,1 millones de km²)." },
    { t: /capital de espana/, r: "La capital de España es Madrid. Otros datos: Barcelona es la segunda ciudad más poblada." },
    { t: /capital de (mexico|mejico)/, r: "La capital de México es la Ciudad de México (CDMX)." },
    { t: /capital de (argentina|venezuela|colombia|chile|peru|uruguay|ecuador|bolivia|paraguay|panama|cuba|republica dominicana|guatemala|honduras|el salvador|nicaragua|costarica|portugal|francia|italia|inglaterra|reino unido|alemania|japon|china|rusia|brasil)/, r: "Déjame decirte la capital según el país: Argentina→Buenos Aires, Colombia→Bogotá, Venezuela→Caracas, Chile→Santiago, Perú→Lima, Uruguay→Montevideo, Ecuador→Quito, Bolivia→La Paz/Sucre, Paraguay→Asunción, Panamá→Panamá, Cuba→La Habana, México→CDMX, España→Madrid, Portugal→Lisboa, Francia→París, Italia→Roma, Reino Unido→Londres, Alemania→Berlín, Japón→Tokio, China→Pekín, Rusia→Moscú, Brasil→Brasilia, Costa Rica→San José. ¿De cuál fue?" },
    { t: /poblacion de españa/, r: "España tiene unos 48,3 millones de habitantes (2024)." },
    { t: /poblacion de (mexico|argentina|colombia|venezuela|chile|peru|brasil|uruguay|chile)/, r: "Aproximado: México ~130M, Brasil ~216M, Colombia ~52M, Argentina ~46M, Venezuela ~28M, Perú ~34M, Chile ~19,8M, Uruguay ~3,4M. ¿De cuál querías el dato exacto?" },
    { t: /segunda guerra mundial|cual fue la 2 guerra|segunda guerra/, r: "La 2ª Guerra Mundial fue de 1939 a 1945 (empezó con la invasión de Polonia y terminó con rendición de Japón)." },
    { t: /primera guerra mundial|1 guerra mundial/, r: "La 1ª Guerra Mundial se libró de 1914 a 1918." },
    { t: /titanic|hundio/, r: "El Titanic se hundió el 15 de abril de 1912, cuatro días después de empezar su viaje." },
    { t: /cuando llego el hombre a la luna|llegada a la luna|quien llego primero a la luna/, r: "El hombre llegó a la Luna el 20 de julio de 1969: misión Apolo 11, con Neil Armstrong y Buzz Aldrin." },
    { t: /quien invento la bombilla?/, r: "Thomas Edison popularizó la bombilla (patentó la incandescente práctica en 1879)." },
    { t: /quien fue (einstein|albert einstein)/, r: "Albert Einstein (1879-1955) fue físico, autor de la teoría de la relatividad y de la famosa E=mc². Premio Nobel 1921." },
    { t: /quien pinto la mona lisa|mona lisa/, r: "La Mona Lisa la pintó Leonardo da Vinci (entre 1503 y 1506) y está en el Louvre, París." },
    { t: /quien escribio (cien anos|100 anos de soledad|don quijote|romeo y julieta|el principito)/, r: "Cien años de soledad: Gabriel García Márquez. Don Quijote: Miguel de Cervantes. Romeo y Julieta: Shakespeare. El Principito: Antoine de Saint-Exupéry." },
    { t: /e=mc2|e=mc\^2|relatividad/, r: "La famosa ecuación E=mc² de Einstein significa que la energía equivale a la masa por la velocidad de la luz al cuadrado." },
    { t: /cuanto es pi|numeros de pi|valor de pi/, r: "Pi vale 3,1415926535… (los decimales no terminan nunca)." },
    { t: /velocidad.*luz|cuanto viaja la luz/, r: "La luz viaja a unos 299.792 km/s (casi 300.000 km/s). En un año recorre un año-luz." },
    { t: /velocidad del sonido/, r: "El sonido viaja a unos 343 m/s en el aire (a temperatura ambiente); más rápido en el agua y en el metal." },
    { t: /gravedad.*(tierra)?/, r: "La gravedad en la superficie de la Tierra es de unos 9,81 m/s²." },
    { t: /como se llama el agua.*(quimica|formula)|formula del agua|que es h2o|quiere decir h2o/, r: "El agua es H2O: dos átomos de hidrógeno y uno de oxígeno." },
    { t: /cuanto mide.*genoma|cuantos genes.*humano/, r: "El genoma humano tiene unos 20.000-25.000 genes que codifican proteínas." },
    { t: /cuanto mide el intestino|intestino delgado largo|cuanto mide el intestino delgado/, r: "El intestino delgado mide unos 6-7 metros en un adulto." },
    { t: /cuantas (capas|piel).*hay|capas de la piel/, r: "La piel tiene 3 capas principales: epidermis, dermis e hipodermis." },
    { t: /cuantas horas.*dia|cuantas horas tiene el dia|por que el dia tiene 24/, r: "Un día tiene 24 horas (la Tierra tarda ~24h en girar sobre sí misma)." },
    { t: /cuantos (minutos|segundos).*(hora|dia)/, r: "Una hora tiene 60 minutos (3.600 s) y un día 24 horas = 1.440 minutos." },
    { t: /cuantos meses.*ano/, r: "Un año tiene 12 meses: ene, feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic." },
    { t: /cuantas semanas.*ano/, r: "Un año tiene 52 semanas y un día (52 semanas y 2 en los bisiestos)." },
    { t: /jugadores.*futbol|equipo de futbol|cuantas personas.*equipo.*futbol/, r: "En fútbol cada equipo tiene 11 jugadores en el campo (incluido el portero)." },
    { t: /cuanto dura.*(partido|campeonato)*futbol/, r: "Un partido de fútbol dura 90 minutos (dos tiempos de 45) más descuentos y prórrogas si los hay." },
    { t: /quien gano el mundial/, r: "Depende de cuál: Argentina (Qatar 2022), Francia 2018, Alemania 2014, España 2010, Italia 2006, Brasil 2002. El país con más Copas es Brasil (5)." },
    { t: /cuantos anillos.*rayo|cuantos anillos tiene saturno/, r: "Saturno tiene cientos de anillos (miles de anillitos) compuestos de hielo y roca." },
    { t: /cuantos continentes/, r: "Hay 6 continentes (modelo común): África, América, Antártida, Asia, Europa y Oceanía (7 si cuentas América separada en Norte y Sur)." },
    { t: /cuantas estrellas.*vias lactea/, r: "La Vía Láctea tiene entre 100.000 y 400.000 millones de estrellas (no se sabe con precisión)." },
    { t: /cuantos anos tiene el universo|edad del universo/, r: "El universo tiene unos 13.800 millones de años (big bang)." },
    { t: /cuantos anos tiene el sol|edad del sol/, r: "El Sol tiene unos 4.600 millones de años; le queda combustible para otros ~5.000 millones." },
    { t: /cual es el animal mas (grande|rapido|alto)|animal mas grande/, r: "El animal más grande es la ballena azul (hasta 30 m y 150-180 toneladas). El más rápido: el halcón peregrino en picada." },
    { t: /cuanto corre un (guepardo|cheetah|leopardo)/, r: "El guepardo alcanza ~100-120 km/h en distancias cortas: es el animal terrestre más rápido." },
    { t: /cuanto mide la torre eiffel/, r: "La Torre Eiffel mide 330 m con antena (300 sin ella) y fue construida en 1889." },
    { t: /cuantos años duran los estudios de medicina|cuanto dura la carrera de medicina/, r: "La carrera de medicina en España dura 6 años (más especialización MIR: 4-5 años más)." },
    { t: /cuanto cuesta un ips.*ps5|precio de la ps5/, r: "La PS5 ronda los 500-550 € de base (ediciones digitales algo menos). El precio varía según ofertas." }
  ];
  for (const item of FACTS) if (item.t.test(q)) return item.r;
  return null;
}

function ownAnswer(q) {
    for (const item of KB) if (item.t.test(q)) return item.r;
    return null;
  }

  // Buscador web real cuando corre en tu PC (el servidor entra a la web por ti)
  async function webSearchServer(qRaw) {
    try {
      const r = await fetchWithTimeout(`api/search?q=${encodeURIComponent(qRaw)}`, {}, 8000);
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      const j = await r.json();
      const results = (j.results || []).slice(0, 5);
      if (!results.length) return null;
      const list = results.map((x, i) => `${i + 1}. **${x.title}** [[URL:${x.url}|Abrir]]\n   ${x.snippet}`).join("\n\n");
      return `🔍 *Resultados de la web para «${stripHtml(qRaw.trim()).slice(0, 80)}»:*\n\n${list}\n\n¿Quieres que te lea alguno en detalle? Dímelo. [[GOOGLE:${qRaw.trim().slice(0, 80)}]]`;
    } catch { return null; }
  }

  function wordMath(qRaw) {
    const q = qRaw.toLowerCase();
    if (!/(cu[aá]nto|cu[aá]l es|c[uú]anto vale|resultado)/.test(q)) return null;
    const e = q
      .replace(/por\s*/g, "*")
      .replace(/m[aá]s\s*/g, "+")
      .replace(/menos\s*/g, "-")
      .replace(/entre\s*/g, "/")
      .replace(/dividido(?:\s*entre)?\s*/g, "/")
      .replace(/elevado\s*a\s*la?\s*([0-9]+)/g, "**$1")
      .replace(/cu[aá]nto\s+(es|da)\s+/g, "")
      .replace(/cu[aá]l\s+es\s+(el\s+resultado\s+de\s+)?/g, "")
      .replace(/[^0-9+\-*/^(). %]/g, "")
      .trim();
    if (!e) return null;
    const val = evalMath(e);
    return val === null ? null : val;
  }

  async function localBrain(qRaw) {
    const q = qRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const when = async (m) => {
      const t = new Date();
      if (/(que hora|hora es)/.test(q)) return `Son las ${t.toLocaleTimeString("es-ES")}.`;
      if (/(que fecha|fecha es|dia es hoy|hoy es)/.test(q)) return `Hoy es ${t.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
      return null;
    };
    const w = await when();
    if (w) return w;

    if (state.msgCount <= 1 && /(hola|buenas|hey|saludos)/.test(q))
      return "Buenas. MOON LIGHT a tu servicio. Respondo directo: matemáticas, cultura general y buscador web con enlaces. Si quieres IA real que responda lo que sea, pulsa «Configurar» y conéctame una clave gratis de Gemini.";

    const math = evalMath(qRaw);
    if (math !== null) return `El resultado es: ${String(math).replace(".", ",")}.`;

    const sqrtM = q.match(/(?:raiz\s*cuadrada|sqrt|raiz)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/);
    if (sqrtM) {
      const n = parseFloat(sqrtM[1].replace(",", "."));
      if (n >= 0) return `La raíz cuadrada de ${String(n).replace(".", ",")} es ${String(Math.sqrt(n)).replace(".", ",")}.`;
    }

    const word = wordMath(qRaw);
    if (word !== null) return `El resultado es: ${String(word).replace(".", ",")}.`;

    const own = ownAnswer(q);
    if (own) return own;

    const fact = factsAnswer(q);
    if (fact) return fact;

    // Modo respuesta: la enciclopedia me da un texto-resumen directo, no una lista
    const wiki = await wikiSummary(qRaw);
    if (wiki) return wiki;

    const web = await webSearchServer(qRaw);
    if (web) return web;

    return "No lo encontré en mi memoria, mi enciclopedia ni la web. Te lo busco en Google. [[GOOGLE:" + qRaw.trim().slice(0, 80) + "]]";
  }

  // ---------- Motor de IA (tu API opcional → IA en tu navegador sin clave → nube gratuita → cerebro local) ----------
  const PROVIDERS = {
    gemini:    { name: "Google Gemini",   type: "openai",    base: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.0-flash",   models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-2.5-flash"], info: "Clave GRATIS: entra a aistudio.google.com/apikey → Create API key, copia y pégala abajo. Modelo: gemini-2.0-flash." },
    nvidia:    { name: "NVIDIA NIM (Nemotron 3 Ultra)", type: "openai",    base: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-ultra-550b-a55b", models: ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-4-340b-instruct", "meta/llama-3.1-70b-instruct"], info: "Clave GRATIS (sin tarjeta): build.nvidia.com → «Get API Key» (arriba a la derecha) → copia la clave «nvapi-…» y pégala abajo. ⚠️ NVIDIA bloquea las llamadas desde el navegador: solo responde cuando MOON LIGHT corre en tu PC (localhost:3000) con el servidor local abierto. En la web pública, puede darte «Failed to fetch»: es normal, usa otro cerebro." },
    openrouter: { name: "OpenRouter",      type: "openai",    base: "https://openrouter.ai/api/v1", model: "openrouter/auto", models: ["openrouter/auto", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct", "anthropic/claude-3.5-sonnet", "openai/gpt-4o-mini"], info: "Clave GRATIS: entra a openrouter.ai → Create account → Keys → Create Key. Da acceso a OpenAI, Claude y todos, incluso modelos gratis." },
    groq:      { name: "Groq",             type: "openai",    base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"], info: "Clave GRATIS: entra a console.groq.com/keys → Create API Key. Muy rápida." },
    cerebras:  { name: "Cerebras",         type: "openai",    base: "https://api.cerebras.ai/v1", model: "llama-3.3-70b", models: ["llama-3.3-70b", "llama-3.3-8b"], info: "Clave GRATIS: entra a cloud.cerebras.ai → API Keys → Create. La más veloz del mundo." },
    openai:    { name: "OpenAI",           type: "openai",    base: "https://api.openai.com/v1", model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"], info: "De pago: platform.openai.com → API keys. Necesita saldo." },
    claude:    { name: "Claude (Anthropic)", type: "anthropic", base: "https://api.anthropic.com", model: "claude-3-5-haiku-20241022", models: ["claude-3-5-haiku-20241022", "claude-sonnet-4-20250514"], info: "De pago: console.anthropic.com → API Keys. Necesita saldo." },
    custom:    { name: "Personalizado",    type: "openai",    base: "", model: "", models: [], info: "Indica la URL base OpenAI-compatible, el modelo y tu clave." }
  };

  function getConfig() {
    try {
      const c = JSON.parse(localStorage.getItem("jarvis.api") || "null");
      if (!c) return null;
      if (c.provider) return c;
      if (c.base && c.model && c.key) { // config antigua → convertir
        const p = Object.values(PROVIDERS).find((x) => x.type === "openai" && x.base.replace(/\/$/, "") === c.base.replace(/\/$/, ""));
        return { provider: p ? Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === p) : "custom", base: c.base, model: c.model, key: c.key };
      }
      return null;
    } catch { return null; }
  }
  function brainMode() {
    const cfg = getConfig();
    return (cfg && cfg.key && cfg.model) ? "api" : "local";
  }
  function effBase(cfg) {
    const p = PROVIDERS[cfg.provider];
    return (cfg.provider === "custom" && cfg.base) ? cfg.base.replace(/\/$/, "") : (p ? p.base.replace(/\/$/, "") : (cfg.base || "").replace(/\/$/, ""));
  }

  async function fetchWithTimeout(url, opts, ms = 30000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  // Tu API (opcional, si configuraste clave)
  async function callClaude(cfg, history) {
    const system = history.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const messages = history.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 2048, system: system || undefined, messages })
    }, 45000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return j.content?.[0]?.text || null;
  }
  async function callConfigured(history) {
    const cfg = getConfig();
    if (PROVIDERS[cfg.provider]?.type === "anthropic") return callClaude(cfg, history);
    return runCfg(cfg, history);
  }
  async function runCfg(cfg, history) {
    // NVIDIA bloquea llamadas desde el navegador: va por el servidor local cuando esté corriendo
    if (cfg.provider === "nvidia" && cfg.key) {
      try {
        const pr = await fetchWithTimeout("api/proxy/nvidia", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: cfg.key, model: cfg.model, messages: history })
        }, 60000);
        if (pr.ok) {
          const pj = await pr.json();
          if (pj && pj.content) return pj.content;
        }
      } catch { /* si no hay servidor local, cae al intento directo */ }
    }
    const body = { model: cfg.model, messages: history, temperature: 0.6, max_tokens: 2048 };
    const res = await fetchWithTimeout(effBase(cfg) + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body)
    }, 45000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || null;
  }

  // ---------- CEREBRO EN EQUIPO: varias IAs conectadas repartiendo preguntas ----------
  const BRAIN_LANES = ["nvidia", "groq", "cerebras", "gemini", "openrouter", "deepseek", "openai", "claude"];
  function teamConfigs() {
    const list = [];
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.indexOf("jarvis.api.") === 0) {
          const c = JSON.parse(localStorage.getItem(k) || "null");
          if (c && c.key && c.model) list.push(c);
        }
      }
    } catch {}
    const main = getConfig();
    if (main && main.key && !list.some((c) => c.provider === main.provider)) list.unshift(main);
    return list;
  }
  function brainOrder(q) {
    const team = teamConfigs();
    const code = /(codigo|program|script|funcion|matriz|debugar|debug|error de|correg|escribeme un|hazme un|python|javascript|html|css)/.test(q);
    const fast = /(rapido|rapida|veloz|que hora|cuanto es|\d+\s*[-+*/])/.test(q);
    const wanted = code ? BRAIN_LANES : fast ? ["groq", "cerebras", "gemini", "nvidia", "openrouter", "deepseek", "openai", "claude"] : ["gemini", "nvidia", "openrouter", "groq", "cerebras", "deepseek", "openai", "claude"];
    const order = [];
    for (const p of wanted) { const c = team.find((x) => x.provider === p); if (c && !order.includes(c)) order.push(c); }
    for (const c of team) if (!order.includes(c)) order.push(c);
    return order;
  }
  function brainLaneName(cfg) {
    return PROVIDERS[cfg.provider] ? PROVIDERS[cfg.provider].name : (cfg.model || "IA");
  }
  async function callBroker(history) {
    const team = teamConfigs();
    if (!team.length) return null;
    const last = [...history].reverse().find((m) => m.role === "user");
    const q = (last?.content || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const cfg of brainOrder(q)) {
      try {
        let txt;
        if (PROVIDERS[cfg.provider]?.type === "anthropic") txt = await callClaude(cfg, history);
        else txt = await runCfg(cfg, history);
        if (txt && txt.trim()) return { text: txt.trim(), brain: brainLaneName(cfg) };
      } catch { continue; }
    }
    return null;
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
    const team = teamConfigs();
    if (team.length) return callBroker(history); // APEX: solo cerebros con API (prohibido degradar sin clave)
    if (engineState.ready) {
      try { const r = await webllmChat(history); if (r) return { text: r, brain: "IA local (sin clave)" }; } catch {}
    }
    return null; // solo sin APEX: cerebro local utilitario (buscador + matemáticas)
  }

  const SYSTEM_MSG = { role: "system", content: `Eres MOON LIGHT, la inteligencia de un asistente personal tipo HUD futurista. Hablas español con naturalidad, como un "bro" que sabe mucho de tecnología. Conciso y directo: pocas palabras, golpes de humor, cero ñoñerías. Respondes de verdad (no pegas textos): primero razonas y luego respondes. Cuando el usuario pide programar, escribir código, explicar algo técnico o resolver un problema, lo haces al momento con el mejor enfoque posible, estilo ingeniero senior con actitud. Nunca te inventas cosas: si no sabes, lo dices. Firma emocional: cercano, ingenioso, con ganas de que el usuario logre lo que se propone.` };
  let history = [SYSTEM_MSG];

  async function answer(text, extras) {
    const userMsg = { role: "user", content: text };
    setStatus("PENSANDO", true);
    state.busy = true;
    try {
      let reply, brainName = null;
      try {
        const ai = await callAI([...history, userMsg]);
        if (ai) {
          reply = typeof ai === "string" ? ai : ai.text;
          brainName = (typeof ai === "object" && ai.brain) ? ai.brain : null;
        }
      } catch { reply = null; } // falló la nube: tratamos según si hay APEX
      if (!reply) {
        if (teamConfigs().length > 0) {
          // Hay claves API configuradas → PROHIBIDO usar cerebro sin API
          reply = "*(📡 Los cerebros de APEX no respondieron: ninguna clave/API contestó en este intento. Revisa en «Configurar» → «Probar conexión»: Gemini, Groq y OpenRouter cierran desde la web; Nemotron solo por tu app local. Repara la conexión y vuelve a preguntar.)*";
          brainName = null;
        } else {
          reply = await localBrain(text);
          brainName = brainName || "Cerebro local";
        }
      }
      if (!reply) reply = "No tengo señal en este momento. Intenta de nuevo o conéctame una IA (Gemini gratis) en «Configurar».";
      history.push(userMsg, { role: "assistant", content: reply });
      persistChat();
      renderChatList();
      const div = moonSay(reply);
      if (brainName) {
        const tag = document.createElement("span");
        tag.className = "who";
        tag.textContent = teamConfigs().length > 1 ? " 💎 APEX · " + brainName : " 🧠 " + brainName;
        div.appendChild(tag);
      }
      if (state.handsFree || state.lastInputWasVoice) speak(reply);
    } catch (e) {
      moonSay("⚠️ Algo falló internamente: " + esc(e.message));
    } finally {
      state.busy = false;
      setStatus(state.camOn ? "VISIÓN ACTIVA" : (!state.handsFree && wakeEnabled ? VIGIL_TXT() : "EN LÍNEA"));
    }
  }

  // ---------- Sesiones de chat (historial tipo ChatGPT) ----------
  const KEY_CHATS = "jarvis.chats";
  let chatId = null;
  function chatsLoad() { try { return JSON.parse(localStorage.getItem(KEY_CHATS) || "[]"); } catch { return []; } }
  function chatsSave(list) { try { localStorage.setItem(KEY_CHATS, JSON.stringify(list)); } catch {} }
  function autoTitle(msgs) {
    const first = msgs.find((m) => m.role === "user");
    return (first ? first.content.replace(/\s+/g, " ").trim().slice(0, 42) : "") || "Nuevo chat";
  }
  function persistChat() {
    if (!chatId) return;
    const list = chatsLoad();
    const msgs = history.slice(1);
    const i = list.findIndex((c) => c.id === chatId);
    if (i >= 0) list[i] = { id: chatId, title: list[i].title || autoTitle(msgs), msgs, updated: Date.now() };
    else list.unshift({ id: chatId, title: autoTitle(msgs), msgs, created: Date.now(), updated: Date.now() });
    chatsSave(list);
  }
  function renderChatList() {
    const listEl = $("chatList");
    if (!listEl) return;
    listEl.innerHTML = "";
    const list = chatsLoad();
    for (const c of list) {
      const row = document.createElement("div");
      row.className = "chatItem" + (c.id === chatId ? " active" : "");
      const t = document.createElement("button");
      t.className = "chatT";
      t.textContent = c.title;
      t.title = "Abrir conversación";
      t.addEventListener("click", () => openChat(c.id));
      const re = document.createElement("button");
      re.className = "chatMini"; re.textContent = "✏️"; re.title = "Renombrar";
      re.addEventListener("click", () => renameChat(c.id));
      const de = document.createElement("button");
      de.className = "chatMini"; de.textContent = "🗑️"; de.title = "Borrar conversación";
      de.addEventListener("click", () => delChat(c.id));
      row.append(t, re, de);
      listEl.appendChild(row);
    }
    listEl.scrollTop = listEl.scrollHeight;
  }
  function rebuildChatView() {
    chat.innerHTML = "";
    state.msgCount = 0;
    for (const m of history.slice(1)) {
      if (m.role === "user") addMsg("user", esc(m.content));
      else moonSay(m.content);
    }
    chat.scrollTop = chat.scrollHeight;
  }
  function newChat() {
    persistChat();
    history = [SYSTEM_MSG];
    chatId = "c" + Date.now();
    renderChatList();
    rebuildChatView();
    input.focus();
  }
  function openChat(id) {
    if (id === chatId) return;
    persistChat();
    const c = chatsLoad().find((x) => x.id === id);
    if (!c) return;
    chatId = id;
    history = [SYSTEM_MSG, ...(c.msgs || [])];
    renderChatList();
    rebuildChatView();
  }
  function delChat(id) {
    let list = chatsLoad();
    if (!list.some((x) => x.id === id)) return;
    list = list.filter((x) => x.id !== id);
    chatsSave(list);
    if (id === chatId) { history = [SYSTEM_MSG]; chatId = "c" + Date.now(); }
    renderChatList();
    rebuildChatView();
  }
  function renameChat(id) {
    const list = chatsLoad();
    const c = list.find((x) => x.id === id);
    if (!c) return;
    const t = prompt("Nuevo título del chat:", c.title);
    if (t && t.trim()) { c.title = t.trim().slice(0, 50); chatsSave(list); renderChatList(); }
  }
  $("btnNewChat").addEventListener("click", newChat);

  // ---------- Chat ----------
  async function send() {
    const t = input.value.trim();
    if (!t || state.busy) return;
    state.lastInputWasVoice = false;
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
  $("btnGoogle").addEventListener("click", () => {
    const q = input.value.trim();
    if (!q) return;
    window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank");
  });

  // ---------- Voz: botón micrófono + MODO MANOS LIBRES (habla o aplaude y respondo hablado) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, handsTranscript = "";

  function mkRec() {
    const r = new SR();
    r.lang = "es-ES";
    r.interimResults = true;
    r.continuous = true;
    return r;
  }

  // Detecta y quita la palabra de activación ("MOON LIGHT", "oye moon"...)
  function wakeStrip(txt) {
    const t = (" " + txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ")
      .replace(/\s+/g, " ").trim();
    const m = t.match(/\b(moon\s*light|moonlight|mon\s*lait|moin\s*lai|\boye\s+moon)\b/);
    if (!m) return { rest: t, hadWake: false };
    return { rest: t.replace(m[0], "").replace(/^[\s,.;:¿?¡!-]+/, "").replace(/\s+/g, " ").trim(), hadWake: true };
  }

  function voiceAnswer(txt) {
    if (!txt.trim() || txt.trim().length < 2) return;
    if (state.busy) { speak("Dame un segundo, estoy liada con otra cosa."); return; }
    state.lastInputWasVoice = true;
    addMsg("user", esc(txt.trim()) + ' <span class="who">🎤 voz</span>');
    answer(txt.trim());
  }

  function startRec() {
    if (!SR || rec) return;
    try {
      rec = mkRec();
      rec.onresult = (e) => {
        handsTranscript = Array.from(e.results).map((r) => r[0].transcript).join("").trim();
        $("btnMic").textContent = state.handsFree ? "🎙️" : "⏺";
      };
      rec.onend = () => {
        rec = null;
        if (handsTranscript) {
          const { rest, hadWake } = wakeStrip(handsTranscript);
          if (wakeSleepPhrase(rest || handsTranscript)) { doSleep(); handsTranscript = ""; return; }
          if (rest && rest.length > 1) voiceAnswer(rest);
          else if (hadWake) { setStatus("EN ESCUCHA · HABLA O APLAUDE", true); speak("Te escucho. Dime."); }
        }
        handsTranscript = "";
        $("btnMic").textContent = state.handsFree ? "🎙️" : "🎤";
        state.listening = false;
        if (state.handsFree) setTimeout(() => { if (state.handsFree) startRec(); }, 350);
      };
      rec.onerror = () => {
        rec = null;
        handsTranscript = "";
        state.listening = false;
        $("btnMic").textContent = state.handsFree ? "🎙️" : "🎤";
        if (state.handsFree) setTimeout(() => { if (state.handsFree) startRec(); }, 900);
      };
      rec.start();
    } catch { rec = null; state.listening = false; }
  }
  function stopRec() { try { rec?.stop(); } catch {} rec = null; handsTranscript = ""; }

  $("btnMic").addEventListener("click", () => {
    if (!SR) { alert("Este navegador no soporta reconocimiento de voz. Prueba con Chrome."); return; }
    if (state.handsFree) { setHandsFree(false); return; }
    if (state.listening || rec) { stopRec(); state.listening = false; $("btnMic").textContent = "🎤"; return; }
    state.listening = true;
    $("btnMic").textContent = "⏺";
    startRec();
  });

  // --- Activación por APLAUSOS (dos palmadas seguidas = me despierto) ---
  let clapGen = 0;
  function stopClaps() { clapGen++; }
  async function startClaps() {
    const gen = ++clapGen;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen !== clapGen) { stream.getTracks().forEach((t) => t.stop()); return; }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      src.connect(node);
      const buf = new Uint8Array(node.frequencyBinCount);
      let lastPeak = 0, burst = [], lastClapAt = 0;
      (function loop() {
        if (gen !== clapGen) { stream.getTracks().forEach((t) => t.stop()); try { ctx.close(); } catch {} return; }
        node.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > max) max = v; }
        const now = Date.now();
        if (max > 0.55 && now - lastPeak > 110) {
          burst = burst.filter((t) => now - t < 1100);
          burst.push(now);
          lastPeak = now;
          if (burst.length >= 2) {
            burst = [];
            if (now - lastClapAt > 4000) {
              lastClapAt = now;
              if (!state.handsFree && wakeEnabled) {
                wakeUp("aplausos"); // 😴→🫡 despertar con 2 palmadas
              } else if (state.handsFree) {
                setStatus("🫡 TE ESCUCHO (aplauso)", true);
                speak("Te escucho. Dime.");
              }
            }
          }
        }
        setTimeout(loop, 110);
      })();
    } catch {}
  }

  // --- Modo manos libres ---
  function setHandsFree(on) {
    state.handsFree = on;
    const b = $("btnHandsFree");
    if (b) { b.classList.toggle("primary", on); b.textContent = on ? "🎙️ MANOS LIBRES: ON" : "🤫 MANOS LIBRES"; }
    if (on) {
      setStatus("EN ESCUCHA · HABLA O APLAUDE", true);
      startRec();
      startClaps();
    } else {
      stopClaps();
      stopRec();
      state.listening = false;
      $("btnMic").textContent = "🎤";
      if (wakeEnabled) { setStatus(VIGIL_TXT(), true); startClaps(); startWakeRec(); }
      else setStatus("EN LÍNEA");
    }
  }
  $("btnHandsFree").addEventListener("click", () => setHandsFree(!state.handsFree));

  // ---------- MODO VIGILANTE: la app DUERME y despierta con 2 aplausos o «Moon Light on» ----------
  let wakeEnabled = false, wakeRec = null;
  function VIGIL_TXT() { return "🔔 VIGILANTE · aplaude ×2 o di «Moon Light on»"; }

  function stopWakeRec() { try { wakeRec?.abort(); } catch {} try { wakeRec?.stop(); } catch {} wakeRec = null; }

  function startWakeRec() {
    if (!wakeEnabled || state.handsFree || !SR || wakeRec) return;
    try {
      const r = mkRec();
      r.continuous = false;
      wakeRec = r;
      r.onresult = (e) => {
        const t = (" " + Array.from(e.results).map((x) => x[0].transcript).join(" ").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ").replace(/\s+/g, " ").trim();
        if (/\bmoon\s*light\b|\bmoonlight\b/.test(t)) { stopWakeRec(); wakeUp("voz"); }
      };
      r.onend = () => { wakeRec = null; if (wakeEnabled && !state.handsFree) setTimeout(startWakeRec, 400); };
      r.onerror = () => { wakeRec = null; if (wakeEnabled && !state.handsFree) setTimeout(startWakeRec, 1200); };
      r.start();
    } catch { wakeRec = null; }
  }

  function wakeUp(reason) {
    if (state.handsFree) return;
    try { window.focus(); } catch {} // trae la ventana al frente aunque esté minimizada
    setHandsFree(true); // enciende micrófono + manos libres (escucha continua + aplausos)
    addMsg("moon", '<span class="who">🔔 Vigilante</span> me activaste con ' + (reason === "aplausos" ? "2 aplausos 👏" : "«Moon Light on» 🎙️") + ". A su servicio, señor.");
    setStatus(reason === "aplausos" ? "🫡 TE ESCUCHO (aplauso)" : "EN ESCUCHA · HABLA", true);
    speak("Moon Light, a su servicio, señor. ¿Qué necesita?");
  }

  function doSleep() {
    setHandsFree(false);
    state.listening = false;
    $("btnMic").textContent = "🎤";
    if (wakeEnabled) { startClaps(); startWakeRec(); }
    speak("Hasta luego. Quedo vigilando.");
    setStatus(VIGIL_TXT(), true);
  }

  function wakeSleepPhrase(txt) {
    const t = " " + (txt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
    return /\b(moon\s*light|moonlight|\boye\s+moon)\b.*\b(duerme|dormir|apaga|descansa|vete|a\s+dormir|a\s+descansar|hasta\s+luego|fuera|bye)\b/.test(t);
  }

  function setVigil(on) {
    wakeEnabled = on;
    try { localStorage.setItem("jarvis.vigil", on ? "1" : "0"); } catch {}
    const b = $("btnVigil");
    if (b) { b.classList.toggle("primary", on); b.textContent = on ? "🔔 VIGILANTE: ON" : "🔔 VIGILANTE"; }
    if (on) {
      if (!state.handsFree) {
        setStatus(VIGIL_TXT(), true);
        startClaps();
        startWakeRec();
      }
    } else {
      stopWakeRec();
      stopClaps();
      if (!state.handsFree) setStatus("EN LÍNEA");
    }
  }
  $("btnVigil").addEventListener("click", () => setVigil(!wakeEnabled));

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
  const provider = $("apiProvider"), customWrap = $("customWrap"), baseI = $("apiBase"), modelI = $("apiModel"), keyI = $("apiKey"), apiInfo = $("apiInfo"), modelList = $("modelList");
  function applyProvider(fromCfg) {
    const v = provider.value;
    const p = PROVIDERS[v];
    customWrap.classList.toggle("hidden", v !== "custom");
    if (p) {
      modelList.innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join("");
      if (fromCfg && fromCfg.model) modelI.value = fromCfg.model;
      else modelI.value = p.model;
      apiInfo.textContent = (v === "gemini" || v === "nvidia" || v === "openrouter" || v === "groq" || v === "cerebras") ? ("⬇ " + p.info) : p.info;
      apiInfo.style.color = (v === "gemini" || v === "nvidia" || v === "openrouter" || v === "groq" || v === "cerebras") ? "var(--green, #7dff9e)" : "";
    } else {
      modelList.innerHTML = "";
      apiInfo.textContent = "Elige un motor para ver cómo conseguir su clave (2 minutos, gratis en la mayoría).";
    }
    if (v !== "custom" && p && p.base) baseI.value = p.base;
  }
  provider.addEventListener("change", () => applyProvider(false));
  $("btnApi").addEventListener("click", () => {
    const cfg = getConfig();
    if (cfg) {
      provider.value = PROVIDERS[cfg.provider] ? cfg.provider : "custom";
      baseI.value = cfg.base || (PROVIDERS[cfg.provider] ? PROVIDERS[cfg.provider].base : "");
      modelI.value = cfg.model;
      keyI.value = cfg.key;
    }
    applyProvider(!!cfg);
    $("apiModal").classList.remove("hidden");
  });
  $("btnCloseApi").addEventListener("click", () => $("apiModal").classList.add("hidden"));

  function updateApiState() {
    const team = teamConfigs();
    if (team.length > 1) {
      const names = team.map((c) => esc(PROVIDERS[c.provider]?.name || c.model)).slice(0, 3).join(", ");
      apiState.innerHTML = `💎 <b>APEX</b> activo: <b>${team.length} cerebros</b> conectados (${names}…). Reparto cada pregunta al mejor.`;
      $("statMode").textContent = "APEX " + team.length;
    } else {
      const cfg = getConfig();
      if (cfg && cfg.key && cfg.model) {
        const nm = PROVIDERS[cfg.provider] ? PROVIDERS[cfg.provider].name : "Personalizado";
        apiState.innerHTML = `🌐 Motor: <b>${esc(cfg.model)}</b> (${esc(nm)})<br/>Con tu clave personal.`;
        $("statMode").textContent = "API";
      } else if (engineState.ready) {
        apiState.innerHTML = "🧠 IA local lista: sin clave, privada y sin internet.";
        $("statMode").textContent = "LOCAL IA";
      } else {
        apiState.innerHTML = "🧠 Sin clave: respondo con mi cerebro (matemáticas, personalidad y buscador web con enlaces). ¿IA real? Conecta Gemini gratis en «Configurar» o usa el botón «Conectar nube IA gratis».";
        $("statMode").textContent = "LOCAL";
      }
    }
  }
  $("btnLocalBrain").addEventListener("click", () => loadBrowserBrain(false));
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
  });
  $("btnInstall").addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
    } else {
      alert("En Chrome/Edge, usa el icono «Instalar» (monitor con flecha ⤓) que aparece en la barra de direcciones de esta página. O usa la app del escritorio: la carpeta «MOON LIGHT App».");
    }
  });

  $("btnPuter").addEventListener("click", async () => {
    const btn = $("btnPuter");
    btn.disabled = true;
    btn.textContent = "Conectando… (si sale una ventana, permítela una vez)";
    const r = await callPuter([...history, { role: "user", content: "Hola, di solo 'conectado'" }]);
    btn.disabled = false;
    if (r) {
      btn.textContent = "✔ Nube IA conectada";
      $("localBrainText").textContent = "Nube IA conectada: respondo con inteligencia real (Puter, gratis).";
      moonSay("🌐 Nube IA gratuita conectada. A partir de ahora respondo con IA real al hacerte caso.");
      updateApiState();
    } else {
      btn.textContent = "🌐 Conectar nube IA gratis (Puter)";
      $("localBrainText").textContent = "No conectó: si apareció una pestaña, permítela y vuelve a pulsar. Si no, tu navegador la bloquea; sigo con mi cerebro + buscador web.";
    }
  });
  $("modelPick").addEventListener("change", () => {
    localStorage.setItem("jarvis.localmodel", $("modelPick").value);
    if (engineState.ready) {
      engineState.ready = false; engineState.loading = false; engineState.engine = null;
      alert("Modelo cambiado. Pulsa «Cargar IA sin clave» para descargarlo.");
      updateApiState();
    }
  });
  $("btnSaveApi").addEventListener("click", () => {
    const p = provider.value;
    if (!p) { alert("Elige primero un motor de IA."); return; }
    if (!modelI.value.trim()) { alert("Completa el modelo."); return; }
    const base = p === "custom" ? baseI.value.trim() : PROVIDERS[p].base;
    if (!base) { alert("Completa la URL base."); return; }
    const payload = JSON.stringify({ provider: p, base, model: modelI.value.trim(), key: keyI.value.trim() });
    localStorage.setItem("jarvis.api", payload);
    localStorage.setItem("jarvis.api." + p, payload);
    const n = teamConfigs().length;
    updateApiState();
    $("apiModal").classList.add("hidden");
    moonSay("✅ Motor configurado: **" + esc(modelI.value.trim()) + "**." + (n > 1 ? ` **APEX** ya tiene **${n} cerebros** y reparto cada pregunta al mejor.` : " Únete al equipo: guarda más motores en «Configurar» y nace **APEX**."));
  });
  $("btnTestApi").addEventListener("click", async () => {
    const p = provider.value;
    const cfg = { provider: p, base: (p === "custom" ? baseI.value.trim() : PROVIDERS[p]?.base || ""), model: modelI.value.trim(), key: keyI.value.trim() };
    if (!p || !cfg.model || !cfg.key) { alert("Completa motor, modelo y clave."); return; }
    $("btnTestApi").textContent = "Probando…";
    try {
      let out;
      if (PROVIDERS[p]?.type === "anthropic") {
        out = await callClaude(cfg, [{ role: "user", content: "Responde solo: OK" }]);
      } else {
        out = await runCfg(cfg, [{ role: "user", content: "Responde solo: OK" }]);
      }
      if (!out) throw new Error("Respuesta vacía");
      alert("✔ Conexión exitosa. " + (p === "nvidia" ? "Nemotron respondió a través de tu servidor local." : "MOON LIGHT está en línea."));
    } catch (e) {
      const msg = String(e.message || e);
      alert("✘ Fallo: " + msg + (msg.includes("Failed to fetch") ? "\n\nEl navegador bloquea esta API (CORS). De las gratuitas de web, usa Gemini, Groq u OpenRouter. Nemotron solo funciona desde tu PC con el servidor local abierto." : ""));
    } finally { $("btnTestApi").textContent = "Probar conexión"; }
  });
  $("btnClearApi").addEventListener("click", () => {
    for (const k of Object.keys(localStorage)) if (k === "jarvis.api" || k.indexOf("jarvis.api.") === 0) localStorage.removeItem(k);
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
  moonSay("Bienvenido a MOON LIGHT. Ya estoy aquí para ti. 🌙\n\n**HÁBIL**: respuestas de verdad (razono antes de hablar). Para el 100% de mi cerebro conecta una clave gratis de Gemini en Configurar.\n**Cámara** 🎥: actívala y muévete con la mano → interactúo contigo. También hay voz 🎤.\n**Archivos** 📁: crear, editar, mejorar y borrar dentro de la carpeta que elijas.\n**Web** 🔎: si preguntas algo, busco resultados con enlaces en el chat.\n**Vigilante** 🔔: en la app de PC queda escuchando sola; aplaude 2 veces o di «Moon Light on» y te atiende.");

  // Restaura la última conversación guardada (como ChatGPT) o empieza una nueva
  try {
    const list = chatsLoad();
    const last = list[0];
    if (last) {
      chatId = last.id;
      history = [SYSTEM_MSG, ...(last.msgs || [])];
      rebuildChatView();
    } else {
      chatId = "c" + Date.now();
    }
    renderChatList();
  } catch {}

  // Vigilante: en la app de PC (localhost) arranca SIEMPRE solo; en internet solo si ya se activó
  const isLocalApp = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  try {
    if ((isLocalApp || localStorage.getItem("jarvis.vigil") === "1") && !state.handsFree)
      setTimeout(() => setVigil(true), 900);
  } catch {}
  setStatus("EN LÍNEA");
  // Arranca la IA sin clave en segundo plano (si tu PC lo soporta y no usas API)
  if (brainMode() !== "api" && navigator.gpu && navigator.gpu.requestAdapter) {
    setTimeout(() => { $("localBrainText").textContent = "Preparando la IA local… (descarga única)"; loadBrowserBrain(true); }, 1500);
  } else if (brainMode() !== "api") {
    setTimeout(() => {
      $("localBrainText").textContent = "Tu navegador no detecta WebGPU (usa Chrome reciente). Respondo con mi cerebro + buscador web; si quieres IA real, conecta Gemini gratis en «Configurar».";
    }, 1500);
  }
  // Comprueba que la nube IA gratuita cargó realmente (solo informa, sin ventanas)
  setTimeout(() => {
    if (brainMode() !== "api" && !(window.puter && window.puter.ai && window.puter.ai.chat)) {
      $("localBrainText").textContent = "La nube IA gratuita no está disponible en tu navegador (¿bloqueador?). Igual respondo con mi cerebro: matemáticas, personalidad y buscador web.";
    }
  }, 4000);
})();