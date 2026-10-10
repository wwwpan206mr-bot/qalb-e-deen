import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "qalb-e-deen-b765a";
const apiKey = process.env.HADITH_API_KEY;

if (!apiKey) throw new Error("Missing HADITH_API_KEY GitHub secret.");

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}
const db = getFirestore();

const url = new URL("https://www.hadithapi.com/api/hadiths/");
url.searchParams.set("apiKey", apiKey);
url.searchParams.set("paginate", "200");

const response = await fetch(url, { headers: { accept: "application/json" } });
if (!response.ok) throw new Error(`HadithAPI returned HTTP ${response.status}`);
const payload = await response.json();

function findRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "hadiths", "results", "items"]) {
    const rows = findRows(value[key]);
    if (rows.length) return rows;
  }
  return [];
}

const rows = findRows(payload);
if (!rows.length) {
  throw new Error("No hadith rows found in API response. Check API response structure/API key.");
}

function str(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function nested(obj, path) {
  return path.split(".").reduce((v, k) => v?.[k], obj);
}

let written = 0;
const batch = db.batch();
const collection = db.collection("hadiths");

for (const row of rows) {
  const number = str(row.hadithNumber, row.hadith_number, row.number, row.id);
  const book = str(
    nested(row, "book.bookName"),
    nested(row, "book.name"),
    row.bookName,
    row.book,
    "HadithAPI"
  );
  const arabic = str(row.hadithArabic, row.hadith_arabic, row.arabic, row.arabicText);
  const english = str(row.hadithEnglish, row.hadith_english, row.english, row.englishText, row.translation);

  if (!arabic && !english) continue;

  const stableId = `hadithapi_${book.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${number || written + 1}`;
  const ref = collection.doc(stableId);
  batch.set(ref, {
    title: `${book}${number ? " — Hadith " + number : ""}`,
    arabic,
    translation: english,
    translationLanguage: "English",
    transliteration: "",
    englishPronunciation: "",
    explanation: "",
    lesson: "",
    source: book,
    hadithNumber: number,
    apiSource: "HadithAPI",
    active: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  written++;
}

if (!written) throw new Error("API response contained no usable Arabic/English hadith text.");
await batch.commit();
console.log(`Synced ${written} HadithAPI records into Firestore collection hadiths.`);
