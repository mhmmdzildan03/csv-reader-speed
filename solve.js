// Fast drop-in replacement for csv-reader 1.0.0.
//
// Same reading, byte for byte, as the reference: broken rows, stray CRs,
// quote junk and unterminated quotes all produce the same {columns, rows,
// errors}. The reference builds every field one character at a time; this
// reader instead jumps between delimiters with indexOf and slices each
// clean run of characters out of the text in one piece, so the common
// field costs one native search per delimiter kind and one slice. The
// rare broken paths (a stray CR inside a field, a doubled quote, a CR
// inside quotes, junk after a closing quote) fall back to assembling the
// field from parts, in exactly the order the reference meets them.
//
// Pure: no state is kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `initial` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr). `added` counts
  // the characters kept beyond `initial`.
  function readUnquoted(initial) {
    let start = pos;
    let parts = null;
    let added = 0;
    while (true) {
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let i = n;
      let kind = -1;
      if (iC !== -1 && iC < i) { i = iC; kind = COMMA; }
      if (iN !== -1 && iN < i) { i = iN; kind = LINE_BREAK; }
      if (iR !== -1 && iR < i) { i = iR; kind = 3; }
      if (kind === -1) {
        pos = n;
        if (parts !== null) {
          parts.push(text.slice(start, n));
          added += n - start;
          return { value: parts.join(''), ended: END, added };
        }
        const seg = text.slice(start, n);
        return { value: initial ? initial + seg : seg, ended: END, added: seg.length };
      }
      if (kind === 3 && text.charCodeAt(i + 1) !== 10) {
        // A stray CR: dropped, the field goes on.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) {
          parts = [];
          if (initial) parts.push(initial);
        }
        parts.push(text.slice(start, i));
        added += i - start;
        pos = i + 1;
        start = pos;
        continue;
      }
      // Comma, LF, or CRLF: the field ends here.
      let value;
      if (parts !== null) {
        parts.push(text.slice(start, i));
        added += i - start;
        value = parts.join('');
      } else {
        const seg = text.slice(start, i);
        value = initial ? initial + seg : seg;
        added = seg.length;
      }
      if (kind === COMMA) {
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      line += 1;
      pos = kind === LINE_BREAK ? i + 1 : i + 2;
      return { value, ended: LINE_BREAK, added };
    }
  }

  // What follows a quoted field's closing quote.
  function afterClose(value) {
    if (pos >= n) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // The opening quote never closes: it is a literal character, and the
  // text after it is read again as an unquoted field.
  function unterminated(open, openLine) {
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return readUnquoted('"');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const qc = text.indexOf('"', open + 1);
    if (qc === -1) return unterminated(open, openLine);
    if (text.charCodeAt(qc + 1) !== 34) {
      // A single closing quote: clean when nothing inside needs rewriting.
      const iR = text.indexOf('\r', open + 1);
      const iN = text.indexOf('\n', open + 1);
      if ((iR === -1 || iR > qc) && (iN === -1 || iN > qc)) {
        const value = text.slice(open + 1, qc);
        pos = qc + 1;
        return afterClose(value);
      }
    }
    // Slow path: doubled quotes, or CR/LF inside the quotes.
    const parts = [];
    let start = open + 1;
    pos = open + 1;
    while (pos < n) {
      const iQ = text.indexOf('"', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let i = n;
      let kind = -1;
      if (iQ !== -1 && iQ < i) { i = iQ; kind = 34; }
      if (iN !== -1 && iN < i) { i = iN; kind = 10; }
      if (iR !== -1 && iR < i) { i = iR; kind = 13; }
      if (kind === -1) break;
      if (kind === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          parts.push(text.slice(start, i) + '"');
          pos = i + 2;
          start = pos;
          continue;
        }
        parts.push(text.slice(start, i));
        pos = i + 1;
        return afterClose(parts.join(''));
      }
      if (kind === 10) {
        line += 1;
        pos = i + 1;
        continue;
      }
      // CRLF and a lone CR inside quotes are each one LF.
      parts.push(text.slice(start, i) + '\n');
      line += 1;
      pos = i + (text.charCodeAt(i + 1) === 10 ? 2 : 1);
      start = pos;
    }
    return unterminated(open, openLine);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
