/* 纯函数：把计划周次转换成 iCalendar（RFC 5545）文本，可导入系统日历 */

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLength(text) {
  return encoder ? encoder.encode(text).length : text.length;
}

export function escapeIcs(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/* 单行不超过 75 字节，超出部分以空格开头的续行折行 */
export function foldLine(line) {
  if (byteLength(line) <= 75) return line;
  const parts = [];
  let buf = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = byteLength(ch);
    if (bytes + size > limit && buf) {
      parts.push(buf);
      buf = ' ' + ch;
      bytes = 1 + size;
      limit = 75;
    } else {
      buf += ch;
      bytes += size;
    }
  }
  if (buf) parts.push(buf);
  return parts.join('\r\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dateValue(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function stampValue(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
    + `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

export function buildCalendar({ calendarName = '知识星图', events = [], now = new Date() } = {}) {
  const stamp = stampValue(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Knowledge Star Map//Study Plan//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`
  ];

  events.forEach(event => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(event.start)}`,
      `DTEND;VALUE=DATE:${dateValue(event.end)}`,
      `SUMMARY:${escapeIcs(event.summary)}`,
      `DESCRIPTION:${escapeIcs(event.description || '')}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
