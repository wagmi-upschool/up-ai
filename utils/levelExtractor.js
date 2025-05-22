export function extractSqlLevel(text) {
  if (typeof text !== "string" || text.trim() === "") {
    console.log(
      "extractSqlLevel: Input text is not a valid string or is empty. Returning null."
    );
    return null;
  }

  let lowerCaseText = text.toLowerCase();
  // Normalize the dotted 'i' (resulting from 'İ'.toLowerCase()) to a simple 'i' for matching
  lowerCaseText = lowerCaseText.replace(/i\u0307/g, "i");

  if (lowerCaseText.includes("yeni başlayan")) {
    return "beginner";
  } else if (lowerCaseText.includes("orta seviye")) {
    return "intermediate";
  } else if (lowerCaseText.includes("ileri seviye")) {
    return "advanced";
  }
  console.log(
    `extractSqlLevel: No specific level found in text: "${text.substring(
      0,
      100
    )}...". Returning null.`
  );
  return null;
}
