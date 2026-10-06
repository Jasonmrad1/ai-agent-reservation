const CONFIRMATIONS=new Set(['YES','CONFIRM','TAMAM','EHH','AKID','OUI','نعم','أكيد','اكيد','تمام','تأكيد']);

export function isAppointmentConfirmation(text:string):boolean {
  return CONFIRMATIONS.has(text.trim().replace(/[.!]+$/u,'').trim().toUpperCase());
}
