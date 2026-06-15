/**
 * Test d'intégration — Messages du harvest enregistrés en base
 * ============================================================
 *
 * Pourquoi pas le vrai `node scripts/harvest.js` ?
 *   harvest.js lance 3 sous-processus (followers / engagement / prospect) qui
 *   ouvrent un navigateur Playwright et se connectent à Instagram. Impossible
 *   à exécuter dans un test automatique (réseau + login + comportement humain).
 *
 * Ce que ce test vérifie réellement (le cœur du harvest) :
 *   1. La config du compte est bien lue (loadOutreachConfig — vraie fonction).
 *   2. Le message construit (prospector + engagement) est correct.
 *   3. Il est bien ENREGISTRÉ en base via addToOutreachQueue (vraie fonction),
 *      dans la table outreach_queue, avec le bon `prepared_message`.
 *
 * La construction du message reproduit fidèlement la logique inline des
 * workers (non exportée) :
 *   - agents/prospector/src/prospect_worker.js   (message à froid)
 *   - agents/dmresponder/src/engagement_watcher.js (like / commentaire)
 *   - agents/dmresponder/src/follower_watcher.js   (abonnement)
 *
 * Lancer :  node --test tests/harvest-messages.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    initDatabase,
    closeDatabase,
    getOrCreateAccount,
    addToOutreachQueue,
    getQueuedLeads
} from '../agents/collector/src/db/index.js';
import { loadProfileConfig } from '../shared/utils/configLoader.js';
import { loadOutreachConfig } from '../shared/utils/outreachConfigLoader.js';

const PROFILE = 'melanie';
let TMP_DB;
let accountId;
let outreachConfig;

before(async () => {
    // Base SQLite temporaire isolée (ne touche pas permanent-data/leads.db)
    TMP_DB = path.join(os.tmpdir(), `harvest-test-${Date.now()}.db`);
    await initDatabase(TMP_DB);

    accountId = getOrCreateAccount(PROFILE).id;

    // Vraie chaîne de config : fichier config/profiles/melanie.config.js
    // (la BDD temporaire n'a pas de persona -> fallback fichier de config)
    const profileConfig = await loadProfileConfig(PROFILE);
    outreachConfig = loadOutreachConfig(accountId, profileConfig);
});

after(() => {
    closeDatabase();
    try { fs.rmSync(TMP_DB, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(TMP_DB + '-wal', { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(TMP_DB + '-shm', { force: true }); } catch { /* ignore */ }
});

// --- Reproductions fidèles de la logique des workers --------------------------

// Miroir de agents/prospector/src/prospect_worker.js (préparation finalMessage)
function buildProspectMessage(cfg, name, variant = 'A') {
    let finalMessage = '';
    const a = cfg.prospectMessageA;
    const b = cfg.prospectMessageB;
    if (variant === 'B' && b) {
        finalMessage = b.replace('{name}', name || '').replace('{accomp}', '');
    } else if (variant === 'A' && a) {
        finalMessage = a.replace('{name}', name || '');
    } else if (name) {
        finalMessage = `${name} ?`;
    } else {
        finalMessage = cfg.prospectGreetingNoName || 'Hello !';
    }
    return finalMessage.replace(/\s+,/g, ',').replace(/\s+!/g, ' !').trim();
}

// Miroir de engagement_watcher.js / follower_watcher.js (placeholder {{firstName}})
function buildEngagementMessage(template, name) {
    let finalMessage;
    if (!template || template.length < 10) {
        template = 'Hello ! Merci pour ton interaction sur mon dernier post 🌸';
    }
    if (name) {
        const n = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        finalMessage = template.replace(/{{firstName}}/g, n).replace(/\s+/g, ' ').trim();
    } else {
        finalMessage = template.replace(/{{firstName}}/g, '').replace(/\s+/g, ' ').trim();
        if (finalMessage.startsWith('!')) finalMessage = 'Hello ' + finalMessage;
    }
    return finalMessage.replace(/\s+/g, ' ').trim();
}

// Insère en file puis relit le prepared_message réellement stocké en base
function queueAndRead(username, message, source) {
    addToOutreachQueue({
        username,
        profile_url: `https://www.instagram.com/${username}/`,
        prepared_message: message,
        first_name: null,
        source,
        account_id: accountId,
        variant: 'A'
    });
    const row = getQueuedLeads(50, accountId).find(r => r.username === username);
    assert.ok(row, `Lead @${username} introuvable dans outreach_queue`);
    return row.prepared_message;
}

// --- Tests -------------------------------------------------------------------

test('config Mélanie chargée correctement', () => {
    assert.strictEqual(outreachConfig.prospectGreetingNoName, 'Hello :)');
    assert.match(outreachConfig.likeTemplate, /ton like/);
    assert.match(outreachConfig.commentTemplate, /ton commentaire/);
    assert.match(outreachConfig.followerTemplate, /ton abonnement/);
});

test('PROSPECTOR — avec prénom → "Marie ?" enregistré en base', () => {
    const msg = buildProspectMessage(outreachConfig, 'Marie');
    const stored = queueAndRead('prospect_named', msg, 'prospect');
    assert.strictEqual(stored, 'Marie ?');
});

test('PROSPECTOR — sans prénom → "Hello :)" enregistré en base', () => {
    const msg = buildProspectMessage(outreachConfig, null);
    const stored = queueAndRead('prospect_noname', msg, 'prospect');
    assert.strictEqual(stored, 'Hello :)');
});

test('ENGAGEMENT like — message correct enregistré en base', () => {
    const expected = "Hello Marie ! Merci pour ton like ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?";
    const msg = buildEngagementMessage(outreachConfig.likeTemplate, 'marie');
    const stored = queueAndRead('like_named', msg, 'post_like');
    assert.strictEqual(stored, expected);
});

test('ENGAGEMENT commentaire — "like" remplacé par "commentaire"', () => {
    const expected = "Hello Marie ! Merci pour ton commentaire ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?";
    const msg = buildEngagementMessage(outreachConfig.commentTemplate, 'marie');
    const stored = queueAndRead('comment_named', msg, 'post_comment');
    assert.strictEqual(stored, expected);
});

test('ENGAGEMENT abonnement — "like" remplacé par "abonnement"', () => {
    const expected = "Hello Marie ! Merci pour ton abonnement ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?";
    const msg = buildEngagementMessage(outreachConfig.followerTemplate, 'marie');
    const stored = queueAndRead('follower_named', msg, 'follower');
    assert.strictEqual(stored, expected);
});

test('ENGAGEMENT like — sans prénom → "Hello !" propre (pas de double espace)', () => {
    const msg = buildEngagementMessage(outreachConfig.likeTemplate, null);
    const stored = queueAndRead('like_noname', msg, 'post_like');
    assert.ok(stored.startsWith('Hello ! Merci pour ton like'), `Reçu: ${stored}`);
    assert.ok(!stored.includes('  '), 'Le message contient un double espace');
});
