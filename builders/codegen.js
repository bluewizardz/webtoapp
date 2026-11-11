// Context-specific escaping for generated source files.
//
// Each file format needs its own rules: an ampersand is `&amp;` in XML but stays
// literal in Java, a quote is `\"` in Java and `\'` in a Gradle single-quoted
// string, and Android string resources need their own escape sequences on top of
// XML. Never replace these with a single "escape everything" helper.

const XML_TEXT = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const XML_ATTRIBUTE = { ...XML_TEXT, '"': "&quot;", "'": "&apos;" };

const JAVA_ESCAPES = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f"
};

/** Escape a value for XML character data (element text). */
export function escapeXmlText(value) {
  return String(value ?? "").replace(/[&<>]/g, (character) => XML_TEXT[character]);
}

/**
 * Escape a value for an XML attribute. Control characters and line breaks are
 * invalid or normalised away inside attributes, so they become spaces.
 */
export function escapeXmlAttribute(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[&<>"']/g, (character) => XML_ATTRIBUTE[character]);
}

/**
 * Escape a value used as an Android resource string (`<string>` values and
 * `android:text` attributes). Runs aapt's escape sequences over the raw value
 * first, then XML-escapes the result for the file itself.
 */
export function escapeAndroidString(value) {
  let text = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  // A leading @ or ? would be read as a resource or attribute reference. This
  // runs after backslash escaping so the added escape is not escaped itself.
  if (/^[@?]/.test(text)) {
    text = `\\${text}`;
  }
  return escapeXmlText(text);
}

/** Escape a value for a Java string literal. */
export function escapeJavaString(value) {
  return String(value ?? "").replace(
    /[\\"\u0000-\u001F\u007F\u2028\u2029]/g,
    (character) =>
      JAVA_ESCAPES[character] ||
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/**
 * Escape a value for a Gradle string literal.
 * @param {string} value
 * @param {"'"|'"'} quote - the quote character the literal is wrapped in.
 */
export function escapeGradleString(value, quote = "'") {
  const text = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]/g, " ");
  if (quote === "'") {
    return text.replace(/'/g, "\\'");
  }
  // Double-quoted Gradle strings interpolate $, single-quoted ones do not.
  return text.replace(/"/g, '\\"').replace(/\$/g, "\\$");
}
