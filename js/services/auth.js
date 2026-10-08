// ============================================================
// AUTH SERVICE — Login / Logout con Supabase
// ============================================================
import { getSupabase } from './supabase.js';

export async function login(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}

export async function logout() {
  const sb = getSupabase();
  await sb.auth.signOut();
}

export async function getCurrentUser() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user || null;
}

export async function isAuthenticated() {
  const user = await getCurrentUser();
  return !!user;
}

export function onAuthChange(callback) {
  const sb = getSupabase();
  const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user || null);
  });
  return () => subscription.unsubscribe();
}