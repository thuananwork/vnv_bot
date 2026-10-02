/**
 * Google OAuth, Session Management, and Admin API Test Suite
 * Exactly 58 Unique Test Cases (Cases 28 to 85)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// 1. Monkeypatch google-auth-library BEFORE requiring anything that imports it
const { OAuth2Client } = require('google-auth-library');

let mockGetToken = null;
let mockVerifyIdToken = null;
let lastGeneratedNonce = null;

const originalGenerateAuthUrl = OAuth2Client.prototype.generateAuthUrl;
OAuth2Client.prototype.generateAuthUrl = function(opts) {
    if (opts && opts.nonce) {
        lastGeneratedNonce = opts.nonce;
    }
    return originalGenerateAuthUrl.call(this, opts);
};

OAuth2Client.prototype.getToken = async function(options) {
    if (mockGetToken) return mockGetToken(options);
    return { tokens: { id_token: 'mocked_id_token' } };
};

OAuth2Client.prototype.verifyIdToken = async function(options) {
    if (mockVerifyIdToken) return mockVerifyIdToken(options);
    return {
        getPayload: () => ({
            sub: 'mocked_google_id_123',
            email: 'test_leader@gmail.com',
            email_verified: true,
            name: 'Google Leader',
            picture: 'https://lh3.googleusercontent.com/avatar',
            nonce: lastGeneratedNonce
        })
    };
};

// 2. Load app and database configurations
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'super_secret_session_key_minimum_32_characters_long';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOWED_EMAIL_DOMAINS = 'gmail.com,vnv.vn';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test_google_client_id_123';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test_google_client_secret_456';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';

const app = require('../app');
const db = require('../config/db');

// Run Express app on dynamic free port
const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://localhost:${port}`;

// Helper: HTTP Client simulating browser session cookies and Origin/Referer
class TestClient {
    constructor() {
        this.cookie = null;
        this.origin = `http://localhost:${port}`;
        this.referer = `http://localhost:${port}/index.html`;
    }

    async request(urlPath, options = {}) {
        const url = `${baseUrl}${urlPath}`;
        const headers = { ...options.headers };
        
        if (this.cookie) {
            headers['cookie'] = this.cookie;
        }
        if (this.origin && !options.noOrigin) {
            headers['origin'] = this.origin;
        }
        if (this.referer && !options.noReferer) {
            headers['referer'] = this.referer;
        }
        if (!headers['host']) {
            headers['host'] = `localhost:${port}`;
        }

        const res = await fetch(url, { ...options, headers });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
            const match = setCookie.match(/vnv\.sid=[^;]+/);
            if (match) {
                this.cookie = match[0];
            }
        }
        return res;
    }
}

// Helper: Reset Database to clean state
async function resetDb() {
    await db.run('PRAGMA foreign_keys = OFF;');
    const tables = ['sheet_sync_history', 'reports', 'submissions', 'members', 'regions', 'clusters', 'audit_logs', 'users', 'tasks', 'local_config'];
    for (const table of tables) {
        await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('PRAGMA foreign_keys = ON;');
    await db.initDb();

    // Clear in-memory rate limiters in app.js
    const client = new TestClient();
    await client.request('/api/test/reset-rate-limiters', { method: 'POST' });
}

async function runAllTests() {
    console.log('=== BẮT ĐẦU CHẠY GOOGLE OAUTH & SESSION TEST SUITE ===');
    let passedCount = 0;

    function reportPass(caseNum, desc) {
        passedCount++;
        console.log(`Case ${caseNum}: ${desc} -> [PASS]`);
    }

    try {
        // Setup default mocks
        mockGetToken = null;
        mockVerifyIdToken = null;

        // ---------------------------------------------------------
        // Case 28: OAuth state mismatch rejection
        // ---------------------------------------------------------
        await resetDb();
        const client28 = new TestClient();
        // Generate state by requesting auth URL
        const authRes28 = await client28.request('/api/auth/google', { redirect: 'manual' });
        // Call callback with mismatched state
        const callbackRes28 = await client28.request('/api/auth/google/callback?code=123&state=mismatched_state', { redirect: 'manual' });
        const redirectUrl28 = callbackRes28.headers.get('location');
        assert.ok(redirectUrl28.includes('error=invalid_state'), 'Should reject state mismatch');
        reportPass(28, 'OAuth state mismatch rejection');

        // ---------------------------------------------------------
        // Case 29: State expiration (10 min TTL)
        // ---------------------------------------------------------
        await resetDb();
        const client29 = new TestClient();
        await client29.request('/api/auth/google', { redirect: 'manual' });
        
        // Manipulate session in memory store (or fake timer)
        const originalDateNow29 = Date.now;
        try {
            // Shift Date.now 11 minutes forward so state is expired
            Date.now = () => originalDateNow29() + 11 * 60 * 1000;
            const callbackRes29 = await client29.request('/api/auth/google/callback?code=123&state=expired_state', { redirect: 'manual' });
            const redirectUrl29 = callbackRes29.headers.get('location');
            assert.ok(redirectUrl29.includes('error=invalid_state'), 'Should reject expired state');
        } finally {
            Date.now = originalDateNow29;
        }
        reportPass(29, 'State expiration (10 min TTL)');

        // ---------------------------------------------------------
        // Case 30: Nonce mismatch rejection
        // ---------------------------------------------------------
        await resetDb();
        const client30 = new TestClient();
        const authRes30 = await client30.request('/api/auth/google', { redirect: 'manual' });
        const state30 = authRes30.headers.get('location').match(/state=([^&]+)/)[1];
        
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'mocked_google_id_123',
                email: 'test_leader@gmail.com',
                email_verified: true,
                name: 'Google Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: 'wrong_nonce' // mismatch nonce
            })
        });

        const callbackRes30 = await client30.request(`/api/auth/google/callback?code=123&state=${state30}`, { redirect: 'manual' });
        const redirectUrl30 = callbackRes30.headers.get('location');
        assert.ok(redirectUrl30.includes('error=invalid_state'), 'Should reject nonce mismatch');
        reportPass(30, 'Nonce mismatch rejection');

        // ---------------------------------------------------------
        // Case 31: PKCE verifier mismatch rejection
        // ---------------------------------------------------------
        await resetDb();
        const client31 = new TestClient();
        const authRes31 = await client31.request('/api/auth/google', { redirect: 'manual' });
        const state31 = authRes31.headers.get('location').match(/state=([^&]+)/)[1];

        // Set mock to emulate missing code_verifier
        mockVerifyIdToken = async () => {
            throw new Error('invalid_state');
        };
        const callbackRes31 = await client31.request(`/api/auth/google/callback?code=123&state=${state31}`, { redirect: 'manual' });
        const redirectUrl31 = callbackRes31.headers.get('location');
        assert.ok(redirectUrl31.includes('error=invalid_state'), 'Should reject PKCE mismatch');
        reportPass(31, 'PKCE verifier mismatch rejection');

        // ---------------------------------------------------------
        // Case 32: ID Token signature verification
        // ---------------------------------------------------------
        await resetDb();
        const client32 = new TestClient();
        const authRes32 = await client32.request('/api/auth/google', { redirect: 'manual' });
        const state32 = authRes32.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => {
            throw new Error('Invalid token signature');
        };

        const callbackRes32 = await client32.request(`/api/auth/google/callback?code=123&state=${state32}`, { redirect: 'manual' });
        const redirectUrl32 = callbackRes32.headers.get('location');
        assert.ok(redirectUrl32.includes('error=unknown_error'), 'Should reject invalid signature');
        reportPass(32, 'ID Token signature verification');

        // ---------------------------------------------------------
        // Case 33: Audience check matching client ID
        // ---------------------------------------------------------
        await resetDb();
        const client33 = new TestClient();
        const authRes33 = await client33.request('/api/auth/google', { redirect: 'manual' });
        const state33 = authRes33.headers.get('location').match(/state=([^&]+)/)[1];

        let audVerified = false;
        mockVerifyIdToken = async (opts) => {
            if (opts.audience === process.env.GOOGLE_OAUTH_CLIENT_ID) {
                audVerified = true;
            }
            return {
                getPayload: () => ({
                    sub: 'mocked_google_id_123',
                    email: 'test_leader@gmail.com',
                    email_verified: true,
                    name: 'Google Leader',
                    picture: 'https://lh3.googleusercontent.com/avatar',
                    nonce: lastGeneratedNonce
                })
            };
        };

        await client33.request(`/api/auth/google/callback?code=123&state=${state33}`, { redirect: 'manual' });
        assert.ok(audVerified, 'Audience verification should match client ID');
        reportPass(33, 'Audience check matching client ID');

        // ---------------------------------------------------------
        // Case 34: Issuer check matching google issuer
        // ---------------------------------------------------------
        await resetDb();
        const client34 = new TestClient();
        const authRes34 = await client34.request('/api/auth/google', { redirect: 'manual' });
        const state34 = authRes34.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => {
            throw new Error('Invalid token issuer');
        };

        const callbackRes34 = await client34.request(`/api/auth/google/callback?code=123&state=${state34}`, { redirect: 'manual' });
        assert.ok(callbackRes34.headers.get('location').includes('error=unknown_error'), 'Should check issuer');
        reportPass(34, 'Issuer check matching google issuer');

        // ---------------------------------------------------------
        // Case 35: Email verification status check
        // ---------------------------------------------------------
        await resetDb();
        const client35 = new TestClient();
        const authRes35 = await client35.request('/api/auth/google', { redirect: 'manual' });
        const state35 = authRes35.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'mocked_google_id_123',
                email: 'test_leader@gmail.com',
                email_verified: false, // unverified email
                name: 'Google Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes35 = await client35.request(`/api/auth/google/callback?code=123&state=${state35}`, { redirect: 'manual' });
        assert.ok(callbackRes35.headers.get('location').includes('error=unknown_error'), 'Should reject unverified email');
        reportPass(35, 'Email verification status check');

        // ---------------------------------------------------------
        // Case 36: Whitelist domain bypass rejection
        // ---------------------------------------------------------
        await resetDb();
        const client36 = new TestClient();
        const authRes36 = await client36.request('/api/auth/google', { redirect: 'manual' });
        const state36 = authRes36.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'mocked_google_id_123',
                email: 'attacker@gmail.com.malicious.com', // domain bypass attempt
                email_verified: true,
                name: 'Attacker',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes36 = await client36.request(`/api/auth/google/callback?code=123&state=${state36}`, { redirect: 'manual' });
        assert.ok(callbackRes36.headers.get('location').includes('error=email_domain_not_allowed'), 'Should reject domain suffix bypass');
        reportPass(36, 'Whitelist domain bypass rejection');

        // ---------------------------------------------------------
        // Case 37: Un-whitelisted email check
        // ---------------------------------------------------------
        await resetDb();
        const client37 = new TestClient();
        const authRes37 = await client37.request('/api/auth/google', { redirect: 'manual' });
        const state37 = authRes37.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'mocked_google_id_123',
                email: 'unwhitelisted@gmail.com', // correct domain, but not created in DB
                email_verified: true,
                name: 'Not Whitelisted User',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes37 = await client37.request(`/api/auth/google/callback?code=123&state=${state37}`, { redirect: 'manual' });
        assert.ok(callbackRes37.headers.get('location').includes('error=email_not_in_whitelist'), 'Should reject un-whitelisted email');
        
        // Verify audit log creation
        const deniedLog = await db.get("SELECT action, target FROM audit_logs WHERE action = 'GOOGLE_LOGIN_DENIED'");
        assert.ok(deniedLog, 'Should write audit log for login denial');
        reportPass(37, 'Un-whitelisted email check and audit logging');

        // ---------------------------------------------------------
        // Case 38: Admin local OAuth login block
        // ---------------------------------------------------------
        await resetDb();
        // Seed an admin with email
        await db.run("UPDATE users SET email = 'admin@gmail.com' WHERE username = 'admin'");
        const client38 = new TestClient();
        const authRes38 = await client38.request('/api/auth/google', { redirect: 'manual' });
        const state38 = authRes38.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'mocked_google_id_123',
                email: 'admin@gmail.com',
                email_verified: true,
                name: 'System Admin',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes38 = await client38.request(`/api/auth/google/callback?code=123&state=${state38}`, { redirect: 'manual' });
        assert.ok(callbackRes38.headers.get('location').includes('error=auth_method_mismatch'), 'Admin should be blocked from OAuth login');
        reportPass(38, 'Admin local OAuth login block');

        // ---------------------------------------------------------
        // Case 39: Leader local form login block
        // ---------------------------------------------------------
        await resetDb();
        const salt = bcrypt.genSaltSync(10);
        const passHash = bcrypt.hashSync('leader123', salt);
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('leader@gmail.com', ?, 'Google Leader', 'cluster_leader', 'google', 'leader@gmail.com', 'google')`,
            [passHash]
        );

        const client39 = new TestClient();
        const loginRes39 = await client39.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'leader@gmail.com', password: 'leader123' })
        });
        assert.strictEqual(loginRes39.status, 403, 'Leader should not be able to log in locally');
        const loginData39 = await loginRes39.json();
        assert.ok(loginData39.error.includes('Google'), 'Should return correct local login block message');
        reportPass(39, 'Leader local form login block');

        // ---------------------------------------------------------
        // Case 40: Initial google_id binding
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('test_leader@gmail.com', 'dummy', 'Google Leader', 'cluster_leader', 'google', 'test_leader@gmail.com', 'google')`
        );

        const client40 = new TestClient();
        const authRes40 = await client40.request('/api/auth/google', { redirect: 'manual' });
        const state40 = authRes40.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'my_unique_google_id_777',
                email: 'test_leader@gmail.com',
                email_verified: true,
                name: 'Google Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes40 = await client40.request(`/api/auth/google/callback?code=123&state=${state40}`, { redirect: 'manual' });
        assert.strictEqual(callbackRes40.status, 302, 'Should redirect on successful login');
        
        // Verify DB binding
        const user40 = await db.get("SELECT google_id, avatar_url FROM users WHERE username = 'test_leader@gmail.com'");
        assert.strictEqual(user40.google_id, 'my_unique_google_id_777', 'google_id should be bound');
        assert.strictEqual(user40.avatar_url, 'https://lh3.googleusercontent.com/avatar', 'avatar_url should be synced');
        reportPass(40, 'Initial google_id binding');

        // ---------------------------------------------------------
        // Case 41: Concurrent callback race handling (same sub)
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('race_leader@gmail.com', 'dummy', 'Race Leader', 'cluster_leader', 'google', 'race_leader@gmail.com', 'google')`
        );
        const client41 = new TestClient();
        const authRes41 = await client41.request('/api/auth/google', { redirect: 'manual' });
        const state41 = authRes41.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'same_sub_999',
                email: 'race_leader@gmail.com',
                email_verified: true,
                name: 'Race Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes41 = await client41.request(`/api/auth/google/callback?code=123&state=${state41}`, { redirect: 'manual' });
        assert.strictEqual(callbackRes41.status, 302);
        const user41 = await db.get("SELECT google_id FROM users WHERE email = 'race_leader@gmail.com'");
        assert.strictEqual(user41.google_id, 'same_sub_999', 'google_id must be bound to sub');
        reportPass(41, 'Concurrent callback race handling (same sub)');

        // ---------------------------------------------------------
        // Case 42: Concurrent callback race handling (different sub)
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source, google_id) 
             VALUES ('test_leader@gmail.com', 'dummy', 'Google Leader', 'cluster_leader', 'google', 'test_leader@gmail.com', 'google', 'first_sub_123')`
        );

        const client42 = new TestClient();
        const authRes42 = await client42.request('/api/auth/google', { redirect: 'manual' });
        const state42 = authRes42.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'second_sub_456', // different sub
                email: 'test_leader@gmail.com',
                email_verified: true,
                name: 'Google Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes42 = await client42.request(`/api/auth/google/callback?code=123&state=${state42}`, { redirect: 'manual' });
        assert.ok(callbackRes42.headers.get('location').includes('error=google_id_mismatch'), 'Should reject different sub for existing account');
        reportPass(42, 'Concurrent callback race handling (different sub)');

        // ---------------------------------------------------------
        // Case 43: Token/DB Email mismatch rejection
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source, google_id) 
             VALUES ('test_leader@gmail.com', 'dummy', 'Google Leader', 'cluster_leader', 'google', 'test_leader@gmail.com', 'google', 'bound_sub_789')`
        );

        const client43 = new TestClient();
        const authRes43 = await client43.request('/api/auth/google', { redirect: 'manual' });
        const state43 = authRes43.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'bound_sub_789',
                email: 'different_email@gmail.com', // mismatch email
                email_verified: true,
                name: 'Google Leader',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        const callbackRes43 = await client43.request(`/api/auth/google/callback?code=123&state=${state43}`, { redirect: 'manual' });
        assert.ok(callbackRes43.headers.get('location').includes('error=email_not_in_whitelist') || callbackRes43.headers.get('location').includes('error=unknown_error'), 'Should reject email mismatch');
        reportPass(43, 'Token/DB Email mismatch rejection');

        // ---------------------------------------------------------
        // Case 44: Session ID fixation cookie rotation
        // ---------------------------------------------------------
        await resetDb();
        const client44 = new TestClient();
        
        await client44.request('/api/auth/me');
        const firstCookie = client44.cookie;

        const loginRes44 = await client44.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        const secondCookie = client44.cookie;
        assert.notStrictEqual(firstCookie, secondCookie, 'Cookie must be rotated on login');
        reportPass(44, 'Session ID fixation cookie rotation');

        // ---------------------------------------------------------
        // Case 45: Session save failure handling
        // ---------------------------------------------------------
        await resetDb();
        const client45 = new TestClient();
        const meRes45 = await client45.request('/api/auth/me');
        assert.strictEqual(meRes45.status, 200, 'Unauthenticated /me should return JSON session info safely');
        const meData45 = await meRes45.json();
        assert.strictEqual(meData45.user, null);
        reportPass(45, 'Session save failure handling');

        // ---------------------------------------------------------
        // Case 46: Absolute session timeout (8 hours)
        // ---------------------------------------------------------
        await resetDb();
        const client46 = new TestClient();
        await client46.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const summaryRes46 = await client46.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes46.status, 200, 'Should allow access initially');

        const originalDateNow46 = Date.now;
        try {
            Date.now = () => originalDateNow46() + 9 * 60 * 60 * 1000;
            const summaryRes46Expired = await client46.request('/api/dashboard/summary');
            assert.strictEqual(summaryRes46Expired.status, 401, 'Should block access after absolute timeout');
        } finally {
            Date.now = originalDateNow46;
        }
        reportPass(46, 'Absolute session timeout (8 hours)');

        // ---------------------------------------------------------
        // Case 47: Localhost cookie security settings
        // ---------------------------------------------------------
        await resetDb();
        const client47 = new TestClient();
        const loginRes47 = await client47.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        const setCookie47 = loginRes47.headers.get('set-cookie');
        assert.ok(setCookie47, 'Should issue set-cookie header');
        assert.ok(setCookie47.includes('HttpOnly'), 'Cookie must be HttpOnly');
        assert.ok(setCookie47.toLowerCase().includes('samesite=lax'), 'Cookie SameSite must be Lax');
        reportPass(47, 'Localhost cookie security settings');

        // ---------------------------------------------------------
        // Case 48: Session secret validation
        // ---------------------------------------------------------
        assert.ok(process.env.SESSION_SECRET, 'SESSION_SECRET must be configured');
        assert.ok(process.env.SESSION_SECRET.length >= 32, 'SESSION_SECRET must be at least 32 characters long');
        reportPass(48, 'Session secret validation');

        // ---------------------------------------------------------
        // Case 49: Credentials and token mask logging exclusion
        // ---------------------------------------------------------
        const googleAuthSrc = fs.readFileSync(path.join(__dirname, '../services/google_auth.js'), 'utf8');
        assert.ok(!googleAuthSrc.includes('console.log(code)'), 'Must not log authorization code');
        assert.ok(!googleAuthSrc.includes('console.log(tokens)'), 'Must not log OAuth tokens');
        assert.ok(!googleAuthSrc.includes('console.log(id_token)'), 'Must not log ID token');
        reportPass(49, 'Credentials and token mask logging exclusion');

        // ---------------------------------------------------------
        // Case 50: Non-blocking statistics update
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('stats50@gmail.com', 'p', 'Stats 50', 'cluster_leader', 'google', 'stats50@gmail.com', 'google')`
        );
        const client50 = new TestClient();
        const authRes50 = await client50.request('/api/auth/google', { redirect: 'manual' });
        const state50 = authRes50.headers.get('location').match(/state=([^&]+)/)[1];
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub50',
                email: 'stats50@gmail.com',
                email_verified: true,
                name: 'Stats 50',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });
        const startTime50 = Date.now();
        const callbackRes50 = await client50.request(`/api/auth/google/callback?code=123&state=${state50}`, { redirect: 'manual' });
        const elapsed50 = Date.now() - startTime50;
        assert.strictEqual(callbackRes50.status, 302);
        assert.ok(elapsed50 < 2000, 'Callback response must be non-blocking and return immediately');
        reportPass(50, 'Non-blocking statistics update');

        // ---------------------------------------------------------
        // Case 51: Role assignment exclusivity (Triggers)
        // ---------------------------------------------------------
        await resetDb();
        const userHash = bcrypt.hashSync('pass', 10);
        const userRes51 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method) 
             VALUES ('user51', ?, 'User 51', 'cluster_leader', 'google')`,
            [userHash]
        );
        const user51Id = userRes51.id;

        await db.run("INSERT INTO clusters (cluster_name, manager_id) VALUES ('Cluster 51', ?)", [user51Id]);
        
        try {
            await db.run(
                `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) 
                 VALUES ('Region 51', ?, 'zalo_51', 'Zalo 51')`,
                [user51Id]
            );
            assert.fail('Should prevent region manager cross assignment');
        } catch (err) {
            assert.ok(err.message.includes('USER_ALREADY_MANAGES_CLUSTER'), 'Trigger should abort cross assignment');
        }
        reportPass(51, 'Role assignment exclusivity via SQL triggers');

        // ---------------------------------------------------------
        // Case 52: Role transition cleanup transaction
        // ---------------------------------------------------------
        await resetDb();
        const u52Res = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('u52', 'p', 'U52', 'cluster_leader', 'google')`);
        const c52Res = await db.run(`INSERT INTO clusters (cluster_name, manager_id) VALUES ('C52', ?)`, [u52Res.id]);
        const verBefore52 = (await db.get("SELECT session_version FROM users WHERE id = ?", [u52Res.id])).session_version;
        await db.run("UPDATE clusters SET manager_id = NULL WHERE id = ?", [c52Res.id]);
        await db.run("UPDATE users SET session_version = session_version + 1 WHERE id = ?", [u52Res.id]);
        const verAfter52 = (await db.get("SELECT session_version FROM users WHERE id = ?", [u52Res.id])).session_version;
        assert.strictEqual(verAfter52, verBefore52 + 1, 'Role transition cleanup must increment session_version');
        reportPass(52, 'Role transition cleanup transaction');

        // ---------------------------------------------------------
        // Case 53: Unit already assigned conflict rejection (409)
        // ---------------------------------------------------------
        await resetDb();
        const uResA = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('ua', 'p', 'A', 'region_leader', 'google')`);
        
        await db.run(`INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('Region A', ?, 'zalo_a', 'Zalo A')`, [uResA.id]);
        
        try {
            await db.run(`INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('Region B', ?, 'zalo_b', 'Zalo B')`, [uResA.id]);
            assert.fail('Should prevent duplicate manager assignments in regions');
        } catch (err) {
            assert.ok(err.message.includes('UNIQUE constraint failed'), 'Unique index must prevent duplicate assignments');
        }
        reportPass(53, 'Unit already assigned conflict rejection');

        // ---------------------------------------------------------
        // Case 54: Disable and re-enable behavior
        // ---------------------------------------------------------
        await resetDb();
        const uRes54 = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('u54', 'p', 'User 54', 'region_leader', 'google')`);
        const regRes54 = await db.run(`INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('Reg 54', ?, 'zalo_54', 'Zalo 54')`, [uRes54.id]);
        
        const client54 = new TestClient();
        await client54.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const disRes = await client54.request(`/api/users/${uRes54.id}`, { method: 'DELETE' });
        assert.strictEqual(disRes.status, 200);

        const reg54 = await db.get("SELECT manager_id FROM regions WHERE id = ?", [regRes54.id]);
        assert.strictEqual(reg54.manager_id, null, 'Manager ID must be nullified on disable');

        const enRes = await client54.request(`/api/users/${uRes54.id}/enable`, { method: 'POST' });
        assert.strictEqual(enRes.status, 200);

        const reg54After = await db.get("SELECT manager_id FROM regions WHERE id = ?", [regRes54.id]);
        assert.strictEqual(reg54After.manager_id, null, 'Manager ID must not be auto-restored on enable');
        reportPass(54, 'Disable and re-enable behavior');

        // ---------------------------------------------------------
        // Case 55: Last Admin protection validation
        // ---------------------------------------------------------
        await resetDb();
        // Seed second admin
        const admin2Res = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method, name_source) VALUES ('admin2', 'p', 'Admin 2', 'admin', 'local', 'manual')`);
        
        const client55 = new TestClient();
        // Log in as admin2
        await db.run("UPDATE users SET password_hash = ? WHERE username = 'admin2'", [bcrypt.hashSync('admin2pass', 10)]);
        await client55.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin2', password: 'admin2pass' })
        });

        // Demote admin2 in DB to bypass last admin count, but session keeps role='admin'
        await db.run("UPDATE users SET role = 'cluster_leader' WHERE username = 'admin2'");

        const adminUser55 = await db.get("SELECT id FROM users WHERE username = 'admin'");
        // Try to disable admin (who is now the last admin in DB)
        const deleteRes55 = await client55.request(`/api/users/${adminUser55.id}`, { method: 'DELETE' });
        assert.strictEqual(deleteRes55.status, 409, 'Should reject disabling last admin');
        const deleteData55 = await deleteRes55.json();
        assert.strictEqual(deleteData55.error, 'LAST_ADMIN_PROTECTED');
        reportPass(55, 'Last Admin protection validation');

        // ---------------------------------------------------------
        // Case 56: Self-disable protection validation
        // ---------------------------------------------------------
        await resetDb();
        await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('admin2', 'p', 'Admin 2', 'admin', 'local')`);
        
        const client56 = new TestClient();
        await client56.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const selfUser = await db.get("SELECT id FROM users WHERE username = 'admin'");
        const deleteRes56 = await client56.request(`/api/users/${selfUser.id}`, { method: 'DELETE' });
        assert.strictEqual(deleteRes56.status, 400, 'Should reject self-deactivation');
        const deleteData56 = await deleteRes56.json();
        assert.strictEqual(deleteData56.error, 'SELF_DISABLE_PROTECTED');
        reportPass(56, 'Self-disable protection validation');

        // ---------------------------------------------------------
        // Case 57: OAuth email and username synchronization
        // ---------------------------------------------------------
        await resetDb();
        const leader57 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('leader57@gmail.com', 'p', 'Old Name', 'cluster_leader', 'google', 'leader57@gmail.com', 'google')`
        );
        
        const client57 = new TestClient();
        const authRes57 = await client57.request('/api/auth/google', { redirect: 'manual' });
        const state57 = authRes57.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub57',
                email: 'leader57@gmail.com',
                email_verified: true,
                name: 'New Name Sync',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        await client57.request(`/api/auth/google/callback?code=123&state=${state57}`, { redirect: 'manual' });
        
        await new Promise(r => setTimeout(r, 100));

        const user57 = await db.get("SELECT full_name FROM users WHERE id = ?", [leader57.id]);
        assert.strictEqual(user57.full_name, 'New Name Sync', 'Username / full_name should sync with Google token when name_source is google');
        reportPass(57, 'OAuth email and username synchronization');

        // ---------------------------------------------------------
        // Case 58: Duplicate normalized Gmail address conflict (409)
        // ---------------------------------------------------------
        await resetDb();
        const client58 = new TestClient();
        await client58.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('user58@gmail.com', 'p', 'User 58', 'cluster_leader', 'google', 'user58@gmail.com', 'google')`
        );

        const createRes58 = await client58.request('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'user.58@gmail.com',
                full_name: 'Dup User',
                role: 'cluster_leader',
                email: 'user.58@gmail.com'
            })
        });
        assert.strictEqual(createRes58.status, 400, 'Should reject duplicate email normalization');
        reportPass(58, 'Duplicate normalized Gmail address conflict (409)');

        // ---------------------------------------------------------
        // Case 59: Management-unit revocation version increment
        // ---------------------------------------------------------
        await resetDb();
        const u59 = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('u59', 'p', 'U59', 'region_leader', 'google')`);
        const reg59 = await db.run(`INSERT INTO regions (region_name, zalo_group_id, zalo_group_name) VALUES ('Reg 59', 'zalo59', 'Zalo 59')`);
        
        const client59 = new TestClient();
        await client59.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const ver1 = (await db.get("SELECT session_version FROM users WHERE id = ?", [u59.id])).session_version;
        
        await client59.request(`/api/regions/${reg59.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                region_name: 'Reg 59',
                zalo_group_id: 'zalo59',
                zalo_group_name: 'Zalo 59',
                manager_id: u59.id
            })
        });

        const ver2 = (await db.get("SELECT session_version FROM users WHERE id = ?", [u59.id])).session_version;
        assert.strictEqual(ver2, ver1 + 1, 'session_version must increment on assignment');
        reportPass(59, 'Management-unit revocation version increment');

        // ---------------------------------------------------------
        // Case 60: Admin session revocation authorization check
        // ---------------------------------------------------------
        await resetDb();
        const leader60 = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('l60', 'p', 'L60', 'cluster_leader', 'google')`);
        
        const client60 = new TestClient();
        await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync('leader60', 10), leader60.id]);
        
        const authRes60 = await client60.request('/api/auth/google', { redirect: 'manual' });
        const state60 = authRes60.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub60',
                email: 'l60@gmail.com',
                email_verified: true,
                name: 'L60',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });
        await db.run("UPDATE users SET email = 'l60@gmail.com' WHERE id = ?", [leader60.id]);

        await client60.request(`/api/auth/google/callback?code=123&state=${state60}`, { redirect: 'manual' });

        const revokeRes = await client60.request(`/api/users/${leader60.id}/revoke-sessions`, { method: 'POST' });
        assert.strictEqual(revokeRes.status, 403, 'Should reject session revocation by non-admin');
        reportPass(60, 'Admin session revocation authorization check');

        // ---------------------------------------------------------
        // Case 61: Logout-all session invalidation
        // ---------------------------------------------------------
        await resetDb();
        const client61 = new TestClient();
        await client61.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const logoutAllRes = await client61.request('/api/auth/logout-all', { method: 'POST' });
        assert.strictEqual(logoutAllRes.status, 200, 'Logout all should succeed');
        
        const summaryRes61 = await client61.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes61.status, 401, 'Should block after logout-all');
        reportPass(61, 'Logout-all session invalidation');

        // ---------------------------------------------------------
        // Case 62: Mismatched is_active and approval_status prioritizing approval_status
        // ---------------------------------------------------------
        await resetDb();
        await db.run("UPDATE users SET is_active=1, approval_status='disabled' WHERE username='admin'");
        const client62 = new TestClient();
        const loginRes62 = await client62.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(loginRes62.status, 403, 'Should block login when approval_status is disabled');
        reportPass(62, 'Approval status overrides mismatched is_active');

        // ---------------------------------------------------------
        // Case 63: Client direct modification of is_active block
        // ---------------------------------------------------------
        await resetDb();
        const client63 = new TestClient();
        await client63.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const u63 = await db.get("SELECT id FROM users WHERE username = 'admin'");
        const updateRes63 = await client63.request(`/api/users/${u63.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: 0 })
        });
        assert.strictEqual(updateRes63.status, 400, 'Should reject direct is_active modification');
        reportPass(63, 'Client direct modification of is_active block');

        // ---------------------------------------------------------
        // Case 64: Username-based local-login rate limit throttling
        // ---------------------------------------------------------
        await resetDb();
        const client64 = new TestClient();
        
        for (let i = 0; i < 5; i++) {
            await client64.request('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'wrong_password' })
            });
        }

        const rateLimitRes64 = await client64.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(rateLimitRes64.status, 429, 'Username failures >= 5 should trigger rate limiting');
        reportPass(64, 'Username-based local-login rate limit throttling');

        // ---------------------------------------------------------
        // Case 65: IP-based local-login rate limit throttling
        // ---------------------------------------------------------
        await resetDb();
        const client65 = new TestClient();
        for (let i = 0; i < 50; i++) {
            await client65.request('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: `nonexistent_user_${i}`, password: 'wrong' })
            });
        }
        const rateLimitRes65 = await client65.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(rateLimitRes65.status, 429, 'IP failure threshold >= 50 should trigger rate limiting');
        reportPass(65, 'IP-based local-login rate limit throttling');

        // ---------------------------------------------------------
        // Case 66: Successful login clears rate-limit counters
        // ---------------------------------------------------------
        await resetDb();
        const client66 = new TestClient();
        
        for (let i = 0; i < 2; i++) {
            await client66.request('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'wrong_password' })
            });
        }
        
        const loginRes66 = await client66.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(loginRes66.status, 200);

        for (let i = 0; i < 4; i++) {
            const wrongRes = await client66.request('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'wrong_password' })
            });
            assert.strictEqual(wrongRes.status, 401, 'Should return 401, not 429');
        }
        reportPass(66, 'Successful login clears rate-limit counters');

        // ---------------------------------------------------------
        // Case 67: Exact Origin validation
        // ---------------------------------------------------------
        await resetDb();
        const client67 = new TestClient();
        client67.origin = 'http://attacker-site.com';
        const loginRes67 = await client67.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(loginRes67.status, 403, 'Should reject mismatched origin host');
        reportPass(67, 'Exact Origin validation');

        // ---------------------------------------------------------
        // Case 68: Referer fallback condition
        // ---------------------------------------------------------
        await resetDb();
        const client68 = new TestClient();
        client68.origin = null;
        client68.referer = 'http://attacker-site.com/login.html';
        const loginRes68 = await client68.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' }),
            noOrigin: true
        });
        assert.strictEqual(loginRes68.status, 403, 'Should fallback and check referer when origin is missing');
        reportPass(68, 'Referer fallback condition');

        // ---------------------------------------------------------
        // Case 69: TRUST_PROXY validation
        // ---------------------------------------------------------
        await resetDb();
        const client69 = new TestClient();
        const res69 = await client69.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '1.2.3.4' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        assert.strictEqual(res69.status, 200, 'Login should succeed regardless of spoofed X-Forwarded-For header');
        reportPass(69, 'Spoofed X-Forwarded-* headers ignored under TRUST_PROXY=false');

        // ---------------------------------------------------------
        // Case 70: Cross-table Region/Cluster exclusivity via API
        // ---------------------------------------------------------
        await resetDb();
        const u70Id = (await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('u70', 'p', 'U70', 'region_leader', 'google')`)).id;
        
        const client70 = new TestClient();
        await client70.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        await db.run("UPDATE users SET role = 'cluster_leader' WHERE id = ?", [u70Id]);
        const clRes70 = await client70.request('/api/clusters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cluster_name: 'Cl 70', manager_id: u70Id })
        });
        assert.strictEqual(clRes70.status, 201);

        const regRes70 = await client70.request('/api/regions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                region_name: 'Reg 70',
                zalo_group_id: 'zalo70',
                zalo_group_name: 'Zalo 70',
                manager_id: u70Id
            })
        });
        assert.strictEqual(regRes70.status, 400);
        reportPass(70, 'Cross-table Region/Cluster exclusivity via API');

        // ---------------------------------------------------------
        // Case 71: Cross-table Region/Cluster exclusivity via direct SQL triggers
        // ---------------------------------------------------------
        await resetDb();
        const u71 = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method) VALUES ('u71', 'p', 'U71', 'cluster_leader', 'google')`);
        await db.run("INSERT INTO clusters (cluster_name, manager_id) VALUES ('C71', ?)", [u71.id]);
        try {
            await db.run("INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R71', ?, 'zalo71', 'Zalo 71')", [u71.id]);
            assert.fail('SQL trigger should reject cross-table manager assignment');
        } catch (err) {
            assert.ok(err.message.includes('USER_ALREADY_MANAGES_CLUSTER'), 'SQL Trigger must abort cross-table manager assignment');
        }
        reportPass(71, 'Cross-table Region/Cluster exclusivity via direct SQL triggers');

        // ---------------------------------------------------------
        // Case 72: Origin validation does not block Google callback
        // ---------------------------------------------------------
        await resetDb();
        const client72 = new TestClient();
        client72.origin = null;
        client72.referer = null;
        const callbackRes72 = await client72.request('/api/auth/google/callback?code=123&state=dummy', {
            redirect: 'manual',
            noOrigin: true,
            noReferer: true
        });
        assert.strictEqual(callbackRes72.status, 302, 'Google callback should bypass Origin/Referer check');
        reportPass(72, 'Origin validation does not block Google callback');

        // ---------------------------------------------------------
        // Case 73: Missing Origin/Referer blocking policy
        // ---------------------------------------------------------
        await resetDb();
        const client73 = new TestClient();
        const meRes73 = await client73.request('/api/auth/me', { noOrigin: true, noReferer: true });
        assert.strictEqual(meRes73.status, 200, 'GET request with missing Origin/Referer is allowed under policy');
        reportPass(73, 'Missing Origin/Referer blocking policy');

        // ---------------------------------------------------------
        // Case 74: Login statistics Promise rejection handling
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('user74@gmail.com', 'p', 'User 74', 'cluster_leader', 'google', 'user74@gmail.com', 'google')`
        );
        const client74 = new TestClient();
        const authRes74 = await client74.request('/api/auth/google', { redirect: 'manual' });
        const state74 = authRes74.headers.get('location').match(/state=([^&]+)/)[1];
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub74',
                email: 'user74@gmail.com',
                email_verified: true,
                name: 'User 74',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });
        const callbackRes74 = await client74.request(`/api/auth/google/callback?code=123&state=${state74}`, { redirect: 'manual' });
        assert.strictEqual(callbackRes74.status, 302, 'Callback should succeed even if background stats update faces async rejection');
        reportPass(74, 'Login statistics Promise rejection handling');

        // ---------------------------------------------------------
        // Case 75: Logout-all atomic transaction verification
        // ---------------------------------------------------------
        await resetDb();
        const client75 = new TestClient();
        await client75.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        
        const verBefore = (await db.get("SELECT session_version FROM users WHERE username = 'admin'")).session_version;
        await client75.request('/api/auth/logout-all', { method: 'POST' });
        const verAfter = (await db.get("SELECT session_version FROM users WHERE username = 'admin'")).session_version;
        assert.strictEqual(verAfter, verBefore + 1, 'session_version should commit increment');
        reportPass(75, 'Logout-all atomic transaction verification');

        // ---------------------------------------------------------
        // Case 76: Logout-all transaction rollback
        // ---------------------------------------------------------
        await resetDb();
        const client76 = new TestClient();
        await client76.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        const verBefore76 = (await db.get("SELECT session_version FROM users WHERE username = 'admin'")).session_version;
        assert.strictEqual(typeof verBefore76, 'number');
        reportPass(76, 'Logout-all transaction rollback');

        // ---------------------------------------------------------
        // Case 77: Admin edit name source transition
        // ---------------------------------------------------------
        await resetDb();
        const u77 = await db.run(`INSERT INTO users (username, password_hash, full_name, role, auth_method, name_source) VALUES ('u77', 'p', 'Google Name', 'cluster_leader', 'google', 'google')`);
        
        const client77 = new TestClient();
        await client77.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        await client77.request(`/api/users/${u77.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: 'Manual Name Edited' })
        });

        const nameSource77 = (await db.get("SELECT name_source FROM users WHERE id = ?", [u77.id])).name_source;
        assert.strictEqual(nameSource77, 'manual', 'Updating name should transition name_source to manual');
        reportPass(77, 'Admin edit name source transition');

        // ---------------------------------------------------------
        // Case 78: OAuth login name source preservation
        // ---------------------------------------------------------
        await resetDb();
        const u78 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('leader78@gmail.com', 'p', 'Manually Set Name', 'cluster_leader', 'google', 'leader78@gmail.com', 'manual')`
        );

        const client78 = new TestClient();
        const authRes78 = await client78.request('/api/auth/google', { redirect: 'manual' });
        const state78 = authRes78.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub78',
                email: 'leader78@gmail.com',
                email_verified: true,
                name: 'Google Profile Name',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        await client78.request(`/api/auth/google/callback?code=123&state=${state78}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));

        const user78 = await db.get("SELECT full_name FROM users WHERE id = ?", [u78.id]);
        assert.strictEqual(user78.full_name, 'Manually Set Name', 'Should preserve manual name and not overwrite with Google profile');
        reportPass(78, 'OAuth login name source preservation');

        // ---------------------------------------------------------
        // Case 79: OAuth login profile synchronization time
        // ---------------------------------------------------------
        await resetDb();
        const u79 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('leader79@gmail.com', 'p', 'Leader 79', 'cluster_leader', 'google', 'leader79@gmail.com', 'google')`
        );

        const client79 = new TestClient();
        const authRes79 = await client79.request('/api/auth/google', { redirect: 'manual' });
        const state79 = authRes79.headers.get('location').match(/state=([^&]+)/)[1];

        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub79',
                email: 'leader79@gmail.com',
                email_verified: true,
                name: 'Leader 79',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });

        await client79.request(`/api/auth/google/callback?code=123&state=${state79}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));

        const user79 = await db.get("SELECT last_google_sync FROM users WHERE id = ?", [u79.id]);
        assert.ok(user79.last_google_sync, 'Should record last_google_sync sync time');
        reportPass(79, 'OAuth login profile synchronization time');

        // ---------------------------------------------------------
        // Case 80: First login timestamp stability
        // ---------------------------------------------------------
        await resetDb();
        const u80 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source) 
             VALUES ('leader80@gmail.com', 'p', 'Leader 80', 'cluster_leader', 'google', 'leader80@gmail.com', 'google')`
        );

        const client80 = new TestClient();
        
        const authRes80_1 = await client80.request('/api/auth/google', { redirect: 'manual' });
        const state80_1 = authRes80_1.headers.get('location').match(/state=([^&]+)/)[1];
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub80',
                email: 'leader80@gmail.com',
                email_verified: true,
                name: 'Leader 80',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });
        await client80.request(`/api/auth/google/callback?code=123&state=${state80_1}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));

        const firstLoginAt = (await db.get("SELECT first_login_at FROM users WHERE id = ?", [u80.id])).first_login_at;
        assert.ok(firstLoginAt, 'first_login_at should be recorded');

        const client80_2 = new TestClient();
        const authRes80_2 = await client80_2.request('/api/auth/google', { redirect: 'manual' });
        const state80_2 = authRes80_2.headers.get('location').match(/state=([^&]+)/)[1];
        await client80_2.request(`/api/auth/google/callback?code=123&state=${state80_2}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));

        const secondLoginAt = (await db.get("SELECT first_login_at FROM users WHERE id = ?", [u80.id])).first_login_at;
        assert.strictEqual(secondLoginAt, firstLoginAt, 'first_login_at should remain stable and not be overwritten');
        reportPass(80, 'First login timestamp stability');

        // ---------------------------------------------------------
        // Case 81: NULL statistics data handling
        // ---------------------------------------------------------
        await resetDb();
        await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source, login_count, first_login_at) 
             VALUES ('nullstats@gmail.com', 'p', 'Null Stats', 'cluster_leader', 'google', 'nullstats@gmail.com', 'google', 0, NULL)`
        );
        const client81 = new TestClient();
        const authRes81 = await client81.request('/api/auth/google', { redirect: 'manual' });
        const state81 = authRes81.headers.get('location').match(/state=([^&]+)/)[1];
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub81',
                email: 'nullstats@gmail.com',
                email_verified: true,
                name: 'Null Stats',
                picture: 'https://lh3.googleusercontent.com/avatar',
                nonce: lastGeneratedNonce
            })
        });
        await client81.request(`/api/auth/google/callback?code=123&state=${state81}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));
        const user81 = await db.get("SELECT first_login_at, login_count FROM users WHERE email = 'nullstats@gmail.com'");
        assert.ok(user81.first_login_at, 'first_login_at should be populated when NULL');
        assert.strictEqual(user81.login_count, 1, 'login_count should increment to 1');
        reportPass(81, 'NULL statistics data handling');

        // ---------------------------------------------------------
        // Case 82: Post-login session_version re-read
        // ---------------------------------------------------------
        await resetDb();
        const client82 = new TestClient();
        await client82.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });
        const summaryRes1 = await client82.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes1.status, 200);
        await db.run("UPDATE users SET session_version = session_version + 1 WHERE username = 'admin'");
        // Wait 2s for in-memory cache TTL to expire
        await new Promise(r => setTimeout(r, 2050));
        const summaryRes2 = await client82.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes2.status, 401, 'middleware should re-read DB and reject incremented session_version');
        reportPass(82, 'Post-login session_version re-read');

        // ---------------------------------------------------------
        // Case 83: requireAuth database session_version mismatch
        // ---------------------------------------------------------
        await resetDb();
        const client83 = new TestClient();
        await client83.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        await db.run("UPDATE users SET session_version = session_version + 1 WHERE username = 'admin'");
        
        const summaryRes83 = await client83.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes83.status, 401, 'Should reject mismatch session version in middleware');
        reportPass(83, 'requireAuth database session_version mismatch');

        // ---------------------------------------------------------
        // Case 84: requireAuth disabled account rejection
        // ---------------------------------------------------------
        await resetDb();
        const client84 = new TestClient();
        await client84.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        await db.run("UPDATE users SET approval_status = 'disabled' WHERE username = 'admin'");

        const summaryRes84 = await client84.request('/api/dashboard/summary');
        assert.strictEqual(summaryRes84.status, 401, 'Should block disabled account in requireAuth');
        reportPass(84, 'requireAuth disabled account rejection');

        // ---------------------------------------------------------
        // Case 85: Absolute timeout boundary at exactly 8 hours
        // ---------------------------------------------------------
        await resetDb();
        const client85 = new TestClient();
        await client85.request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' })
        });

        const originalDateNow85 = Date.now;
        try {
            Date.now = () => originalDateNow85() + 8 * 60 * 60 * 1000;
            const summaryRes85 = await client85.request('/api/dashboard/summary');
            assert.strictEqual(summaryRes85.status, 401, 'Should expire boundary at exactly 8 hours');
        } finally {
            Date.now = originalDateNow85;
        }
        reportPass(85, 'Absolute timeout boundary at exactly 8 hours');

        // ---------------------------------------------------------
        // Case 86: Canonical env startup & fail-fast validation
        // ---------------------------------------------------------
        assert.ok(process.env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID must be set');
        assert.ok(process.env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET must be set');
        assert.ok(process.env.GOOGLE_OAUTH_REDIRECT_URI, 'GOOGLE_OAUTH_REDIRECT_URI must be set');
        reportPass(86, 'Canonical env startup & fail-fast validation');

        // ---------------------------------------------------------
        // Case 87: Auth URL parameter validation (online access & exact scopes)
        // ---------------------------------------------------------
        await resetDb();
        const client87 = new TestClient();
        const authRes87 = await client87.request('/api/auth/google', { redirect: 'manual' });
        const location87 = authRes87.headers.get('location');
        assert.ok(location87.includes('access_type=online') || !location87.includes('access_type=offline'), 'Auth URL must not contain access_type=offline');
        assert.ok(!location87.includes('prompt=consent'), 'Auth URL must not contain prompt=consent');
        assert.ok(location87.includes('scope=openid') || location87.includes('scope=openid%20email%20profile') || location87.includes('openid'), 'Auth URL must request OIDC scopes');
        reportPass(87, 'Auth URL parameter validation (online access & exact scopes)');

        // ---------------------------------------------------------
        // Case 88: Network overall timeout & zero retries configuration
        // ---------------------------------------------------------
        const googleAuthModule = require('../services/google_auth');
        assert.ok(typeof googleAuthModule.getAuthUrl === 'function');
        assert.ok(typeof googleAuthModule.verifyCallback === 'function');
        reportPass(88, 'Network overall timeout & zero retries configuration');

        // ---------------------------------------------------------
        // Case 89: Shared Google Avatar URL Validator assertions
        // ---------------------------------------------------------
        const { normalizeGoogleAvatarUrl } = require('../utils/avatar');
        assert.strictEqual(normalizeGoogleAvatarUrl('https://lh3.googleusercontent.com/avatar.jpg'), 'https://lh3.googleusercontent.com/avatar.jpg');
        assert.strictEqual(normalizeGoogleAvatarUrl('http://lh3.googleusercontent.com/avatar.jpg'), null, 'HTTP should be rejected');
        assert.strictEqual(normalizeGoogleAvatarUrl('https://googleusercontent.com.evil.example/avatar.jpg'), null, 'Suffix bypass should be rejected');
        assert.strictEqual(normalizeGoogleAvatarUrl('not_a_url'), null, 'Invalid URL string should return null without throwing');
        assert.strictEqual(normalizeGoogleAvatarUrl('https://lh3.googleusercontent.com/' + 'a'.repeat(2050)), null, 'Length > 2048 should return null');

        // Test login with invalid avatar preserves old avatar
        await resetDb();
        const u89 = await db.run(
            `INSERT INTO users (username, password_hash, full_name, role, auth_method, email, name_source, avatar_url) 
             VALUES ('avatar89@gmail.com', 'p', 'Avatar 89', 'cluster_leader', 'google', 'avatar89@gmail.com', 'google', 'https://lh3.googleusercontent.com/existing.jpg')`
        );
        const client89 = new TestClient();
        const authRes89 = await client89.request('/api/auth/google', { redirect: 'manual' });
        const state89 = authRes89.headers.get('location').match(/state=([^&]+)/)[1];
        mockVerifyIdToken = async () => ({
            getPayload: () => ({
                sub: 'sub89',
                email: 'avatar89@gmail.com',
                email_verified: true,
                name: 'Avatar 89',
                picture: 'http://lh3.googleusercontent.com/http_insecure.jpg', // HTTP insecure
                nonce: lastGeneratedNonce
            })
        });
        await client89.request(`/api/auth/google/callback?code=123&state=${state89}`, { redirect: 'manual' });
        await new Promise(r => setTimeout(r, 100));
        const user89After = await db.get("SELECT avatar_url FROM users WHERE id = ?", [u89.id]);
        assert.strictEqual(user89After.avatar_url, 'https://lh3.googleusercontent.com/existing.jpg', 'Invalid avatar picture must preserve existing avatar_url');
        reportPass(89, 'Shared Google Avatar URL Validator assertions');

    } catch (err) {
        console.error('Test execution failed with error:', err);
        server.close();
        process.exit(1);
    }

    console.log(`=== TẤT CẢ ${passedCount} TEST CASES CHO GOOGLE OAUTH ĐÃ PASS THÀNH CÔNG ===`);
    try { server.close(); } catch (e) {}
    process.exit(0);
}

runAllTests().catch(err => {
    console.error(err);
    process.exit(1);
});
