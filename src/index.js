const SYSTEM_PROMPT = `Eres NutriBot, un asistente personal de nutrición experto y amigable. Tu misión es ayudar al usuario a registrar su alimentación diaria, ejercicio y llevar un control calórico preciso.

CAPACIDADES:
- Analizar alimentos por descripción de texto o imágenes (fotos de platos, empaques, etc.)
- Estimar calorías y macronutrientes (proteínas, carbohidratos, grasas) con precisión realista
- Registrar ejercicios y calcular calorías quemadas aproximadas
- Interpretar conteo de pasos y convertirlos en calorías (~0.04 kcal/paso)
- Responder preguntas de nutrición con precisión científica

FORMATO DE RESPUESTA OBLIGATORIO — siempre responde en JSON válido:
{
  "message": "tu respuesta conversacional en español, amigable y con emojis",
  "action": "log_food" | "log_exercise" | "log_steps" | "set_config" | "delete_last" | "query" | null,
  "data": { ... }
}

Para log_food:
"data": { "name": "nombre", "calories": número, "protein": gramos, "carbs": gramos, "fat": gramos, "portion": "ej: 1 plato mediano ~300g" }

Para log_exercise:
"data": { "type": "ejercicio", "duration": minutos, "calories_burned": número }

Para log_steps:
"data": { "steps": número, "calories_burned": número }

Para set_config (cuando el usuario da su nombre o meta calórica):
"data": { "name": "nombre", "goal_calories": número, "goal_protein": número }

Para delete_last o query: omite "data"

REGLAS:
1. Al registrar alimento incluye siempre: 🔥 Calorías: ~XXX kcal | 💪 Prot: Xg | 🍚 Carbos: Xg | 🥑 Grasas: Xg
2. Sé motivador. Si el usuario supera su meta, sugiere opciones saludables.
3. Para imágenes: identifica el plato y estima porción visual realista.
4. "borra", "elimina lo último", /borrar → action: "delete_last"
5. Resumen/balance/"¿cuánto llevo?" → usa contexto del día, action: null
6. Responde ÚNICAMENTE en JSON.

ONBOARDING (solo cuando veas [USUARIO NUEVO]):
- Saluda con entusiasmo y preséntate brevemente
- Explica en 2 líneas qué puedes hacer
- Pregunta nombre y meta calórica diaria
- action: null en la bienvenida`;

// ─── Entry point ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== '/webhook') {
      return new Response('NutriBot activo 🥦', { status: 200 });
    }

    // Verificación del webhook (Meta llama esto al configurarlo)
    if (request.method === 'GET') {
      const mode      = url.searchParams.get('hub.mode');
      const token     = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Unauthorized', { status: 403 });
    }

    // Mensaje entrante
    if (request.method === 'POST') {
      const body = await request.json();
      ctx.waitUntil(processWebhook(body, env));
      return new Response('OK', { status: 200 }); // Meta necesita 200 rápido
    }

    return new Response('Method not allowed', { status: 405 });
  },
};

// ─── Procesamiento principal ──────────────────────────────────────────────────

async function processWebhook(body, env) {
  try {
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    const from    = message.from;
    const msgType = message.type;
    if (!['text', 'image'].includes(msgType)) return;

    // Marcar como leído
    await markRead(message.id, env);

    // Cargar contexto del usuario en paralelo
    const [newUser, summary, config] = await Promise.all([
      isNewUser(env.DB, from),
      getTodaySummary(env.DB, from),
      getUserConfig(env.DB, from),
    ]);

    let text      = '';
    let imageData = null;

    if (msgType === 'text') {
      text = message.text.body;
    } else {
      text      = message.image?.caption || 'Analiza este alimento';
      imageData = await downloadMedia(message.image.id, env.META_TOKEN);
    }

    // Llamar a Gemini
    const ai = await callGemini(text, imageData, summary, config, newUser, env.GEMINI_API_KEY);

    // Ejecutar acción en BD
    switch (ai.action) {
      case 'log_food':
        if (ai.data) await logFood(env.DB, from, ai.data);
        break;
      case 'log_exercise':
        if (ai.data) await logExercise(env.DB, from, ai.data);
        break;
      case 'log_steps':
        if (ai.data) await logExercise(env.DB, from, {
          type: 'pasos', duration: 0,
          calories_burned: ai.data.calories_burned || 0,
          steps: ai.data.steps || 0,
        });
        break;
      case 'set_config':
        if (ai.data) await setUserConfig(env.DB, from, ai.data);
        break;
      case 'delete_last':
        await deleteLastFood(env.DB, from);
        break;
    }

    // Delay humano: 5-12s según largo del mensaje
    const delay = Math.min(12000, Math.max(5000, 1500 + (ai.message || '').length * 35));
    await sleep(delay);

    await sendWhatsAppMessage(from, ai.message || '✅', env);
  } catch (err) {
    console.error('Error en processWebhook:', err);
  }
}

// ─── Meta API ─────────────────────────────────────────────────────────────────

async function markRead(messageId, env) {
  await fetch(`https://graph.facebook.com/v20.0/${env.META_PHONE_NUMBER_ID}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${env.META_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
}

async function sendWhatsAppMessage(to, text, env) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.META_PHONE_NUMBER_ID}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${env.META_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  if (!res.ok) console.error('Meta send error:', await res.text());
}

async function downloadMedia(mediaId, token) {
  const urlRes  = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { url, mime_type } = await urlRes.json();

  const mediaRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer   = await mediaRes.arrayBuffer();

  return { base64: arrayBufferToBase64(buffer), mimeType: mime_type || 'image/jpeg' };
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─── Gemini API (via fetch directo, compatible con Workers) ──────────────────

async function callGemini(userText, imageData, summary, config, newUser, apiKey) {
  const prompt = buildContextPrompt(userText, summary, config, newUser);

  const parts = [{ text: prompt }];
  if (imageData) parts.push({ inlineData: { data: imageData.base64, mimeType: imageData.mimeType } });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:          [{ role: 'user', parts }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig:  { responseMimeType: 'application/json', temperature: 0.65, maxOutputTokens: 1024 },
      }),
    }
  );

  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try   { return JSON.parse(raw); }
  catch { return { message: raw, action: null }; }
}

function buildContextPrompt(userMessage, summary, config, newUser) {
  const { foodTotals, exerciseTotals, foods, exercises, date } = summary;
  const net = Math.round(foodTotals.calories - exerciseTotals.calories_burned);

  const foodList = foods.length
    ? foods.map(f => `  • ${f.portion ? f.portion + ' de ' : ''}${f.name}: ${Math.round(f.calories)} kcal`).join('\n')
    : '  (sin registros)';

  const exerciseList = exercises.length
    ? exercises.map(e => e.steps > 0
        ? `  • ${e.steps.toLocaleString()} pasos → ${Math.round(e.calories_burned)} kcal`
        : `  • ${e.type} ${e.duration}min → ${Math.round(e.calories_burned)} kcal`
      ).join('\n')
    : '  (sin registros)';

  const header = newUser ? '[USUARIO NUEVO — saluda y haz onboarding]\n' : '';

  return `${header}[CONTEXTO DEL DÍA — ${date}]
Usuario: ${config.name || 'sin nombre aún'}
Meta calórica: ${config.goal_calories} kcal | Meta proteína: ${config.goal_protein}g
Consumido: ${Math.round(foodTotals.calories)} kcal (P:${Math.round(foodTotals.protein)}g C:${Math.round(foodTotals.carbs)}g F:${Math.round(foodTotals.fat)}g)
Alimentos:
${foodList}
Actividad:
${exerciseList}
Calorías quemadas: ${Math.round(exerciseTotals.calories_burned)} kcal | Pasos: ${exerciseTotals.steps.toLocaleString()}
Balance neto: ${net} kcal
---
Mensaje: ${userMessage}`;
}

// ─── Base de datos (Cloudflare D1) ───────────────────────────────────────────

async function isNewUser(db, userId) {
  const r = await db.prepare('SELECT 1 FROM user_config WHERE user_id = ?').bind(userId).first();
  return !r;
}

async function getUserConfig(db, userId) {
  const r = await db.prepare('SELECT * FROM user_config WHERE user_id = ?').bind(userId).first();
  return r || { user_id: userId, goal_calories: 2000, goal_protein: 150, name: null };
}

async function setUserConfig(db, userId, data) {
  await db.prepare(`
    INSERT INTO user_config (user_id, name, goal_calories, goal_protein) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name          = COALESCE(excluded.name, name),
      goal_calories = COALESCE(excluded.goal_calories, goal_calories),
      goal_protein  = COALESCE(excluded.goal_protein, goal_protein)
  `).bind(userId, data.name || null, data.goal_calories || null, data.goal_protein || null).run();
}

async function getTodaySummary(db, userId) {
  const today = new Date().toISOString().split('T')[0];
  const [f, e] = await Promise.all([
    db.prepare('SELECT * FROM food_log     WHERE user_id = ? AND date = ? ORDER BY timestamp').bind(userId, today).all(),
    db.prepare('SELECT * FROM exercise_log WHERE user_id = ? AND date = ? ORDER BY timestamp').bind(userId, today).all(),
  ]);

  const foods     = f.results || [];
  const exercises = e.results || [];

  const foodTotals = foods.reduce(
    (a, x) => ({ calories: a.calories + x.calories, protein: a.protein + x.protein, carbs: a.carbs + x.carbs, fat: a.fat + x.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const exerciseTotals = exercises.reduce(
    (a, x) => ({ calories_burned: a.calories_burned + x.calories_burned, steps: a.steps + x.steps }),
    { calories_burned: 0, steps: 0 }
  );

  return { foods, exercises, foodTotals, exerciseTotals, date: today };
}

async function logFood(db, userId, data) {
  await db.prepare(
    'INSERT INTO food_log (user_id, name, calories, protein, carbs, fat, portion) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(userId, data.name, data.calories || 0, data.protein || 0, data.carbs || 0, data.fat || 0, data.portion || '').run();
}

async function logExercise(db, userId, data) {
  await db.prepare(
    'INSERT INTO exercise_log (user_id, type, duration, calories_burned, steps) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, data.type, data.duration || 0, data.calories_burned || 0, data.steps || 0).run();
}

async function deleteLastFood(db, userId) {
  const last = await db.prepare('SELECT id FROM food_log WHERE user_id = ? ORDER BY id DESC LIMIT 1').bind(userId).first();
  if (last) await db.prepare('DELETE FROM food_log WHERE id = ?').bind(last.id).run();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
