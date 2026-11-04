import { redirect } from 'next/navigation';
import { requireStaff } from './auth';
import { AppError } from './errors';
export async function pageStaff() {
  try{return await requireStaff();}
  catch(e){if(e instanceof AppError&&e.status===401)redirect('/login');if(e instanceof AppError&&e.status===403)redirect('/login?error=membership_required');throw e;}
}
export function label(value:string){return value.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());}
export function dateTime(value:string|Date,timezone='Africa/Cairo') {
  return new Intl.DateTimeFormat('en-GB',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
}
export function dateOnly(value:string|Date) {return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));}
