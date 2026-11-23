// Fast drop-in replacement for csv-reader 1.0.0.
//
// Same reading, byte for byte, as the reference: broken rows, stray CRs,
// quote junk and unterminated quotes all produce the same {columns, rows,
// errors}. The reference builds every field one character at a time; this
// reader instead jumps between delimiters with indexOf and slices each
// clean run of characters out of the text in one piece. The positions of
// the next LF and the next CR are cached and only rescanned once the
// reader passes them, so an ordinary field costs a single short indexOf
// for its comma. The rare broken paths (a stray CR inside a field, a
// doubled quote, a CR inside quotes, junk after a closing quote) fall
// back to assembling the field from parts, in exactly the order the
// reference meets them. Field readers hand their result back through
// shared variables, so a field allocates nothing but its string.
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

  // The next LF and CR at or after the last scan (n: none left), and
  // whether they still describe the text at pos.
  let nextNL = n;
  let nextCR = n;
  let cacheDirty = true;
  function syncCache() {
    const a = text.indexOf('\n', pos);
    nextNL = a === -1 ? n : a;
    const b = text.indexOf('\r', pos);
    nextCR = b === -1 ? n : b;
    cacheDirty = false;
  }

  // The field just read, handed back by the readers below.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `initial` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr). fAdded counts
  // the characters kept beyond `initial`.
  function readUnquoted(initial) {
    if (cacheDirty) syncCache();
    let start = pos;
    let parts = null;
    let added = 0;
    while (true) {
      const iC = text.indexOf(',', pos);
      if (iC !== -1 && iC <= nextNL && iC <= nextCR) {
        let value;
        if (parts !== null) {
          parts.push(text.slice(start, iC));
          added += iC - start;
          value = parts.join('');
        } else {
          const seg = text.slice(start, iC);
          value = initial ? initial + seg : seg;
          added = seg.length;
        }
        pos = iC + 1;
        fValue = value; fEnded = COMMA; fAdded = added;
        return;
      }
      if (nextCR < nextNL) {
        const i = nextCR;
        if (text.charCodeAt(i + 1) === 10) {
          // CRLF: the record ends.
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
          line += 1;
          pos = i + 2;
          nextNL = n; nextCR = n; cacheDirty = true;
          fValue = value; fEnded = LINE_BREAK; fAdded = added;
          return;
        }
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
        const b = text.indexOf('\r', pos);
        nextCR = b === -1 ? n : b;
        continue;
      }
      if (nextNL < n) {
        const i = nextNL;
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
        line += 1;
        pos = i + 1;
        nextNL = n; nextCR = n; cacheDirty = true;
        fValue = value; fEnded = LINE_BREAK; fAdded = added;
        return;
      }
      // No delimiter left: the field runs to the end of the text.
      pos = n;
      if (parts !== null) {
        parts.push(text.slice(start, n));
        added += n - start;
        fValue = parts.join('');
      } else {
        const seg = text.slice(start, n);
        fValue = initial ? initial + seg : seg;
        added = seg.length;
      }
      fEnded = END; fAdded = added;
      return;
    }
  }

  // What follows a quoted field's closing quote; fValue holds its value.
  function afterClose(value) {
    if (pos >= n) { fValue = value; fEnded = END; fAdded = 0; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value; fEnded = COMMA; fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      cacheDirty = true;
      fValue = value; fEnded = LINE_BREAK; fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      cacheDirty = true;
      fValue = value; fEnded = LINE_BREAK; fAdded = 0;
      return;
    }
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // The opening quote never closes: it is a literal character, and the
  // text after it is read again as an unquoted field.
  function unterminated(open, openLine) {
    pos = open + 1;
    line = openLine;
    cacheDirty = true;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquoted('"');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    if (cacheDirty) syncCache();
    const qc = text.indexOf('"', open + 1);
    if (qc === -1) { unterminated(open, openLine); return; }
    if (text.charCodeAt(qc + 1) !== 34 && qc < nextCR && qc < nextNL) {
      // A single closing quote, and nothing inside needs rewriting.
      const value = text.slice(open + 1, qc);
      pos = qc + 1;
      afterClose(value);
      return;
    }
    // Slow path: doubled quotes, or CR/LF inside the quotes.
    const parts = [];
    let start = open + 1;
    pos = open + 1;
    cacheDirty = true;
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
        afterClose(parts.join(''));
        return;
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
    unterminated(open, openLine);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
        cacheDirty = true;
      } else if (text[pos] === '\r' && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        cacheDirty = true;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted(); else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

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
