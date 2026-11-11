import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeAndroidString,
  escapeGradleString,
  escapeJavaString,
  escapeXmlAttribute,
  escapeXmlText
} from '../builders/codegen.js';

test('XML text escaping handles markup characters', () => {
  assert.equal(escapeXmlText('Ben & Jerry <b>'), 'Ben &amp; Jerry &lt;b&gt;');
  // Text nodes keep quotes literal; only attributes need entity encoding.
  assert.equal(escapeXmlText('a "quoted" \'value\''), 'a "quoted" \'value\'');
});

test('XML attribute escaping encodes quotes and flattens line breaks', () => {
  assert.equal(escapeXmlAttribute('a"b\'c<d>&e'), 'a&quot;b&apos;c&lt;d&gt;&amp;e');
  assert.equal(escapeXmlAttribute('line one\nline two'), 'line one line two');
  assert.equal(escapeXmlAttribute('tab\there'), 'tab here');
});

test('Android string resources combine aapt escapes with XML escaping', () => {
  assert.equal(escapeAndroidString("Ben & Jerry's"), 'Ben &amp; Jerry\\\'s');
  assert.equal(escapeAndroidString('say "hi"'), 'say \\"hi\\"');
  assert.equal(escapeAndroidString('C:\\path'), 'C:\\\\path');
  // A leading @ or ? would be read as a resource reference.
  assert.equal(escapeAndroidString('@string/other'), '\\@string/other');
  assert.equal(escapeAndroidString('?attr/thing'), '\\?attr/thing');
});

test('Java string escaping covers quotes, backslashes and control characters', () => {
  assert.equal(escapeJavaString('a"b'), 'a\\"b');
  assert.equal(escapeJavaString('C:\\path'), 'C:\\\\path');
  assert.equal(escapeJavaString('line\nbreak'), 'line\\nbreak');
  assert.equal(escapeJavaString('tab\there'), 'tab\\there');
  assert.equal(escapeJavaString('\u2028'), '\\u2028');
  assert.equal(escapeJavaString('a & b'), 'a & b');
});

test('Gradle escaping respects the quote style and GString interpolation', () => {
  assert.equal(escapeGradleString("O'Brien"), "O\\'Brien");
  assert.equal(escapeGradleString("O'Brien", '"'), "O'Brien");
  assert.equal(escapeGradleString('a"b', '"'), 'a\\"b');
  assert.equal(escapeGradleString('cost $5', '"'), 'cost \\$5');
  assert.equal(escapeGradleString('C:\\dir'), 'C:\\\\dir');
  assert.equal(escapeGradleString('one\ntwo'), 'one two');
});

test('the escaping helpers are not interchangeable', () => {
  const value = 'a"b<c>&d\'e\nf$g\\h';
  const results = new Set([
    escapeXmlText(value),
    escapeXmlAttribute(value),
    escapeAndroidString(value),
    escapeJavaString(value),
    escapeGradleString(value),
    escapeGradleString(value, '"')
  ]);
  assert.equal(results.size, 6, 'each context must produce different output');
});
