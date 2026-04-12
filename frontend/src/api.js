const BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

function headers(token) {
  const h = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Auth
export const signup = (email, password, target_language, level = 1) =>
  request("/auth/signup", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password, target_language, level }),
  });

export const updateProfile = (token, updates) =>
  request("/profile", {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(updates),
  });

export const login = (email, password) =>
  request("/auth/login", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });

// Chat
export const sendMessage = (token, messages, profile, sourceText, weakWords) =>
  request("/chat", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      messages,
      profile,
      source_text: sourceText,
      weak_words: weakWords,
    }),
  });

// Vocab
export const getWeakWords = (token) =>
  request("/vocab/weak?limit=8", { headers: headers(token) });

export const recordClick = (token, word_native, word_english, language) =>
  request("/vocab/record-click", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ word_native, word_english, language }),
  });

export const recordSeenBatch = (token, words) =>
  request("/vocab/record-seen-batch", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ words }),
  });

export const getVocab = (token) =>
  request("/vocab", { headers: headers(token) });

export const recordAnswer = (token, word_native, word_english, language, correct) =>
  request("/vocab/record-answer", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ word_native, word_english, language, correct }),
  });
