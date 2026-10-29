import { describe, expect, it } from 'vitest';
import { sanitiseFilename } from './filename';

describe('sanitiseFilename: ordinary names', () => {
  it.each([
    ['resume.pdf', 'resume.pdf'],
    ['cv.docx', 'cv.docx'],
    ['notes.txt', 'notes.txt'],
    ['My Resume.PDF', 'My-Resume.pdf'],
    ['resume_final_v3.docx', 'resume_final_v3.docx'],
    ['Alex  Example   CV.txt', 'Alex-Example-CV.txt'],
  ])('%s becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });
});

describe('sanitiseFilename: hostile names', () => {
  it.each([
    ['../../etc/passwd.txt', 'passwd.txt'],
    ['..\\..\\Windows\\cv.docx', 'cv.docx'],
    ['C:\\Users\\Alex\\Documents\\cv.docx', 'cv.docx'],
    ['/tmp/uploads/cv.pdf', 'cv.pdf'],
    ['folder/.//cv.pdf', 'cv.pdf'],
  ])('path parts are dropped: %s becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it.each([
    ['cv\u0000.pdf', 'cv.pdf'],
    ['c\u0007v\u001f.pdf', 'cv.pdf'],
    ['cv\n.pdf', 'cv.pdf'],
    ['cv\u007f.pdf', 'cv.pdf'],
  ])('control characters are removed: %j becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it.each([
    ['résumé.pdf', 'rsum.pdf'],
    ['Alex Müller CV.docx', 'Alex-Mller-CV.docx'],
    ['履歴書.pdf', 'resume.pdf'],
    ['😀.txt', 'resume.txt'],
  ])('non-ASCII characters are removed: %s becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it.each([
    ['', 'resume'],
    ['..', 'resume'],
    ['...', 'resume'],
    ['.pdf', 'resume.pdf'],
    ['   ', 'resume'],
    ['///', 'resume'],
  ])('a name with nothing usable falls back to "resume": %j becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });
});

describe('sanitiseFilename: extensions and length', () => {
  it.each([
    ['cv.pdf.exe', 'cv-pdf-exe'],
    ['cv.exe.pdf', 'cv-exe.pdf'],
    ['script.js', 'script-js'],
    ['archive.tar.gz', 'archive-tar-gz'],
    ['payload.html', 'payload-html'],
    ['cv.pdf ', 'cv.pdf'],
    ['cv.PdF', 'cv.pdf'],
    ['noextension', 'noextension'],
    ['.htaccess', 'htaccess'],
  ])('only an allowed final extension is kept: %s becomes %s', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it('a name containing a dot-extension earlier on never keeps it as a dot', () => {
    expect(sanitiseFilename('cv.pdf.exe')).not.toContain('.');
  });

  it('caps the length at 100 characters and still ends with the extension', () => {
    const name = sanitiseFilename(`${'a'.repeat(300)}.pdf`);
    expect(name).toHaveLength(100);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(sanitiseFilename('b'.repeat(300))).toHaveLength(100);
  });

  it('does not leave a trailing hyphen after cutting a long name', () => {
    const name = sanitiseFilename(`${'a'.repeat(95)} ${'b'.repeat(50)}.txt`);
    expect(name).toBe(`${'a'.repeat(95)}.txt`);
  });
});

describe('sanitiseFilename: whatever goes in, only safe characters come out', () => {
  const hostile = [
    '../../../etc/shadow',
    '..\\..\\boot.ini',
    'a/b\\c.pdf',
    '\u0000\u0001\u0002.txt',
    'cv.pdf\u0000.exe',
    '%2e%2e%2fcv.pdf',
    'cv;rm -rf /.pdf',
    'cv"; filename="evil.exe.pdf',
    'cv\r\nContent-Type: text/html.pdf',
    '<script>alert(1)</script>.txt',
    '🙂🙂🙂',
    ' . . ',
    'x'.repeat(5000),
    '.'.repeat(200),
    '-'.repeat(200) + '.pdf',
  ];

  it.each(hostile.map((h, i) => [i, h] as const))('hostile input #%i', (_n, input) => {
    const out = sanitiseFilename(input);
    expect(out).toMatch(/^[A-Za-z0-9_-]+(\.(pdf|docx|txt))?$/);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).not.toContain('..');
    expect(out.startsWith('.')).toBe(false);
  });
});
