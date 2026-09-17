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
    html = html.replace(/\[\[HOLO:[a-z]+\]\]/gi, ""); // marcador de holograma: invisible
    html = html.replace(/\[\[PC:[^\]]*\]\]/gi, ""); // marcador de mando PC: invisible
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
    gemini: { name: "Google Gemini", type: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.0-flash", models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"], info: "Clave GRATIS: entra a aistudio.google.com/apikey → Create API key, copia y pégala abajo. Modelo actual RECOMENDADO: gemini-2.0-flash (los demás pueden dar 404 si Google ya los retiró)." },
    nvidia:    { name: "NVIDIA NIM (Nemotron 3 Ultra)", type: "openai",    base: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-ultra-550b-a55b", models: ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-4-340b-instruct", "meta/llama-3.1-70b-instruct"], info: "Clave GRATIS (sin tarjeta): build.nvidia.com → «Get API Key» (arriba a la derecha) → copia la clave «nvapi-…» y pégala abajo. ⚠️ NVIDIA bloquea las llamadas desde el navegador: solo responde cuando MOON LIGHT corre en tu PC (localhost:3000) con el servidor local abierto. En la web pública, puede darte «Failed to fetch»: es normal, usa otro cerebro." },
    openrouter: { name: "OpenRouter",       type: "openai",    base: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.1-8b-instruct:free", models: ["meta-llama/llama-3.1-8b-instruct:free", "deepseek/deepseek-chat-v3-0324:free", "moonshotai/kimi-k2-instruct:free", "nousresearch/hermes-3-llama-3.1-405b:free"], info: "Clave GRATIS: entra a openrouter.ai → Create account → Keys → Create Key. Usa modelos «*:free*»: al elegir uno con «:free» (gratis, sin saldo), OpenRouter contesta desde la web. Si usas un modelo de pago sin saldo da 402: selecciona uno con «:free»." },
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
    const providerDef = PROVIDERS[cfg.provider];
    const callWithModel = async (mdl) => {
      const body = { model: mdl, messages: history, temperature: 0.6, max_tokens: 2048 };
      const res = await fetchWithTimeout(effBase(cfg) + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(body)
      }, 45000);
      const raw = await res.text().catch(() => "");
      if (!res.ok) {
        const err = new Error("HTTP " + res.status + (raw ? " " + String(raw).slice(0, 140) : ""));
        err.status = res.status;
        throw err;
      }
      return JSON.parse(raw || "{}");
    };
    let j;
    try {
      j = await callWithModel(cfg.model);
    } catch (e) {
      if ((e.status === 404 || e.status === 400) && providerDef && providerDef.models && providerDef.models.length && cfg.model !== providerDef.model) {
        cfg.model = providerDef.model;
        for (const k of Object.keys(localStorage)) {
          if (k.indexOf("jarvis.api.") === 0) {
            try {
              const c = JSON.parse(localStorage.getItem(k) || "null");
              if (c && c.provider === cfg.provider) { c.model = cfg.model; localStorage.setItem(k, JSON.stringify(c)); }
            } catch {}
          }
        }
        moonSay("🔧 Tu modelo de **" + esc(providerDef.name) + "** estaba retirado (404): lo cambié **solo** al vigente **`" + esc(cfg.model) + "`** y lo guardé por ti. 😉");
        j = await callWithModel(cfg.model);
      } else throw e;
    }
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
          if (c && c.key && c.model) {
            const clean = String(c.key).replace(/[^\x20-\x7E]/g, "").trim();
            if (clean !== c.key) { c.key = clean; try { localStorage.setItem(k, JSON.stringify(c)); } catch {} }
            list.push(c);
          }
        }
      }
    } catch {}
    const main = getConfig();
    if (main && main.key && !list.some((c) => c.provider === main.provider)) list.unshift(main);
    return list;
  }
  const isLocalApp = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function brainOrder(q) {
    const team = teamConfigs();
    const code = /(codigo|program|script|funcion|matriz|debugar|debug|error de|correg|escribeme un|hazme un|python|javascript|html|css)/.test(q);
    // 🎯 APEX = NEMOTRON PRIMERO SIEMPRE (cerebro principal, responde rápido en tu PC).
    // En la web pública Nemotron da «Failed to fetch» (NVIDIA bloquea el navegador): es normal,
    // y entonces entra la reserva (Gemini/Groq/…) para que nunca te quede mudo.
    const wanted = code ? ["nvidia", "gemini", "groq", "openrouter"] : ["nvidia", "gemini", "groq", "openrouter"];
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

  const SYSTEM_MSG = { role: "system", content: `Eres MOON LIGHT, la inteligencia de un asistente personal tipo HUD futurista. Hablas español con naturalidad, como un "bro" que sabe mucho de tecnología. Conciso y directo: pocas palabras, golpes de humor, cero ñoñerías. Respondes de verdad (no pegas textos): primero razonas y luego respondes. Cuando el usuario pide programar, escribir código, explicar algo técnico o resolver un problema, lo haces al momento con el mejor enfoque posible, estilo ingeniero senior con actitud. Nunca te inventas cosas: si no sabes, lo dices. Firma emocional: cercano, ingenioso, con ganas de que el usuario logre lo que se propone.

CONTROL DEL (PC LOCAL) — cuando el usuario pida abrir algo, mirar su pantalla, escribir en una app o pulsar teclas, DEBES incluir en tu respuesta una línea con un marcador [[PC:acción:argumento]]. MOON LIGHT lo ejecuta SOLO tras pedir LUZ VERDE al usuario (nunca ejecutes sin su OK). Usos:
- [[PC:mirar:]] → capturar y ver la pantalla.
- [[PC:abrir:word]] → abrir programa/archivo/URL (word, excel, chrome, notepad, spotify, vscode, carpeta, https://…).
- [[PC:escribir:hola mundo]] → escribir ese texto en la app activa.
- [[PC:tecla:{ENTER}]] → pulsar tecla: {ENTER}, ^{c} = copiar, {TAB}, {F5}, {ESC}…
Además MOON LIGHT observa con cámara y puede reconocer gestos. Cuando el tema de la conversación lo sugiera (armadura medieval, cohetes, amores, casas…), genera un holograma proyectado en la consola marcando el tema con [[HOLO:caballero]] o [[HOLO:cohete]].
Los marcadores no se ven: los ejecuta el sistema, responde siempre al usuario con tu texto normal además de ellos.` };
  let history = [SYSTEM_MSG];

  async function answer(text, extras) {
    const userMsg = { role: "user", content: text };
    setStatus("PENSANDO", true);
    state.busy = true;
    try {
      if (typeof holoShow === "function") { try { holoShow(text); } catch {} } // holograma 3D de lo interpretado
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
      // 🖥️ MANDOS PC por intención: Nemotron escribe [[PC:acción:argumento]] y MOON LIGHT ejecuta (con luz verde)
      try { execPcMarkers(reply); } catch {}
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

  // Reducción (64x48) para hallar el CENTRO del movimiento de tu mano
  const ghostCv = document.createElement("canvas"); ghostCv.width = 64; ghostCv.height = 48;
  const gctx = ghostCv.getContext("2d", { willReadFrequently: true });
  let prevSmall = null, orbX = 0, orbY = 0, orbTX = 0, orbTY = 0;

  function detectMotion() {
    if (!state.camOn || video.readyState < 2) return requestAnimationFrame(detectMotion);
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    gctx.drawImage(video, 0, 0, ghostCv.width, ghostCv.height);
    const curSmall = gctx.getImageData(0, 0, ghostCv.width, ghostCv.height);
    if (!prevSmall) { prevSmall = curSmall; return requestAnimationFrame(detectMotion); }
    const d = curSmall.data, p = prevSmall.data;
    let diff = 0, sumX = 0, sumY = 0, cnt = 0;
    for (let y = 0; y < ghostCv.height; y++) {
      for (let x = 0; x < ghostCv.width; x++) {
        const i = (y * ghostCv.width + x) * 4;
        const dv = Math.abs(d[i] - p[i]) + Math.abs(d[i + 1] - p[i + 1]) + Math.abs(d[i + 2] - p[i + 2]);
        if (dv > 24) { diff += dv; sumX += x; sumY += y; cnt++; }
      }
    }
    prevSmall = curSmall;
    const score = diff / (ghostCv.width * ghostCv.height);
    const moving = score > 10 && cnt > 4;
    const now = Date.now();

    if (moving) {
      // Centro del cambio = posición aproximada de tu mano en la imagen
      const cx = sumX / cnt, cy = sumY / cnt;
      orbTX = (cx - ghostCv.width / 2) / (ghostCv.width / 2);
      orbTY = (cy - ghostCv.height / 2) / (ghostCv.height / 2);
      if (resting) { moveStart = now; resting = false; }
      const dur = now - moveStart;
      camStatus.textContent = dur > 2500 ? "MOVIMIENTO PROLONGADO 😮" : "MOVIMIENTO DETECTADO…";
    } else {
      orbTX = 0; orbTY = 0;
      if (!resting) {
        const dur = now - moveStart;
        resting = true;
        if (dur > 400 && dur <= 2600) {
          const norm = Math.sqrt(orbTX * orbTX + orbTY * orbTY);
          if (norm > 0.35) {
            const dir = Math.abs(orbTX) > Math.abs(orbTY)
              ? (orbTX > 0 ? "la derecha →" : "la izquierda ←")
              : (orbTY < 0 ? "arriba ↑" : "abajo ↓");
            onGesture("un movimiento de la mano hacia " + dir);
          } else {
            onGesture(dur < 1400 ? "un movimiento rápido de la mano (saludo/onda) 🙋" : "un gesto sostenido con la mano ✋");
          }
        }
      }
      camStatus.textContent = camIdle();
    }

    // El ORBE sigue el centro de tu mano (suavizado): se mueve ← ↑ ↓ →
    orbX += (orbTX - orbX) * 0.14;
    orbY += (orbTY - orbY) * 0.14;
    if (orbEl) orbEl.style.transform = `translate(${(orbX * 130).toFixed(1)}px, ${(orbY * 110).toFixed(1)}px)`;

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

  // ==================== ACCESO A TU PC + LUZ VERDE ====================
  const orbEl = $("earthCanvas") || document.querySelector(".orb");
  const holoCanvas = $("holoCanvas");
  let pendingAction = null;
  const lwOk = $("btnLightOk"), lwNo = $("btnLightNo"), lwBox = $("lightGreen");

  function askLightGreen(what, fn) {
    if (!lwBox) { fn(); return; }
    $("lightGreenWhat").textContent = what;
    lwBox.classList.remove("hidden");
    pendingAction = fn;
  }
  if (lwOk) lwOk.addEventListener("click", () => {
    lwBox.classList.add("hidden");
    const fn = pendingAction; pendingAction = null;
    if (fn) fn();
  });
  if (lwNo) lwNo.addEventListener("click", () => {
    lwBox.classList.add("hidden");
    pendingAction = null;
    moonSay("⛔ Ejecución cancelada. Sin luz verde no toco tu PC.");
  });

  async function pcCall(action, data) {
    const r = await fetch("/api/pc/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {})
    });
    return r.json();
  }

  async function moonSee(mode) {
    if (!isLocalApp) {
      moonSay("🖥️ Ver tu pantalla solo funciona en la app local (http://localhost:3000).");
      return;
    }
    const isWin = mode === "win";
    setStatus(isWin ? "CAPTURANDO VENTANA…" : "MIRANDO TU PANTALLA…");
    try {
      const j = await pcCall(isWin ? "seeWin" : "see");
      if (!j.image) throw new Error(j.error || "sin imagen");
      const img = document.createElement("img");
      img.src = "data:image/jpeg;base64," + j.image;
      img.className = "pcShot";
      addMsg("moon", img);
      moonSay(isWin ? "Aquí tienes tu ventana activa. Ya la veo." : "Tu pantalla, capturada. Ya la veo.");
    } catch (e) {
      moonSay("⚠️ No pude capturar: " + esc(String(e.message || e)));
    }
    setStatus("EN LÍNEA");
  }

  async function moonOpen(target) {
    if (!isLocalApp) { moonSay("🖥️ Abrir apps solo funciona en la app local."); return; }
    const t = String(target || "").trim();
    if (!t) return;
    askLightGreen("abrir «" + esc(t.slice(0, 40)) + "»", async () => {
      setStatus("ABRIENDO…");
      try {
        const j = await pcCall("open", { target: t });
        if (j.ok) moonSay("🚀 Abrí: `" + esc(t) + "`");
        else moonSay("⚠️ No pude abrir: " + esc(String(j.error || "")));
      } catch (e) { moonSay("⚠️ " + esc(String(e.message || e))); }
      setStatus("EN LÍNEA");
    });
  }

  async function moonType(text) {
    if (!isLocalApp) { moonSay("🖥️ Escribir solo funciona en la app local."); return; }
    const t = String(text || "");
    if (!t.trim()) return;
    askLightGreen("escribir «" + esc(t.slice(0, 40)) + "…»", async () => {
      setStatus("ESCRIBIENDO…");
      try {
        const j = await pcCall("type", { text: t });
        if (j.ok) moonSay("⌨️ Escrito.");
        else moonSay("⚠️ No pude escribir: " + esc(String(j.error || "")));
      } catch (e) { moonSay("⚠️ " + esc(String(e.message || e))); }
      setStatus("EN LÍNEA");
    });
  }

  async function moonKeys(text) {
    if (!isLocalApp) { moonSay("🖥️ Pulsar teclas solo funciona en la app local."); return; }
    const t = String(text || "").trim();
    if (!t) return;
    askLightGreen("pulsar «" + esc(t.slice(0, 30)) + "»", async () => {
      setStatus("PULSANDO TECLAS…");
      try {
        const j = await pcCall("keys", { text: t });
        if (j.ok) moonSay("🔑 Pulsado: `" + esc(t) + "`");
        else moonSay("⚠️ No pude pulsar: " + esc(String(j.error || "")));
      } catch (e) { moonSay("⚠️ " + esc(String(e.message || e))); }
      setStatus("EN LÍNEA");
    });
  }

  $("btnSee").addEventListener("click", () => moonSee("screen"));
  $("btnSeeWin").addEventListener("click", () => moonSee("win"));
  $("btnOpenApp").addEventListener("click", () => {
    const t = prompt("¿Qué abro? (programa, archivo, carpeta o URL — solo PC local)");
    if (t) moonOpen(t);
  });
  $("btnTypeKeys").addEventListener("click", () => {
    const t = prompt("¿Qué escribo? (solo PC local)");
    if (t) moonType(t);
  });
  $("btnKeySend").addEventListener("click", () => {
    const t = prompt("¿Qué tecla pulso? Ej: {ENTER}, ^{c}, {F5}, {TAB}…");
    if (t) moonKeys(t);
  });

  // Expone a Nemotron: puede NEGOCIAR estos mandos hablando
  window.moonPC = { see: moonSee, open: moonOpen, type: moonType, keys: moonKeys };

  // Detecta mandos [[PC:abrir:word]], [[PC:mirar]], [[PC:escribir:hola]], [[PC:tecla:{ENTER}]] en la respuesta de Nemotron
  function execPcMarkers(text) {
    const reHolo = /\[\[HOLO:([a-z]+)\]\]/gi;
    let mh;
    while ((mh = reHolo.exec(text))) {
      const t = mh[1].toLowerCase();
      if (SHAPES[t]) { HOLO.shape = SHAPES[t](); HOLO.theme = t; HOLO.on = true; HOLO.born = Date.now(); HOLO.t = 0; }
    }
    if (!isLocalApp) return; // solo la app local controla tu PC
    const re = /\[\[PC:(abrir|mirar|escribir|tecla|ver):([^\]]*)\]\]/gi;
    let m;
    let found = false;
    while ((m = re.exec(text))) {
      const what = m[1].toLowerCase();
      const arg = (m[2] || "").trim();
      found = true;
      if (what === "abrir" && arg) moonOpen(arg);
      else if (what === "escribir" && arg) moonType(arg);
      else if (what === "tecla" && arg) moonKeys(arg);
      else if (what === "mirar" || what === "ver") moonSee("screen");
    }
    if (found && !lwBox.classList.contains("hidden")) setStatus("LUZ VERDE…");
  }

  // ==================== MOTOR DE HOLOGRAMAS 3D ====================
  const hctx = holoCanvas ? holoCanvas.getContext("2d") : null;
  const HOLO = {
    shape: null, theme: "esfera", on: false, t: 0, born: 0, color: "80e0ff"
  };

  function holoResize() {
    if (!holoCanvas) return;
    const r = holoCanvas.getBoundingClientRect();
    holoCanvas.width = Math.max(100, r.width);
    holoCanvas.height = Math.max(100, r.height);
  }
  if (holoCanvas) { holoResize(); window.addEventListener("resize", holoResize); }

  // Formas procedimentales 3D (alambre)
  function sphere3D(r, segs) {
    const pts = [], edges = [];
    for (let i = 0; i <= segs; i++) {
      const phi = Math.PI * i / segs;
      for (let j = 0; j <= segs; j++) {
        const th = 2 * Math.PI * j / segs;
        pts.push([r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)]);
      }
    }
    for (let i = 0; i <= segs; i++) for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = i * (segs + 1) + j + 1, c = (i + 1) * (segs + 1) + j;
      edges.push([a, b]);
      if (i < segs) edges.push([a, c]);
    }
    return { pts, edges };
  }
  function box3D(s, ex = 1, ey = 1, ez = 1) {
    const pts = [], edges = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * s * ex, sy * s * ey, sz * s * ez]);
    const id = (x, y, z) => ((x + 1) / 2) * 4 + ((y + 1) / 2) * 2 + ((z + 1) / 2);
    const P = (sx, sy, sz) => pts[id(sx, sy, sz)];
    const pairs = [];
    for (const [a, b] of [[-1, 1]]) { void a; void b; }
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const p = pts[i], q = pts[j];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 2.01 * s) edges.push([i, j]);
    }
    return { pts, edges };
  }
  function knight3D() {
    const g = box3D(0.5, 0.9, 1.6, 0.75);
    const head = sphere3D(0.22, 8);
    const base = g.pts.length;
    for (const p of head.pts) g.pts.push([p[0], p[1] + 0.95, p[2]]);
    const oh = head.edges.length;
    for (let i = 0; i < head.pts.length; i++) for (let j = i + 1; j < head.pts.length; j++) {
      if (Math.abs(head.pts[i][0] - head.pts[j][0]) + Math.abs(head.pts[i][1] - head.pts[j][1]) + Math.abs(head.pts[i][2] - head.pts[j][2]) < 0.35) g.edges.push([base + i, base + j]);
    }
    // espada
    const es = g.pts.length;
    g.pts.push([0.65, 0.3, 0], [0.65, 1.1, 0], [0.64, 0.3, 0]);
    g.edges.push([es, es + 1], [es + 2, es + 1]);
    // escudo
    const ec = g.pts.length;
    g.pts.push([-0.75, 0.2, -0.3], [-0.75, -0.4, -0.3], [-0.75, 0.2, 0.3], [-0.75, -0.4, 0.3]);
    g.edges.push([ec, ec + 1], [ec + 1, ec + 3], [ec + 3, ec + 2], [ec + 2, ec]);
    return g;
  }
  function house3D() {
    const b = box3D(0.55, 1.1, 0.7, 1.1);
    const top = b.pts.length;
    b.pts.push([0, 0.75, 0], [0.75, 0.15, -0.75], [-0.75, 0.15, -0.75], [0.75, 0.15, 0.75], [-0.75, 0.15, 0.75]);
    b.edges.push([top, top + 1], [top, top + 2], [top, top + 3], [top, top + 4]);
    return b;
  }
  function rocket3D() {
    const b = sphere3D(0.7, 7);
    const nz = b.pts.length;
    b.pts.push([0, 1.1, 0]);
    for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
      const idx = i * 8 + j;
      if (b.pts[idx] && Math.abs(b.pts[idx][2] - 1) < 0.001) b.edges.push([]);
    }
    for (let i = 0; i < 8; i++) b.edges.push([i, nz]);
    const w = b.pts.length;
    b.pts.push([0.95, -0.15, 0], [-0.95, -0.15, 0], [0, -0.15, 0.95], [0, -0.15, -0.95]);
    b.edges.push([w, w + 1], [w + 2, w + 3]);
    return b;
  }

  const SHAPES = {
    esfera: () => ({ pts: sphere3D(0.85, 10).pts, edges: sphere3D(0.85, 10).edges, color: "#80e0ff" }),
    cubo: () => ({ pts: box3D(0.8).pts, edges: box3D(0.8).edges, color: "#ffd166" }),
    caballero: () => ({ ...knight3D(), color: "#9adcff" }),
    castillo: () => ({ ...knight3D(), color: "#c0a0ff" }),
    casa: () => ({ ...house3D(), color: "#7df0c0" }),
    cohete: () => ({ ...rocket3D(), color: "#ff9e6d" }),
    corazon: () => ({ pts: sphere3D(0.8, 9).pts, edges: sphere3D(0.8, 9).edges, color: "#ff6d9e" }),
    cristal: () => ({ pts: box3D(0.8).pts, edges: box3D(0.8).edges, color: "#bfff6d" }),
    galaxia: () => ({ pts: sphere3D(0.85, 10).pts, edges: sphere3D(0.85, 10).edges, color: "#a48cff" })
  };
  const KNIGHT_KEYS = /(armadura|caballero|medieval|castillo|espada|guerrero|lucha|caballeria|torneo|lanza|escudo)/i;
  const ROCKET_KEYS = /(cohete|luna|marte|planeta|espacio|volar|nave|estrella|galaxia|orbitar)/i;
  const HOME_KEYS = /(casa|hogar|habitacion|dormitorio|apartamento|edificio|cocina|sala)/i;
  const HEART_KEYS = /(corazon|amor|romance|querer|beso|pareja|novi)/i;
  const GLASS_KEYS = /(cristal|diamante|joya|hielo|vidrio|precioso)/i;

  function pickTheme(q) {
    if (KNIGHT_KEYS.test(q)) return "caballero";
    if (ROCKET_KEYS.test(q)) return "cohete";
    if (HOME_KEYS.test(q)) return "casa";
    if (HEART_KEYS.test(q)) return "corazon";
    if (GLASS_KEYS.test(q)) return "cristal";
    return Math.random() < 0.3 ? "cubo" : "esfera";
  }

  function holoShow(text) {
    if (!hctx) return;
    const q = String(text || "").toLowerCase();
    // Evita disparar por saludos genéricos
    if (/^(hola|buenas|hey|ok|gracias|perfecto|si|no)$/i.test(q.trim())) return;
    const theme = pickTheme(q);
    const shape = SHAPES[theme]();
    HOLO.shape = shape; HOLO.theme = theme; HOLO.on = true; HOLO.born = Date.now(); HOLO.t = 0;
    if (orbEl) { orbEl.classList.add("holoBoost"); setTimeout(() => orbEl.classList.remove("holoBoost"), 1500); }
  }

  function holoDraw() {
    requestAnimationFrame(holoDraw);
    if (!hctx || !HOLO.on || !HOLO.shape) return;
    const age = (Date.now() - HOLO.born) / 1000;
    if (age > 12) { HOLO.on = false; hctx.clearRect(0, 0, holoCanvas.width, holoCanvas.height); return; }
    const fade = age < 0.4 ? age / 0.4 : (age > 8 ? Math.max(0, 1 - (age - 8) / 4) : 1);
    HOLO.t += 0.012;
    holoResize();
    const w = holoCanvas.width, h = holoCanvas.height;
    hctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const S = Math.min(w, h) * 0.30;
    const { pts, edges, color } = HOLO.shape;
    const rotX = HOLO.t, rotY = HOLO.t * 0.7;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const proj = [];
    for (const [x, y, z] of pts) {
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      const persp = 2.2 / (2.2 + z2);
      proj.push([cx + x1 * S * persp, cy - y2 * S * persp, z2]);
    }
    hctx.strokeStyle = color;
    hctx.globalAlpha = 0.35 * fade;
    for (const [a, b] of edges) {
      const A = proj[a], B = proj[b];
      if (!A || !B) continue;
      const zm = (A[2] + B[2]) / 2;
      hctx.strokeStyle = color;
      hctx.globalAlpha = (0.18 + 0.5 * (1 - Math.min(1, Math.abs(zm)))) * fade;
      hctx.lineWidth = 1.1;
      hctx.beginPath(); hctx.moveTo(A[0], A[1]); hctx.lineTo(B[0], B[1]); hctx.stroke();
    }
    // puntos brillantes
    hctx.globalAlpha = 0.9 * fade;
    hctx.fillStyle = "#ffffff";
    for (const [px, py, pz] of proj) {
      if (pz > 0) { hctx.beginPath(); hctx.arc(px, py, 1.2, 0, Math.PI * 2); hctx.fill(); }
    }
    hctx.globalAlpha = fade;
    hctx.fillStyle = color;
    hctx.fillText("◉ " + HOLO.theme.toUpperCase(), 12, h - 16);
    hctx.globalAlpha = 1;
  }
  if (hctx) holoDraw();

  // ==================== PLANETA TIERRA GIRATORIO ====================
  const earthCv = $("earthCanvas");
  let earth = null;
  if (earthCv) {
    const E = 240; // resolución interna del planeta
    earthCv.width = E; earthCv.height = E;
    const ectx = earthCv.getContext("2d");

    // --- Textura equirectangular dibujada proceduralmente (lat/lon → x/y) ---
    const TW = 1024, TH = 512;
    const tex = document.createElement("canvas");
    tex.width = TW; tex.height = TH;
    const tctx = tex.getContext("2d");
    const ox = (lon) => ((lon + 180) / 360) * TW;
    const oy = (lat) => ((90 - lat) / 180) * TH;

    // Océano
    const og = tctx.createLinearGradient(0, 0, 0, TH);
    og.addColorStop(0, "#062b63"); og.addColorStop(0.5, "#0b4a9e"); og.addColorStop(1, "#063d8c");
    tctx.fillStyle = og; tctx.fillRect(0, 0, TW, TH);
    // Brillo oceánico
    const oceanGlow = tctx.createRadialGradient(TW / 2, TH / 2, 30, TW / 2, TH / 2, TH * 0.9);
    oceanGlow.addColorStop(0, "rgba(160,220,255,0.28)"); oceanGlow.addColorStop(1, "rgba(0,0,0,0)");
    tctx.fillStyle = oceanGlow; tctx.fillRect(0, 0, TW, TH);

    // Continentes (polígonos simplificados: [lon, lat])
    const conts = [
      // Norteamérica
      [[-168,66],[-156,71],[-140,72],[-124,73],[-112,72],[-98,74],[-84,70],[-76,62],[-70,60],[-64,50],[-56,45],[-60,40],[-66,38],[-66,44],[-60,48],[-64,52],[-72,50],[-76,55],[-80,60],[-85,64],[-78,66],[-78,60],[-72,58],[-74,52],[-70,50],[-66,46],[-62,42],[-58,38],[-54,36],[-64,30],[-74,28],[-76,22],[-82,20],[-86,22],[-90,20],[-96,16],[-102,18],[-106,22],[-108,26],[-110,31],[-116,34],[-120,38],[-118,34],[-124,40],[-128,44],[-134,48],[-140,54],[-140,56],[-146,60],[-152,62],[-160,64],[-166,66]],
      // Sudamérica
      [[-78,12],[-72,10],[-60,12],[-52,5],[-38,-4],[-44,-10],[-48,-18],[-54,-30],[-58,-42],[-64,-50],[-68,-52],[-70,-50],[-66,-44],[-64,-38],[-62,-30],[-64,-24],[-70,-16],[-76,-6],[-80,4],[-80,8]],
      // África
      [[-16,35],[-6,36],[8,37],[14,34],[20,32],[28,31],[36,21],[40,12],[45,12],[51,12],[48,0],[42,-8],[38,-22],[32,-34],[26,-35],[20,-35],[15,-28],[16,-15],[10,-5],[-2,0],[-10,4],[-14,12],[-12,20],[-17,28]],
      // Groenlandia
      [[-55,76],[-48,77],[-42,74],[-38,69],[-40,65],[-46,63],[-52,64],[-58,68],[-60,72]],
      // Eurasia
      [[-10,36],[-4,40],[4,42],[10,38],[16,39],[22,40],[28,41],[34,45],[40,46],[44,41],[40,38],[42,36],[50,35],[48,38],[50,42],[56,45],[58,49],[62,54],[68,57],[72,60],[78,62],[84,64],[90,66],[96,66],[102,68],[108,70],[114,72],[120,72],[126,68],[132,68],[138,66],[144,66],[150,64],[156,62],[162,60],[168,62],[170,66],[170,60],[166,58],[160,58],[156,60],[152,58],[148,56],[142,56],[138,58],[134,54],[130,52],[126,50],[122,48],[116,44],[112,40],[108,36],[104,34],[100,30],[96,26],[92,22],[88,24],[84,26],[80,24],[78,20],[74,18],[70,16],[66,12],[60,10],[56,12],[52,18],[48,24],[46,30],[50,34],[52,38],[48,40]],
      // Australia
      [[114,-21],[122,-17],[130,-15],[138,-14],[145,-17],[150,-22],[153,-28],[148,-36],[140,-38],[132,-36],[126,-32],[120,-28],[116,-26],[113,-23]],
      // Islas UK pequeñas, Japón, Madagascar, Nueva Zelanda (puntos)
    ];
    let ci = 0;
    for (const c of conts) {
      ci++;
      const fill = ci === 5
        ? "#4c9a3f"
        : (ci === 3 ? "#6fae52" : (ci === 1 || ci === 2 ? "#3f8f3a" : "#7aae4a"));
      tctx.beginPath();
      c.forEach(([lon, lat], i) => { const x = ox(lon), y = oy(lat); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); });
      tctx.closePath();
      tctx.fillStyle = fill;
      tctx.fill();
      tctx.strokeStyle = "rgba(0,40,20,0.55)"; tctx.lineWidth = 2; tctx.stroke();
      // relieve sutil
      tctx.fillStyle = "rgba(255,255,255,0.10)";
      tctx.fill();
    }
    // Detalles: Japón, UK, Madagascar, N. Zelanda
    const dot = (lon, lat, r) => { tctx.beginPath(); tctx.arc(ox(lon), oy(lat), r, 0, Math.PI * 2); tctx.fillStyle = "#4c9a3f"; tctx.fill(); };
    dot(139, 37, 9); dot(143, 42, 6); dot(-3, 54, 7); dot(47, -19, 9); dot(174, -40, 10); dot(172, -35, 7); dot(55, -26, 4);
    // Casquetes polares
    tctx.fillStyle = "rgba(235,245,255,0.92)";
    tctx.beginPath(); tctx.rect(0, 0, TW, 18); tctx.rect(0, TH - 22, TW, 22); tctx.fill();
    tctx.globalAlpha = 0.5; tctx.beginPath(); tctx.rect(0, 18, TW, 12); tctx.rect(0, TH - 34, TW, 12); tctx.fill(); tctx.globalAlpha = 1;

    // --- Raycasting esférico (verdadera esfera girando) ---
    const PIX = ectx.createImageData(E, E);
    const texData = tctx.getImageData(0, 0, TW, TH).data;
    let rot = 0;
    function drawEarth() {
      ectx.putImageData(PIX, 0, 0); // limpia con transparente
      const R = E / 2;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      for (let py = 0; py < E; py++) {
        for (let px = 0; px < E; px++) {
          // vector esfera unitario con eje Y arriba
          const nx = (px - R) / R;
          const ny = -(py - R) / R;
          if (nx * nx + ny * ny > 1) continue; // fuera del disco
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          // rotar alrededor del eje Y (spins)
          const rx = nx * cosR + nz * sinR;
          const rz = -nx * sinR + nz * cosR;
          // mapear a textura equirectangular (punta del vector en esfera unidad)
          const lon = Math.atan2(rz, rx) * 180 / Math.PI;   // -180..180
          const lat = Math.asin(ny) * 180 / Math.PI;         // -90..90
          let u = Math.round((lon + 180) / 360 * TW) % TW;
          let v = Math.round((90 - lat) / 180 * TH) % TH;
          if (u < 0) u += TW; if (v < 0) v += TH;
          const ti = (v * TW + u) * 4;
          // shade esférica (iluminado desde la derecha del sol)
          const shade = Math.max(0, rx); // luz en +x
          const light = 0.5 + 0.5 * shade;
          const idx = (py * E + px) * 4;
          PIX.data[idx] = texData[ti] * light;
          PIX.data[idx + 1] = texData[ti + 1] * light;
          PIX.data[idx + 2] = texData[ti + 2] * light;
          PIX.data[idx + 3] = 255;
        }
      }
      ectx.putImageData(PIX, 0, 0);
      // halo exterior
      const gr = ectx.createRadialGradient(R, R, R * 0.5, R, R, R);
      gr.addColorStop(0, "rgba(120,180,255,0.0)"); gr.addColorStop(0.85, "rgba(120,180,255,0.0)"); gr.addColorStop(1, "rgba(160,210,255,0.28)");
      ectx.fillStyle = gr; ectx.beginPath(); ectx.arc(R, R, R, 0, Math.PI * 2); ectx.fill();
      rot += 0.004; // velocidad de giro
      requestAnimationFrame(drawEarth);
    }
    requestAnimationFrame(drawEarth);

    // El orbe de la cámara deja de ser el orbe dorado; ahora el planeta TIERRA sigue la mano
    window.__earth = {
      boost() {
        earthCv.style.boxShadow = "0 0 120px 30px rgba(120,200,255,0.5), 0 0 220px 80px rgba(90,150,255,0.25)";
        setTimeout(() => { if (earthCv) earthCv.style.boxShadow = "0 0 90px 20px rgba(80,160,255,0.25), 0 0 170px 60px rgba(60,120,255,0.12)"; }, 1400);
      }
    };
  }

  // En cada mensaje del usuario (escrito o por voz), MOON LIGHT piensa el holograma
  const holoOrigCall = callAI;
  window.__holoThink = function () {};

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
  $("btnSweep").addEventListener("click", async () => {
    const team = teamConfigs();
    if (!team.length) { alert("No hay cerebros guardados. Guarda claves en «Configurar» primero."); return; }
    moonSay("🩺 Probando los " + team.length + " cerebros del APEX uno por uno…");
    const lines = ["**Resultado de cada cerebro:**"];

    const laneTest = async (cfg) => {
      const name = brainLaneName(cfg);
      const started = Date.now();
      moonSay("⏳ Probando **" + esc(name) + "**…");
      try {
        const r = await Promise.race([
          (async () => {
            try { return await runCfg(cfg, [{ role: "user", content: "Responde solo: OK" }]); }
            catch (e) { throw e; }
          })(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("Agotado el tiempo (12 s)")), 12000))
        ]);
        lines.push("✅ **" + esc(name) + "** → " + (r ? "OK" : "respuesta vacía") + " (" + (Date.now() - started) + " ms)");
      } catch (e) {
        lines.push("❌ **" + esc(name) + "** → " + esc(String(e.message || e)) + " (" + (Date.now() - started) + " ms)");
      }
    };
    for (const cfg of team) await laneTest(cfg);
    lines.push("\n*Si algo sale ❌, dime qué dice y lo arreglo al momento.*");
    moonSay(lines.join("\n"));
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