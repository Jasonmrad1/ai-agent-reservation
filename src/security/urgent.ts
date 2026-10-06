/** Conservative escalation detection; not a diagnosis. */
export function isUrgentMessage(text: string): boolean {
  const normalized=text.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').toLowerCase();
  return /chest pain|shortness of breath|cannot breathe|can't breathe|difficulty breathing|unconscious|severe bleeding|stroke|suicid|emergency|waja[3a].{0,25}sa?d[er]|d[iy]+[2q]et? nafas|ma.{0,8}(f[iy]e|2eder).{0,10}(etnafas|tnafas)|ألم.{0,10}الصدر|الم.{0,10}الصدر|وجع.{0,10}الصدر|ضيق.{0,10}(التنفس|النفس)|نزيف شديد|فاقد الوعي|انتحار|douleur.{0,15}(thoracique|poitrine)|difficult[eé].{0,10}respir/i.test(normalized);
}
