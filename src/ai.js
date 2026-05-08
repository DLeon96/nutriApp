import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const SYSTEM_PROMPT = `Eres NutriBot, un asistente personal de nutrición experto y amigable. Tu misión es ayudar al usuario a registrar su alimentación diaria, ejercicio y llevar un control calórico preciso.

CAPACIDADES:
- Analizar alimentos por descripción de texto o imágenes (fotos de platos, empaques, etc.)
- Estimar calorías y macronutrientes (proteínas, carbohidratos, grasas) con precisión realista
- Registrar ejercicios y calcular calorías quemadas aproximadas
- Interpretar conteo de pasos y convertirlos en calorías quemadas (~0.04 kcal/paso)
- Responder preguntas de nutrición con precisión científica
- Procesar el comando /borrar para eliminar el último registro

FORMATO DE RESPUESTA OBLIGATORIO — siempre responde en JSON válido con esta estructura:
{
  "message": "tu respuesta conversacional en español, amigable y con emojis",
  "action": "log_food" | "log_exercise" | "log_steps" | "delete_last" | "query" | null,
  "data": { ... }
}

Para log_food:
"data": { "name": "nombre completo del alimento", "calories": número, "protein": gramos, "carbs": gramos, "fat": gramos, "portion": "ej: 1 plato mediano ~300g" }

Para log_exercise:
"data": { "type": "nombre del ejercicio", "duration": minutos, "calories_burned": número }

Para log_steps:
"data": { "steps": número, "calories_burned": número }

Para delete_last o query: omite "data"

REGLAS DE COMPORTAMIENTO:
1. Cuando registres un alimento, el mensaje DEBE incluir:
   🔥 Calorías: ~XXX kcal | 💪 Prot: Xg | 🍚 Carbos: Xg | 🥑 Grasas: Xg
2. Sé motivador pero honesto. Si el usuario supera su meta calórica, menciona opciones saludables para el resto del día.
3. Para imágenes de comida: identifica el plato principal y estima una porción visual realista.
4. Si el usuario dice "borré", "borra", "elimina lo último" o /borrar → action: "delete_last"
5. Si el usuario pide resumen, balance o "¿cuánto llevo?" → usa el contexto del día proporcionado y responde con action: null
6. Responde ÚNICAMENTE en JSON. Nada de texto fuera del JSON.`;

// Historial de conversación por usuario (últimas 10 rondas)
const histories = new Map();

function getModel() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.65,
      maxOutputTokens: 1024,
    },
  });
}

function getHistory(userId) {
  if (!histories.has(userId)) histories.set(userId, []);
  return histories.get(userId);
}

function pushHistory(userId, role, text) {
  const hist = getHistory(userId);
  hist.push({ role, parts: [{ text }] });
  if (hist.length > 20) hist.splice(0, 2); // descarta el par más antiguo
}

function buildContextPrompt(userMessage, summary, config) {
  const { foodTotals, exerciseTotals, foods, exercises, date } = summary;
  const net = Math.round(foodTotals.calories - exerciseTotals.calories_burned);

  const foodList = foods.length
    ? foods.map(f => `  • ${f.portion ? f.portion + ' de ' : ''}${f.name}: ${Math.round(f.calories)} kcal`).join('\n')
    : '  (sin registros)';

  const exerciseList = exercises.length
    ? exercises.map(e =>
        e.steps > 0
          ? `  • ${e.steps.toLocaleString()} pasos → ${Math.round(e.calories_burned)} kcal`
          : `  • ${e.type} ${e.duration}min → ${Math.round(e.calories_burned)} kcal`
      ).join('\n')
    : '  (sin registros)';

  return `[CONTEXTO DEL DÍA — ${date}]
Meta calórica: ${config.goal_calories} kcal | Meta proteína: ${config.goal_protein}g
Consumido: ${Math.round(foodTotals.calories)} kcal (P:${Math.round(foodTotals.protein)}g C:${Math.round(foodTotals.carbs)}g F:${Math.round(foodTotals.fat)}g)
Alimentos registrados:
${foodList}
Actividad física:
${exerciseList}
Calorías quemadas: ${Math.round(exerciseTotals.calories_burned)} kcal | Pasos: ${exerciseTotals.steps.toLocaleString()}
Balance neto: ${net} kcal
---
Mensaje del usuario: ${userMessage}`;
}

export async function processMessage({ userId, text, imageBuffer, imageMime, summary, config }) {
  const contextPrompt = buildContextPrompt(text || '(imagen)', summary, config);

  const model   = getModel();
  const history = getHistory(userId);
  const chat    = model.startChat({ history });

  let result;
  if (imageBuffer) {
    result = await chat.sendMessage([
      contextPrompt,
      { inlineData: { data: imageBuffer.toString('base64'), mimeType: imageMime || 'image/jpeg' } },
    ]);
  } else {
    result = await chat.sendMessage(contextPrompt);
  }

  const raw = result.response.text();

  pushHistory(userId, 'user',  contextPrompt);
  pushHistory(userId, 'model', raw);

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw, action: null };
  }
}
