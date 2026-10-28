import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractText, htmlText, zipEntries } from './docs';

/** A real zip, written the way Office does (deflated parts, central directory at the end). */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A tiny real PDF with one line of text, xref offsets computed. */
function makePdf(line: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('reading course files', () => {
  it('reads Word: paragraphs, tabs and tables in order', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Unit 2: Cells</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Mitochondria </w:t></w:r><w:r><w:t>make energy &amp; heat.</w:t></w:r></w:p>'
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Organelle</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Job</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const r = await extractText(makeZip({ 'word/document.xml': xml }), 'unit2.docx');
    expect('text' in r && r.text).toMatch(/Unit 2: Cells\nMitochondria make energy & heat\./);
    expect('text' in r && r.text).toMatch(/Organelle/);
    expect('kind' in r && r.kind).toBe('word');
  });

  it('reads PowerPoint slides in order, with the speaker notes', async () => {
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const r = await extractText(makeZip({
      'ppt/slides/slide10.xml': slide('Ten'),
      'ppt/slides/slide2.xml': slide('Photosynthesis'),
      'ppt/slides/slide1.xml': slide('Title'),
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Target="../notesSlides/notesSlide7.xml"/></Relationships>',
      'ppt/notesSlides/notesSlide7.xml': '<p:notes><a:p><a:r><a:t>Chlorophyll absorbs red and blue light.</a:t></a:r></a:p></p:notes>',
    }), 'lesson.pptx');
    expect('text' in r && r.text.indexOf('Title')).toBeLessThan('text' in r ? r.text.indexOf('Ten') : 0);
    expect('text' in r && r.text).toMatch(/## Slide 2\nPhotosynthesis\nSpeaker notes: Chlorophyll absorbs red and blue light\./);
    expect('pages' in r && r.pages).toBe(3);
  });

  it('reads Excel: shared strings, numbers, sheet names', async () => {
    const r = await extractText(makeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Marks" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Test</t></si><si><t>Score</t></si><si><r><t>Unit </t></r><r><t>1</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>87</v></c></row></sheetData></worksheet>',
    }), 'marks.xlsx');
    expect('text' in r && r.text).toBe('## Sheet: Marks\nTest\tScore\nUnit 1\t87');
  });

  it('reads a PDF through pdf.js', async () => {
    const r = await extractText(makePdf('Newton second law F equals m a'), 'notes.pdf');
    expect(r).toMatchObject({ kind: 'pdf', pages: 1 });
    expect('text' in r && r.text).toMatch(/Newton second law F equals m a/);
  });

  it('reads web pages without scripts or styles', () => {
    const t = htmlText('<html><head><title>x</title><style>p{}</style></head><body><h2>Due Friday</h2><p>Read <b>chapter 3</b>.</p><script>alert(1)</script><ul><li>Q1</li><li>Q2</li></ul></body></html>');
    expect(t).toBe('## Due Friday\nRead chapter 3.\n\n- Q1\n- Q2');
  });

  it('says plainly what it cannot read', async () => {
    expect(await extractText(Buffer.from('x'), 'old.doc')).toMatchObject({ error: expect.stringMatching(/older Office format/) });
    expect(await extractText(Buffer.from('x'), 'photo.jpg')).toMatchObject({ error: expect.stringMatching(/picture/) });
    expect(await extractText(Buffer.from('not a zip at all'), 'fake.docx')).toMatchObject({ error: expect.stringMatching(/Couldn't read fake\.docx/) });
    expect(() => zipEntries(Buffer.from('nope'))).toThrow();
  });
});

describe('reading almost anything else (12 Oct 2026)', () => {
  it('reads an OpenDocument text file, with spaces, tabs and tables', async () => {
    const xml = '<office:document-content><office:body><office:text><text:h>Unit 3</text:h><text:p>Photo<text:s text:c="2"/>synthesis<text:tab/>notes</text:p><table:table><table:table-row><table:table-cell><text:p>Plant</text:p></table:table-cell><table:table-cell><text:p>Sun</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>';
    const r = await extractText(makeZip({ 'mimetype': 'application/vnd.oasis.opendocument.text', 'content.xml': xml }), 'notes.odt');
    expect(r).toMatchObject({ kind: 'document' });
    expect('text' in r && r.text).toBe('Unit 3\nPhoto  synthesis\tnotes\nPlant\tSun');
  });

  it('reads OpenDocument slides with their speaker notes, and sheets with their names', async () => {
    const odp = '<office:body><draw:page draw:name="1"><draw:frame><text:p>The cell</text:p></draw:frame><presentation:notes><text:p>Mention mitochondria</text:p></presentation:notes></draw:page><draw:page><text:p>Membranes</text:p></draw:page></office:body>';
    const r = await extractText(makeZip({ 'content.xml': odp }), 'deck.odp');
    expect('text' in r && r.text).toBe('## Slide 1\nThe cell\nSpeaker notes: Mention mitochondria\n\n## Slide 2\nMembranes');
    const ods = '<table:table table:name="Marks"><table:table-row><table:table-cell><text:p>Quiz</text:p></table:table-cell><table:table-cell><text:p>8</text:p></table:table-cell></table:table-row></table:table>';
    const s2 = await extractText(makeZip({ 'content.xml': ods }), 'marks.ods');
    expect('text' in s2 && s2.text).toBe('## Sheet: Marks\nQuiz\t8');
  });

  it('reads an e-book in its reading order, not file order', async () => {
    const r = await extractText(makeZip({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
      'OEBPS/book.opf': '<package><metadata><dc:title>Genghis Khan</dc:title></metadata><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
      'OEBPS/a.xhtml': '<html><body><p>Second chapter</p></body></html>',
      'OEBPS/b.xhtml': '<html><body><h1>Temujin</h1><p>First chapter</p></body></html>',
    }), 'khan.epub');
    expect(r).toMatchObject({ kind: 'e-book', pages: 2 });
    expect('text' in r && r.text).toBe('# Genghis Khan\n\n# Temujin\nFirst chapter\n\nSecond chapter');
  });

  it('pulls the words out of an old .doc, leaving the font and style machinery behind', async () => {
    const utf16 = (t: string) => Buffer.from(t, 'utf16le');
    const junk = Buffer.from([0, 1, 2, 3, 255, 0, 7, 0, 0, 0]);
    const doc = Buffer.concat([junk, utf16('Times New Roman'), junk, utf16('The Battle of Hastings was in 1066.'), junk, Buffer.from('Normal'), junk, utf16('William won.'), junk]);
    const r = await extractText(doc, 'history.doc');
    expect(r).toMatchObject({ kind: expect.stringMatching(/older Office file/) });
    expect('text' in r && r.text).toBe('The Battle of Hastings was in 1066.\nWilliam won.');
  });

  it('reads subtitles as just what is said, and any file that is really text whatever its ending', async () => {
    const r = await extractText(Buffer.from('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello class.\n\n2\n00:00:03.500 --> 00:00:05.000\n<i>Open your books.</i>\n'), 'lesson.vtt');
    expect('text' in r && r.text).toBe('Hello class. Open your books.');
    const odd = await extractText(Buffer.from('Practice questions\n1. What is 7 x 8?\n'), 'questions.qz');
    expect(odd).toMatchObject({ kind: 'text' });
    expect(await extractText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]), 'mystery.bin')).toMatchObject({ error: expect.any(String) });
  });

  it('flags a PDF with no text layer as scanned, for reading by eye', async () => {
    const r = await extractText(makePdf(''), 'scan.pdf');
    expect(r).toMatchObject({ kind: 'pdf', scanned: true });
  });
});
