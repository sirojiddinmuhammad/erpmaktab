// Avtomatik import: sozlamalar, ruxsat va eMaktab sinf × fanlarini rejalarga moslash.

import { guessSubject } from '../hints.js';

const posInt = (v, def) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : def; };

export function readAutoConfig(env = process.env) {
  const testers = new Set(String(env.AUTO_TESTERS || '').split(',')
    .map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0));
  return { testers, concurrency: posInt(env.AUTO_CONCURRENCY, 2), maxItems: posInt(env.AUTO_MAX_ITEMS, 1) };
}

export function canAuto(tgId, { adminId, testers }) {
  return (!!adminId && tgId === adminId) || testers.has(tgId);
}

// "5-A", "11-В", "5А", "5-A (1-guruh)" → 5 / 11; boshqasi → null
export function gradeOfClass(name) {
  const m = String(name || '').trim().match(/^(\d{1,2})(?!\d)/);
  const g = m ? Number(m[1]) : null;
  return g >= 1 && g <= 11 ? g : null;
}

export function needsGradingAnswer(classes, accountGrading) {
  return !accountGrading && classes.some(c => (gradeOfClass(c.className) || 0) >= 5);
}

export async function buildItems({
  classes, quarter, year, accountGrading, accountMedium, mediumOverride = {},
  keyOf, allowed = null, findPlan, maxItems,
}) {
  const items = [];
  let picked = 0;
  for (const c of classes) {
    const grade = gradeOfClass(c.className);
    const medium = accountMedium === 'both' ? (mediumOverride[c.groupId] || 'uz') : (accountMedium || 'uz');
    const grading = grade && grade >= 5 ? (accountGrading || 'normal') : 'normal';
    for (const s of c.subjects) {
      const subjectKey = guessSubject(s.name, keyOf, allowed);
      let plan = null, reason = null;
      if (!grade) reason = 'grade';
      else if (!subjectKey) reason = 'subject';
      else {
        plan = await findPlan({ grade, subjectKey, quarter, year, medium, grading });
        if (!plan) reason = 'noplan';
      }
      const selected = !!plan && picked < maxItems;
      if (selected) picked++;
      items.push({
        i: items.length, groupId: c.groupId, className: c.className, subjectId: s.id, subjectName: s.name,
        grade, subjectKey, medium, grading, plan: plan || null, reason, selected,
        subgroupId: '', subgroupName: 'Весь класс',
      });
    }
  }
  return items;
}
