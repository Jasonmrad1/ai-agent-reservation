import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { DatabaseContext } from '../db/index.js';

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const equals = (a: string, b: string) => crypto.timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export function createAdminAuth(db: DatabaseContext, secret: string, options: { secure?: boolean; legacyQuery?: boolean; publicBaseUrl?: string } = {}) {
  db.appDb.db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL,
    oauth_state TEXT, oauth_expires INTEGER
  )`);
  db.appDb.db.exec('CREATE TABLE IF NOT EXISTS admin_login_limits (ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL)');
  function session(req: Request): any {
    const token = req.headers.cookie?.match(/(?:^|;\s*)clinic_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token ? db.appDb.db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token), Date.now()) : null;
  }
  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (bearer && equals(bearer, secret)) { res.locals.adminBearer = true; next(); return; }
    if (options.legacyQuery && typeof req.query.key === 'string' && equals(req.query.key, secret)) { next(); return; }
    const active = session(req);
    if (!active) { res.status(401).json({ error: 'Administrator login required' }); return; }
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !equals(req.get('x-csrf-token') || req.body?.csrfToken || '', active.csrf)) {
      res.status(403).json({ error: 'Invalid CSRF token' }); return;
    }
    res.locals.adminSession = active; res.locals.csrfToken = active.csrf; next();
  };
  const login = (req: Request, res: Response) => {
    const ip = req.socket.remoteAddress || 'unknown';
    db.appDb.db.prepare('DELETE FROM admin_login_limits WHERE window_start < ?').run(Date.now()-10*60*1000);
    const limit = db.appDb.db.prepare('SELECT attempts FROM admin_login_limits WHERE ip = ?').get(ip) as {attempts:number} | undefined;
    if (limit && limit.attempts >= 10) { res.status(429).json({ error: 'Too many login attempts; try again later' }); return; }
    const origin = req.get('origin');
    const expectedOrigin = options.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== new URL(expectedOrigin).origin) { res.status(403).json({ error: 'Invalid origin' }); return; }
    if (typeof req.body?.secret !== 'string' || !equals(req.body.secret, secret)) {
      db.appDb.db.prepare('INSERT INTO admin_login_limits (ip, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET attempts = attempts + 1').run(ip, Date.now());
      res.status(401).json({ error: 'Invalid credentials' }); return;
    }
    db.appDb.db.prepare('DELETE FROM admin_login_limits WHERE ip = ?').run(ip);
    const token = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(32).toString('hex');
    db.appDb.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
    db.appDb.db.prepare('INSERT INTO admin_sessions (token_hash, csrf, expires_at) VALUES (?, ?, ?)').run(digest(token), csrf, Date.now()+8*60*60*1000);
    res.cookie('clinic_session', token, { httpOnly: true, secure: Boolean(options.secure), sameSite: 'lax', path: '/', maxAge:8*60*60*1000 });
    if (req.is('application/x-www-form-urlencoded')) res.redirect('/admin/dashboard');
    else res.json({ success: true, csrfToken: csrf });
  };
  function oauthState(req: Request): string | null {
    const active = session(req); if (!active) return null;
    const state = crypto.randomBytes(32).toString('hex');
    db.appDb.db.prepare('UPDATE admin_sessions SET oauth_state = ?, oauth_expires = ? WHERE token_hash = ?').run(digest(state), Date.now()+10*60*1000, active.token_hash);
    return state;
  }
  function consumeOAuthState(req: Request): boolean {
    const active = session(req); const state = req.query.state;
    if (!active || typeof state !== 'string' || !active.oauth_state || active.oauth_expires <= Date.now() || !equals(digest(state),active.oauth_state)) return false;
    db.appDb.db.prepare('UPDATE admin_sessions SET oauth_state = NULL, oauth_expires = NULL WHERE token_hash = ?').run(active.token_hash);
    return true;
  }
  return { middleware, login, session, oauthState, consumeOAuthState };
}
export type AdminAuth = ReturnType<typeof createAdminAuth>;
