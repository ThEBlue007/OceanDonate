const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const { JSDOM } = require('jsdom');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const { io } = require('socket.io-client');
const { createAlertResumeScheduler } = require('../alert-resume-scheduler');

const projectRoot = path.resolve(__dirname, '../..');
const serverPath = path.join(projectRoot, 'Backend/server.js');
const frontendPath = path.join(projectRoot, 'Frontendd');
const jwtSecret = 'security-test-secret-not-for-production';
const mongoDownloadPath = path.join(os.tmpdir(), 'oceandonate-mongodb-test-binaries');

let mongo;
let mongoUri;
let serverProcess;
let baseUrl;
let dbConnection;
let username;
let token;
let widgetToken;
let slipApiServer;
let slipApiPort;
let mockGoogleProfile = { sub: 'google-subject-1', email: 'oauth-user@example.test', email_verified: true };

function findFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function socketEvent(socket, name, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(name, onEvent);
            reject(new Error(`Timed out waiting for Socket.IO event: ${name}`));
        }, timeoutMs);
        function onEvent(value) {
            clearTimeout(timer);
            resolve(value);
        }
        socket.once(name, onEvent);
    });
}

function connectSocket() {
    return new Promise((resolve, reject) => {
        const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, timeout: 5000 });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

test('alert resume scheduler replaces old deadlines and pumps the queue at the latest deadline', async () => {
    let nextId = 0;
    const timers = [];
    const resumed = [];
    const scheduler = createAlertResumeScheduler({
        setTimeoutFn(callback, milliseconds) {
            const timer = { id: ++nextId, callback, milliseconds, cleared: false, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) { timer.cleared = true; }
    });
    scheduler.schedule('streamer', new Date(Date.now() + 1_000), async username => resumed.push(username));
    scheduler.schedule('streamer', new Date(Date.now() + 2_000), async username => resumed.push(username));
    assert.equal(timers[0].cleared, true);
    assert.ok(timers[1].milliseconds > 1_500 && timers[1].milliseconds <= 2_000);
    timers[1].callback();
    await Promise.resolve();
    assert.deepEqual(resumed, ['streamer']);
});

async function registerAndLogin() {
    const email = `${username}@example.test`;
    const registered = await request(baseUrl).post('/api/register').send({ username, email, password: 'test-password-123' });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    const login = await request(baseUrl).post('/api/login').send({ email, password: 'test-password-123' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    token = login.body.token;
    widgetToken = login.body.widgetToken;
}

before(async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = mongoDownloadPath;
    slipApiPort = await findFreePort();
    slipApiServer = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/google-token') return res.end(JSON.stringify({ access_token: 'mock-provider-access-token', token_type: 'Bearer' }));
        if (req.url === '/google-profile') return res.end(JSON.stringify(mockGoogleProfile));
        let rawBody = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { rawBody += chunk; });
        req.on('end', () => {
            const body = JSON.parse(rawBody || '{}');
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/bank-accounts') {
                return res.end(JSON.stringify({ success: true, data: { id: 991 } }));
            }
            if (req.url === '/verify/bank') {
                const isBadReceiver = body.base64.includes('BADRECIPIENT');
                const isDuplicate = body.base64.includes('DUPLICATE');
                const ref = body.base64.includes('REUSED') ? 'same-transfer-ref' : 'ref-' + body.base64.slice(-12);
                return res.end(JSON.stringify({ success: true, data: {
                    isDuplicate,
                    matchedAccount: { bankCode: '002', bankNumber: isBadReceiver ? '9999999999' : '1234567890', nameTh: 'ผู้รับทดสอบ' },
                    amountInSlip: body.matchAmount,
                    isAmountMatched: !body.base64.includes('WRONGAMOUNT'),
                    rawSlip: { transRef: ref, date: body.base64.includes('OLD') ? new Date(Date.now() - 60 * 60 * 1000).toISOString() : new Date().toISOString(), amount: { amount: body.base64.includes('WRONGAMOUNT') ? body.matchAmount + 1 : body.matchAmount } }
                } }));
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }));
        });
    });
    await new Promise(resolve => slipApiServer.listen(slipApiPort, '127.0.0.1', resolve));

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoUri = mongo.getUri();
    dbConnection = await mongoose.createConnection(mongoUri).asPromise();

    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, [serverPath], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), MONGODB_URI: mongoUri, JWT_SECRET: jwtSecret, NODE_ENV: 'test', APP_BASE_URL: `http://127.0.0.1:${port}`, GOOGLE_CLIENT_ID: 'google-test-client', GOOGLE_CLIENT_SECRET: 'google-test-secret', OAUTH_GOOGLE_TOKEN_URL: `http://127.0.0.1:${slipApiPort}/google-token`, OAUTH_GOOGLE_PROFILE_URL: `http://127.0.0.1:${slipApiPort}/google-profile`, DISCORD_CLIENT_ID: 'not-a-discord-snowflake', DISCORD_CLIENT_SECRET: 'discord-test-secret', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '', EASYSLIP_API_KEY: 'test-easyslip-key', EASYSLIP_API_BASE_URL: `http://127.0.0.1:${slipApiPort}` },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
    serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });
    const startedAt = Date.now();
    while (!output.includes('Server running on port') || !output.includes('Connected to MongoDB:')) {
        if (serverProcess.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
        if (Date.now() - startedAt > 15000) throw new Error(`Test server did not start:\n${output}`);
        await delay(50);
    }
    assert.ok(!output.includes('Duplicate schema index on {"userId":1} for model "AlertQueue"'));

    username = `security-${Date.now()}`;
    await registerAndLogin();
}, { timeout: 180000 });

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await Promise.race([once(serverProcess, 'exit'), delay(5000)]);
    }
    if (dbConnection) await dbConnection.close();
    if (mongo) await mongo.stop();
    if (slipApiServer) await new Promise(resolve => slipApiServer.close(resolve));
});

test('dashboard settings never persist or emit a client JWT, including legacy settings', async () => {
    const users = dbConnection.collection('users');
    await users.updateOne({ username }, { $set: {
        'goalSettings.token': 'legacy-goal-jwt',
        'alertSettings.token': 'legacy-alert-jwt',
        'topDonorSettings.token': 'legacy-top-donor-jwt'
    } });

    const dashboard = await connectSocket();
    const initialGoal = socketEvent(dashboard, 'apply_goal');
    const initialAlert = socketEvent(dashboard, 'apply_settings');
    const initialTopDonor = socketEvent(dashboard, 'apply_top_donor');
    const authenticated = socketEvent(dashboard, 'auth_success');
    dashboard.emit('auth_dashboard', { token, username });
    await authenticated;
    for (const settings of await Promise.all([initialGoal, initialAlert, initialTopDonor])) {
        assert.equal(settings.token, undefined);
    }

    const updatedGoal = socketEvent(dashboard, 'apply_goal');
    dashboard.emit('update_goal', { username, token, title: 'Safe goal', target: 100, current: 10 });
    assert.equal((await updatedGoal).token, undefined);
    let storedUser = await users.findOne({ username });
    assert.equal(storedUser.goalSettings.token, undefined);

    const updatedAlert = socketEvent(dashboard, 'apply_settings');
    dashboard.emit('update_alert', { username, token, layout: 'main', sound: 'boing' });
    assert.equal((await updatedAlert).token, undefined);

    const updatedTopDonor = socketEvent(dashboard, 'apply_top_donor');
    dashboard.emit('update_top_donor', { username, token, title: 'Safe leaderboard' });
    assert.equal((await updatedTopDonor).token, undefined);
    storedUser = await users.findOne({ username });
    assert.equal(storedUser.alertSettings.token, undefined);
    assert.equal(storedUser.topDonorSettings.token, undefined);

    const socialUpdate = socketEvent(dashboard, 'apply_social');
    dashboard.emit('save_social', {
        username,
        token,
        youtube: 'javascript:alert(1)',
        facebook: 'https://example.test/channel',
        twitch: 'data:text/html,alert(1)'
    });
    assert.deepEqual(await socialUpdate, {
        youtube: '',
        facebook: 'https://example.test/channel',
        twitch: ''
    });
    const updatedUser = await users.findOne({ username });
    assert.equal(updatedUser.socialLinks.youtube, '');
    dashboard.disconnect();
});

test('public profile clients do not receive owner history, stats, goals, or widget alerts', async () => {
    const publicSocket = await connectSocket();
    const received = [];
    publicSocket.onAny(eventName => received.push(eventName));
    publicSocket.emit('join_profile', username);

    const donor = await connectSocket();
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;
    const ownerGoal = socketEvent(owner, 'apply_goal');
    owner.emit('update_goal', { username, token, title: 'Private goal', target: 100, current: 20 });
    await ownerGoal;
    const donationResult = socketEvent(donor, 'donation_rejected');
    donor.emit('new_donation', { username, name: 'Test donor', amount: 7, message: 'public room test' });
    await donationResult;
    await delay(200);
    const storedUser = await dbConnection.collection('users').findOne({ username });
    assert.equal(storedUser.stats.total, 0);
    assert.equal(storedUser.history.length, 0);

    for (const privateEvent of ['update_history', 'update_stats', 'apply_goal', 'show_alert']) {
        assert.equal(received.includes(privateEvent), false, `public socket received ${privateEvent}`);
    }

    publicSocket.disconnect();
    donor.disconnect();
    owner.disconnect();
});

test('verified slips credit once; wrong receiver and reused transaction do not add totals', async () => {
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;

    const timerConfigured = socketEvent(owner, 'apply_timer');
    owner.emit('timer_config', { username, token, initialSeconds: 3600, amountRules: [{ minAmount: 20, maxAmount: 50, action: 'add', seconds: 30 }] });
    await timerConfigured;

    const paused = socketEvent(owner, 'apply_alert_control');
    owner.emit('pause_alerts', { username, token, minutes: 5 });
    await paused;

    const bankSaved = socketEvent(owner, 'apply_payment');
    owner.emit('save_payment', { username, token, type: 'bank', data: {
        active: true, bankName: 'กรุงเทพ (BBL)', accountNumber: '123-4-56789-0',
        accountName: 'ผู้รับทดสอบ', accountNameEn: 'TEST RECEIVER'
    } });
    const bankSettings = await bankSaved;
    assert.equal(bankSettings.bank.verifiedAccountId, 991);

    const promptpaySaved = socketEvent(owner, 'apply_payment');
    owner.emit('save_payment', { username, token, type: 'promptpay', data: { active: true, phone: '0812345678' } });
    await promptpaySaved;

    const ownerRecord = await dbConnection.collection('users').findOne({ username });
    await dbConnection.collection('giftcatalogitems').insertOne({ userId: ownerRecord._id, giftId: 'gift-test', name: 'Test Gem', price: 40, iconId: 'gem', effectId: 'sparkle', active: true, timerAction: 'add', seconds: 15 });
    const giftOrder = await request(baseUrl).post('/api/donations').send({ username, paymentMethod: 'promptpay', amount: 1, giftId: 'gift-test', name: 'Gift donor' });
    assert.equal(giftOrder.status, 201, JSON.stringify(giftOrder.body));
    assert.equal(giftOrder.body.amount, 40);
    const giftSnapshot = await dbConnection.collection('donations').findOne({ _id: new mongoose.Types.ObjectId(String(giftOrder.body.donationId)) });
    assert.equal(giftSnapshot.giftSnapshot.price, 40);
    const publicProfile = await request(baseUrl).get(`/api/streamer/${username}`);
    assert.equal(publicProfile.body.giftCatalog[0].name, 'Test Gem');
    assert.equal(publicProfile.body.giftCatalog[0].timerAction, undefined);

    const widget = await connectSocket();
    const widgetSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken });
    await widgetSettings;
    const showAlert = socketEvent(widget, 'show_alert');

    const order = await request(baseUrl).post('/api/donations').send({
        username, paymentMethod: 'promptpay', amount: 25.5, name: 'Verified donor', message: 'thanks'
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.match(order.body.qrUrl, /0812345678\/25\.50\.png/);
    let user = await dbConnection.collection('users').findOne({ username });
    assert.equal(user.stats.total, 0);
    assert.equal(await dbConnection.collection('donations').countDocuments({ username, status: 'pending' }), 2);

    await dbConnection.collection('users').updateOne({ username }, { $set: { 'paymentMethods.bank.accountNumber': '999-9-99999-9', 'paymentMethods.bank.accountName': 'บัญชีใหม่' } });
    const confirmed = await request(baseUrl).post(`/api/donations/${order.body.donationId}/slip`).send({ base64: 'data:image/png;base64,SLIPREUSED00001' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const queuedAlert = await dbConnection.collection('alertqueues').findOne({ donationId: new mongoose.Types.ObjectId(String(order.body.donationId)) });
    assert.equal(queuedAlert.status, 'queued');
    const resumed = socketEvent(owner, 'apply_alert_control');
    owner.emit('resume_alerts', { username, token });
    await resumed;
    const confirmedAlert = await showAlert;
    assert.equal(confirmedAlert.name, 'Verified donor');
    widget.emit('alert_finished', { queueId: confirmedAlert.queueId });
    let queueAcknowledged = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        const queueEntry = await dbConnection.collection('alertqueues').findOne({ _id: new mongoose.Types.ObjectId(confirmedAlert.queueId) });
        if (queueEntry?.status === 'played') { queueAcknowledged = true; break; }
        await delay(10);
    }
    assert.equal(queueAcknowledged, true, 'completed OBS alert should be acknowledged before disconnect');
    assert.equal(await dbConnection.collection('alertqueues').countDocuments({ username, donationId: new mongoose.Types.ObjectId(String(order.body.donationId)) }), 1);
    await dbConnection.collection('users').updateOne({ username }, { $set: { 'paymentMethods.bank.accountNumber': '123-4-56789-0', 'paymentMethods.bank.accountName': 'ผู้รับทดสอบ' } });
    user = await dbConnection.collection('users').findOne({ username });
    assert.equal(user.stats.total, 25.5);
    assert.equal(user.stats.today, 25.5);
    assert.equal(user.timerState.bankedSeconds, 30);

    const second = await request(baseUrl).post('/api/donations').send({ username, paymentMethod: 'promptpay', amount: 25.5, name: 'Second donor' });
    assert.equal(second.status, 201);
    const reused = await request(baseUrl).post(`/api/donations/${second.body.donationId}/slip`).send({ base64: 'data:image/png;base64,SLIPREUSED00002' });
    assert.equal(reused.status, 409, JSON.stringify(reused.body));
    const wrongReceiverOrder = await request(baseUrl).post('/api/donations').send({ username, paymentMethod: 'promptpay', amount: 25.5, name: 'Wrong receiver' });
    assert.equal(wrongReceiverOrder.status, 201);
    const wrongReceiver = await request(baseUrl).post(`/api/donations/${wrongReceiverOrder.body.donationId}/slip`).send({ base64: 'data:image/png;base64,BADRECIPIENT00001' });
    assert.equal(wrongReceiver.status, 400);
    const oldSlipOrder = await request(baseUrl).post('/api/donations').send({ username, paymentMethod: 'promptpay', amount: 25.5, name: 'Old transfer' });
    assert.equal(oldSlipOrder.status, 201);
    const oldSlip = await request(baseUrl).post(`/api/donations/${oldSlipOrder.body.donationId}/slip`).send({ base64: 'data:image/png;base64,OLDTRANSFER00001' });
    assert.equal(oldSlip.status, 400);
    const wrongAmountOrder = await request(baseUrl).post('/api/donations').send({ username, paymentMethod: 'promptpay', amount: 25.5, name: 'Wrong amount' });
    assert.equal(wrongAmountOrder.status, 201);
    const wrongAmount = await request(baseUrl).post(`/api/donations/${wrongAmountOrder.body.donationId}/slip`).send({ base64: 'data:image/png;base64,WRONGAMOUNT0001' });
    assert.equal(wrongAmount.status, 400);
    user = await dbConnection.collection('users').findOne({ username });
    assert.equal(user.stats.total, 25.5);
    assert.equal(user.history.length, 1);
    owner.disconnect();
    widget.disconnect();
});

test('alert queue has a partial unique index for one playing alert per streamer', async () => {
    const indexes = await dbConnection.collection('alertqueues').indexes();
    const playingIndex = indexes.find(index =>
        index.key.userId === 1 &&
        index.key.status === 1 &&
        index.unique === true &&
        index.partialFilterExpression?.status === 'playing'
    );

    assert.ok(playingIndex, 'expected a unique userId/status index limited to playing alerts');
});

test('skip control stops the active OBS alert, advances the queue, and confirms the result', async () => {
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;
    const widget = await connectSocket();
    const widgetSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken });
    await widgetSettings;

    const user = await dbConnection.collection('users').findOne({ username });
    const currentId = new mongoose.Types.ObjectId();
    const nextId = new mongoose.Types.ObjectId();
    const now = new Date();
    await dbConnection.collection('alertqueues').insertMany([
        { _id: currentId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Current' }, status: 'playing', leaseUntil: new Date(Date.now() + 60_000), createdAt: now },
        { _id: nextId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Next' }, status: 'queued', createdAt: new Date(now.getTime() + 1) }
    ]);
    const stoppedEvent = socketEvent(widget, 'stop_alert');
    const nextAlertEvent = socketEvent(widget, 'show_alert');
    const resultEvent = socketEvent(owner, 'alert_control_result');
    owner.emit('skip_current_alert', { username, token });
    assert.deepEqual(await resultEvent, { action: 'skip', skipped: true });
    assert.equal((await stoppedEvent).queueId, String(currentId));
    assert.equal((await nextAlertEvent).queueId, String(nextId));
    assert.equal((await dbConnection.collection('alertqueues').findOne({ _id: currentId })).status, 'skipped');
    assert.equal((await dbConnection.collection('alertqueues').findOne({ _id: nextId })).status, 'playing');
    widget.disconnect();
    owner.disconnect();
});

test('pausing alerts stops the active OBS alert and keeps it first in the queue', async () => {
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;
    const widget = await connectSocket();
    const widgetSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken });
    await widgetSettings;

    const user = await dbConnection.collection('users').findOne({ username });
    const currentId = new mongoose.Types.ObjectId();
    const nextId = new mongoose.Types.ObjectId();
    const now = new Date();
    await dbConnection.collection('alertqueues').insertMany([
        { _id: currentId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Current' }, status: 'playing', leaseUntil: new Date(Date.now() + 60_000), createdAt: now },
        { _id: nextId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Next' }, status: 'queued', createdAt: new Date(now.getTime() + 1) }
    ]);
    const stoppedEvent = socketEvent(widget, 'stop_alert');
    const pauseState = socketEvent(owner, 'apply_alert_control');
    const controlResult = socketEvent(owner, 'alert_control_result');
    const controlAck = new Promise(resolve => owner.emit('pause_alerts', { username, token, minutes: 5 }, resolve));
    assert.deepEqual(await controlResult, { action: 'pause', ok: true });
    assert.deepEqual(await controlAck, { ok: true });
    await pauseState;
    assert.equal((await stoppedEvent).queueId, String(currentId));
    const pausedItem = await dbConnection.collection('alertqueues').findOne({ _id: currentId });
    assert.equal(pausedItem.status, 'queued');
    assert.equal(pausedItem.leaseUntil, null);
    assert.equal((await dbConnection.collection('alertqueues').findOne({ _id: nextId })).status, 'queued');
    widget.disconnect();
    owner.disconnect();
});

test('skip control can skip the suspended current alert while the queue is paused', async () => {
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;
    const user = await dbConnection.collection('users').findOne({ username });
    await dbConnection.collection('alertqueues').deleteMany({ userId: user._id });
    const currentId = new mongoose.Types.ObjectId();
    const nextId = new mongoose.Types.ObjectId();
    const now = new Date();
    await dbConnection.collection('users').updateOne({ _id: user._id }, { $set: { alertControl: { pausedUntil: new Date(Date.now() + 60_000) } } });
    await dbConnection.collection('alertqueues').insertMany([
        { _id: currentId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Suspended' }, status: 'queued', createdAt: now },
        { _id: nextId, userId: user._id, username, donationId: new mongoose.Types.ObjectId(), payload: { name: 'Next' }, status: 'queued', createdAt: new Date(now.getTime() + 1) }
    ]);

    const controlResult = socketEvent(owner, 'alert_control_result');
    const controlAck = new Promise(resolve => owner.emit('skip_current_alert', { username, token }, resolve));
    assert.deepEqual(await controlResult, { action: 'skip', skipped: true });
    assert.deepEqual(await controlAck, { ok: true, skipped: true });
    assert.equal((await dbConnection.collection('alertqueues').findOne({ _id: currentId })).status, 'skipped');
    assert.equal((await dbConnection.collection('alertqueues').findOne({ _id: nextId })).status, 'queued');
    owner.disconnect();
});

test('test donations create a log and OBS alert without changing totals or leaderboard', async () => {
    const beforeUser = await dbConnection.collection('users').findOne({ username });
    const giftId = `test-effect-${crypto.randomUUID()}`;
    await dbConnection.collection('giftcatalogitems').insertOne({ userId: beforeUser._id, giftId, name: 'Test Gift', price: 999, iconId: 'firework', effectId: 'firework', active: true, timerAction: 'none', seconds: 0 });
    const widget = await connectSocket();
    const initialSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken });
    await initialSettings;
    const alert = socketEvent(widget, 'show_alert');
    const result = await request(baseUrl).post('/api/donations/test').send({ username, amount: 999, giftId, name: 'Test only', message: 'OBS test' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const alertPayload = await alert;
    assert.equal(alertPayload.isTest, true);
    assert.equal(alertPayload.giftSnapshot.name, 'Test Gift');
    assert.equal(alertPayload.giftSnapshot.effectId, 'firework');
    const afterUser = await dbConnection.collection('users').findOne({ username });
    assert.equal(afterUser.stats.total, beforeUser.stats.total);
    assert.equal(afterUser.stats.today, beforeUser.stats.today);
    assert.equal(afterUser.goalSettings.current, beforeUser.goalSettings.current);
    const testEntry = await dbConnection.collection('donations').findOne({ username, status: 'test', name: 'Test only' });
    assert.ok(testEntry);
    assert.equal(testEntry.giftSnapshot.effectId, 'firework');
    widget.disconnect();
});

test('widget username fallback is rejected and a valid widget token remains supported', async () => {
    const fallback = await connectSocket();
    const fallbackError = socketEvent(fallback, 'auth_error');
    fallback.emit('join_widget', username);
    assert.match((await fallbackError).message, /token/i);
    fallback.disconnect();

    const widget = await connectSocket();
    const initialSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken, username: 'legacy-default-name' });
    assert.ok(await initialSettings);
    widget.disconnect();
});

test('server refuses to start without JWT_SECRET', () => {
    const env = { ...process.env, JWT_SECRET: '' };
    const result = spawnSync(process.execPath, [serverPath], { cwd: projectRoot, env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JWT_SECRET must be set/);
});

test('donor names are rendered as text in the top donor overlay', () => {
    const handlers = new Map();
    const fakeSocket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const html = fs.readFileSync(path.join(frontendPath, 'top-donator.html'), 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/top-donator.html',
        beforeParse(window) { window.io = () => fakeSocket; }
    });
    const payload = '<img src=x onerror="window.__xss=1">';
    handlers.get('update_leaderboard')([{ name: payload, amount: 9 }]);
    assert.equal(dom.window.document.querySelector('#leaderboard-content img'), null);
    assert.equal(dom.window.document.querySelector('#leaderboard-content').textContent.includes(payload), true);
    assert.equal(dom.window.__xss, undefined);
    dom.window.close();
});

test('donor history fields are rendered as text in the dashboard', async () => {
    const handlers = new Map();
    const fakeSocket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const html = fs.readFileSync(path.join(frontendPath, 'dashboard.html'), 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/dashboard.html',
        beforeParse(window) {
            window.localStorage.setItem('ocean_token', 'test-token');
            window.localStorage.setItem('ocean_user', 'test-user');
            window.fetch = async () => ({ ok: true, json: async () => ({ valid: true }) });
            window.io = () => fakeSocket;
            window.alert = () => {};
            window.confirm = () => true;
        }
    });
    const payload = '<img src=x onerror="window.__xss=1">';
    assert.equal(typeof handlers.get('update_history'), 'function');
    handlers.get('update_history')([{ name: payload, amount: 4, message: payload, date: new Date().toISOString() }]);
    assert.equal(dom.window.document.querySelector('#dash-history-list img'), null);
    assert.equal(dom.window.document.querySelector('#dash-history-list').textContent.includes(payload), true);
    assert.equal(dom.window.__xss, undefined);
    dom.window.close();
});

test('owner can configure an uncapped live timer and carry stopped-time changes into the next stream', async () => {
    const owner = await connectSocket();
    const authenticated = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await authenticated;

    const clearBonus = socketEvent(owner, 'apply_timer');
    owner.emit('timer_set', { username, token, seconds: 0 });
    await clearBonus;

    const configured = socketEvent(owner, 'apply_timer');
    owner.emit('timer_config', { username, token, initialSeconds: 600, amountRules: [] });
    const config = await configured;
    assert.equal(config.initialSeconds, 600);

    const adjusted = socketEvent(owner, 'apply_timer');
    owner.emit('timer_adjust', { username, token, seconds: 120 });
    assert.equal((await adjusted).bankedSeconds, 120);
    const savedBonus = await dbConnection.collection('users').findOne({ username });
    assert.equal(savedBonus.timerState.bankedSeconds, 120, JSON.stringify(savedBonus.timerState));

    const started = socketEvent(owner, 'apply_timer');
    owner.emit('timer_start', { username, token });
    const state = await started;
    assert.equal(state.isRunning, true);
    assert.ok(Date.parse(state.endsAt) - Date.now() >= 719_000, JSON.stringify(state));

    const stopped = socketEvent(owner, 'apply_timer');
    owner.emit('timer_set', { username, token, seconds: 0 });
    const zero = await stopped;
    assert.equal(zero.isRunning, false);
    assert.equal(zero.remainingSeconds, 0);
    owner.disconnect();
});

test('OBS gift effects render safely and restart the same animation for consecutive gifts', async () => {
    const handlers = new Map();
    const fakeSocket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const html = fs.readFileSync(path.join(frontendPath, 'widget.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/widget.html?token=test', beforeParse(window) { window.io = () => fakeSocket; } });
    const unsafeName = '<img src=x onerror="window.__xss=1">';
    const effect = dom.window.document.getElementById('gift-effect');
    const fxLayer = dom.window.document.getElementById('gift-fx-layer');
    assert.ok(fxLayer, 'OBS should provide an independent full-screen gift effect layer');
    let forcedReflows = 0;
    Object.defineProperty(effect, 'offsetWidth', { get() { forcedReflows++; return 1; } });
    handlers.get('show_alert')({ name: 'Donor', amount: 50, giftSnapshot: { name: unsafeName, iconId: 'flower', effectId: 'confetti' } });
    assert.equal(effect.textContent, `🌸 ${unsafeName}`);
    assert.equal(effect.querySelector('img'), null);
    assert.equal(effect.classList.contains('gift-confetti'), true);
    assert.equal(fxLayer.dataset.effect, 'confetti');
    assert.ok(fxLayer.querySelectorAll('.gift-fx-particle').length >= 12);
    assert.equal(forcedReflows, 1, 'removing and re-adding the animation class must restart the effect');
    assert.equal(dom.window.__xss, undefined);
    dom.window.eval('finishCurrentAlert()');
    await delay(420);
    handlers.get('show_alert')({ name: 'Next donor', amount: 80, giftSnapshot: { name: 'Next gift', iconId: 'flower', effectId: 'confetti' } });
    assert.equal(effect.classList.contains('gift-confetti'), true);
    assert.equal(fxLayer.dataset.effect, 'confetti');
    assert.equal(forcedReflows, 2);
    dom.window.close();
});

test('resetting totals updates the owner and acknowledges completion', async () => {
    await dbConnection.collection('users').updateOne({ username }, { $set: { 'stats.total': 120, 'stats.today': 80, history: [{ name: 'Old donor', amount: 120, date: new Date() }] } });
    const owner = await connectSocket();
    const ownerAuth = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await ownerAuth;
    const success = socketEvent(owner, 'notify_success');
    const updatedStats = socketEvent(owner, 'update_stats');
    const updatedHistory = socketEvent(owner, 'update_history');
    owner.emit('reset_stats', { username, token });
    assert.match(await success, /รีเซ็ตข้อมูลเรียบร้อย/);
    assert.equal((await updatedStats).total, 0);
    assert.equal((await updatedHistory).length, 0);
    owner.disconnect();
});

test('OAuth start is configured and forgot-password responses do not reveal accounts', async () => {
    const oauth = await request(baseUrl).get('/api/auth/google/start');
    assert.equal(oauth.status, 302);
    assert.match(oauth.headers.location, /^https:\/\/accounts\.google\.com\//);
    assert.ok(oauth.headers['set-cookie'].some(cookie => cookie.startsWith('ocean_oauth_google=')));
    const unavailableProvider = await request(baseUrl).get('/api/auth/discord/start');
    assert.equal(unavailableProvider.status, 302);
    assert.equal(unavailableProvider.headers.location, '/auth.html?oauth_error=discord-config');
    const discordLink = await request(baseUrl).post('/api/auth/discord/link/start').set('Authorization', `Bearer ${token}`);
    assert.equal(discordLink.status, 503);
    assert.equal(discordLink.body.code, 'INVALID_DISCORD_CLIENT_ID');
    assert.match(discordLink.body.message, /Application ID.*ตัวเลข/);
    const unknown = await request(baseUrl).post('/api/password/forgot').send({ email: 'missing@example.test' });
    const existing = await request(baseUrl).post('/api/password/forgot').send({ email: `${username}@example.test` });
    assert.equal(unknown.status, 202);
    assert.equal(existing.status, 202);
    assert.deepEqual(unknown.body, existing.body);
});

test('donation gifts and live timer are grouped under Widgets & Alerts', () => {
    const html = fs.readFileSync(path.join(frontendPath, 'dashboard.html'), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    assert.equal(document.querySelector('.tab-link[data-tab="gifts"]'), null);
    assert.ok(document.querySelector('#widgets #w-gifts #gift-catalog-list'));
    assert.ok(document.querySelector('#widgets #w-timer #timer-current'));
    dom.window.close();
});

test('Timer appearance and Alert font/theme settings are persisted through allowlists', async () => {
    const owner = await connectSocket();
    const authenticated = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await authenticated;

    const alertSettings = socketEvent(owner, 'apply_settings');
    owner.emit('update_alert', { username, token, font: "'Prompt', sans-serif", alertTheme: 'neon' });
    const alert = await alertSettings;
    assert.equal(alert.font, "'Prompt', sans-serif");
    assert.equal(alert.alertTheme, 'neon');

    const unsafeAlertSettings = socketEvent(owner, 'apply_settings');
    owner.emit('update_alert', { username, token, font: 'url(javascript:alert(1))', alertTheme: 'external-css' });
    const safeAlert = await unsafeAlertSettings;
    assert.equal(safeAlert.font, "'Kanit', sans-serif");
    assert.equal(safeAlert.alertTheme, 'default');

    const timerSettings = socketEvent(owner, 'apply_timer');
    owner.emit('timer_config', {
        username, token, initialSeconds: 3600, amountRules: [],
        appearance: { color: '#22c55e', font: "'Prompt', sans-serif", message: 'โดเนทเพื่อเพิ่มเวลา!', position: 'left', animation: 'pulse' }
    });
    const timer = await timerSettings;
    assert.deepEqual(timer.appearance, { color: '#22c55e', font: "'Prompt', sans-serif", message: 'โดเนทเพื่อเพิ่มเวลา!', position: 'left', animation: 'pulse' });

    const unsafeTimerSettings = socketEvent(owner, 'apply_timer');
    owner.emit('timer_config', {
        username, token, initialSeconds: 3600, amountRules: [],
        appearance: { color: 'url(javascript:alert(1))', font: 'external-font', message: 'A'.repeat(250), position: 'outside', animation: 'script' }
    });
    const safeTimer = await unsafeTimerSettings;
    assert.deepEqual(safeTimer.appearance, { color: '#22c55e', font: "'Kanit', sans-serif", message: 'A'.repeat(200), position: 'center', animation: 'none' });

    const saved = await dbConnection.collection('users').findOne({ username });
    assert.deepEqual(saved.timerSettings.appearance, safeTimer.appearance);
    owner.disconnect();
});

test('gift catalog accepts the expanded built-in gallery and exposes searchable controls', async () => {
    const owner = await connectSocket();
    const authenticated = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await authenticated;

    const applied = socketEvent(owner, 'apply_gifts');
    owner.emit('save_gifts', { username, token, gifts: [
        { giftId: crypto.randomUUID(), name: 'ดอกไม้', price: 80, iconId: 'flower', effectId: 'confetti', active: true, timerAction: 'none', seconds: 0 }
    ] });
    const gifts = await applied;
    assert.equal(gifts.length, 1);
    assert.equal(gifts[0].iconId, 'flower');
    assert.equal(gifts[0].effectId, 'confetti');

    const html = fs.readFileSync(path.join(frontendPath, 'dashboard.html'), 'utf8');
    const dom = new JSDOM(html);
    assert.ok(dom.window.document.getElementById('gift-search'));
    assert.ok(dom.window.document.getElementById('gift-enable-all'));
    assert.ok(dom.window.document.getElementById('gift-disable-all'));
    dom.window.close();
    owner.disconnect();
});

test('Alert template and font galleries are available to preview and OBS', () => {
    const dashboard = fs.readFileSync(path.join(frontendPath, 'dashboard.html'), 'utf8');
    const widget = fs.readFileSync(path.join(frontendPath, 'widget.html'), 'utf8');
    const timer = fs.readFileSync(path.join(frontendPath, 'timer.html'), 'utf8');
    assert.match(dashboard, /data-alert-theme="pink-love"/);
    assert.match(dashboard, /<option value="'Prompt', sans-serif">Prompt/);
    assert.match(widget, /\.alert-theme-pink-love/);
    assert.match(timer, /body\[data-position="left"\]/);
});

test('linked login providers show a checkmark and do not offer linking twice', async () => {
    const html = fs.readFileSync(path.join(frontendPath, 'dashboard.html'), 'utf8');
    const fakeSocket = { on() {}, emit() {} };
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/dashboard.html?u=test-user',
        beforeParse(window) {
            window.localStorage.setItem('ocean_token', 'test-token');
            window.localStorage.setItem('ocean_user', 'test-user');
            window.fetch = async url => url === '/api/auth/identities'
                ? { ok: true, json: async () => ({ providers: ['google'] }) }
                : { ok: true, json: async () => ({ valid: true }) };
            window.io = () => fakeSocket;
            window.alert = () => {};
            window.confirm = () => true;
        }
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    const identityStatus = dom.window.document.getElementById('auth-identity-status');
    assert.match(identityStatus.textContent, /✓ Google · เชื่อมต่อแล้ว/);
    assert.equal([...identityStatus.querySelectorAll('button')].some(button => button.textContent.includes('Google')), false);
    assert.equal([...identityStatus.querySelectorAll('button')].some(button => button.textContent.includes('Discord')), true);
    dom.window.close();
});

test('forgot-password request displays pending and generic completion feedback', async () => {
    const html = fs.readFileSync(path.join(frontendPath, 'auth.html'), 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/auth.html',
        beforeParse(window) {
            window.fetch = async () => ({ ok: true, status: 202, json: async () => ({ message: 'หากอีเมลนี้มีบัญชี ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านให้' }) });
            window.alert = () => {};
        }
    });
    dom.window.document.getElementById('forgot-email').value = 'streamer@example.test';
    const requestReset = dom.window.requestPasswordReset();
    assert.match(dom.window.document.getElementById('forgot-status').textContent, /กำลังส่ง/);
    await requestReset;
    assert.match(dom.window.document.getElementById('forgot-status').textContent, /หากอีเมลนี้มีบัญชี/);
    dom.window.close();
});

test('Google OAuth verifies state, creates a username account, and issues a one-use login handoff', async () => {
    async function startGoogle() {
        const response = await request(baseUrl).get('/api/auth/google/start');
        const state = new URL(response.headers.location).searchParams.get('state');
        const stateCookie = response.headers['set-cookie'].find(cookie => cookie.startsWith('ocean_oauth_google=')).split(';')[0];
        return { state, stateCookie };
    }
    async function callbackGoogle(flow, state = flow.state) {
        return request(baseUrl).get('/api/auth/google/callback').query({ code: 'mock-code', state }).set('Cookie', flow.stateCookie).redirects(0);
    }

    const signupFlow = await startGoogle();
    const signupCallback = await callbackGoogle(signupFlow);
    assert.equal(signupCallback.status, 302);
    const signupToken = new URL(signupCallback.headers.location, baseUrl).searchParams.get('oauth_signup');
    assert.ok(signupToken);
    const signup = await request(baseUrl).post('/api/auth/oauth/register').send({ signupToken, username: 'oauth_streamer' });
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    assert.equal(signup.body.username, 'oauth_streamer');
    assert.equal(await dbConnection.collection('authidentities').countDocuments({ provider: 'google', providerSubject: 'google-subject-1' }), 1);

    const loginFlow = await startGoogle();
    const loginCallback = await callbackGoogle(loginFlow);
    assert.equal(new URL(loginCallback.headers.location, baseUrl).searchParams.get('oauth'), 'complete');
    const handoffCookie = loginCallback.headers['set-cookie'].find(cookie => cookie.startsWith('ocean_oauth_handoff=')).split(';')[0];
    const handoff = await request(baseUrl).post('/api/auth/oauth/complete').set('Cookie', handoffCookie);
    assert.equal(handoff.status, 200, JSON.stringify(handoff.body));
    const verified = await request(baseUrl).get('/api/verify').set('Authorization', `Bearer ${handoff.body.token}`);
    assert.equal(verified.status, 200);
    const reusedHandoff = await request(baseUrl).post('/api/auth/oauth/complete').set('Cookie', handoffCookie);
    assert.equal(reusedHandoff.status, 401);

    const collisionProfile = { sub: 'google-subject-collision', email: `${username}@example.test`, email_verified: true };
    mockGoogleProfile = collisionProfile;
    const collision = await callbackGoogle(await startGoogle());
    assert.equal(new URL(collision.headers.location, baseUrl).searchParams.get('oauth_error'), 'link-required');
    assert.equal(await dbConnection.collection('authidentities').countDocuments({ provider: 'google', providerSubject: collisionProfile.sub }), 0);

    mockGoogleProfile = { sub: 'google-unverified', email: 'unverified@example.test', email_verified: false };
    const unverified = await callbackGoogle(await startGoogle());
    assert.equal(new URL(unverified.headers.location, baseUrl).searchParams.get('oauth_error'), 'email');

    mockGoogleProfile = { sub: 'google-subject-1', email: 'oauth-user@example.test', email_verified: true };
    const mismatchedStateFlow = await startGoogle();
    const mismatchedState = await callbackGoogle(mismatchedStateFlow, 'wrong-state');
    assert.equal(new URL(mismatchedState.headers.location, baseUrl).searchParams.get('oauth_error'), 'state');
});

test('password reset token is one-use and revokes old HTTP and Socket.IO sessions', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await dbConnection.collection('passwordresettokens').insertOne({
        tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        userId: (await dbConnection.collection('users').findOne({ username }))._id,
        expiresAt: new Date(Date.now() + 60_000), usedAt: null
    });
    const reset = await request(baseUrl).post('/api/password/reset').send({ token: rawToken, newPassword: 'new-reset-password-123' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const oldSession = await request(baseUrl).get('/api/verify').set('Authorization', `Bearer ${token}`);
    assert.equal(oldSession.status, 401);
    const replay = await request(baseUrl).post('/api/password/reset').send({ token: rawToken, newPassword: 'another-reset-password-123' });
    assert.equal(replay.status, 400);
    const newLogin = await request(baseUrl).post('/api/login').send({ email: `${username}@example.test`, password: 'new-reset-password-123' });
    assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));

    const staleSocket = await connectSocket();
    const authError = socketEvent(staleSocket, 'auth_error');
    staleSocket.emit('auth_dashboard', { token, username });
    assert.match((await authError).message, /เซสชันหมดอายุ/);
    staleSocket.disconnect();
    token = newLogin.body.token;
});

test('Donate layout and palette accept only built-in choices and background URLs require HTTPS', async () => {
    const owner = await connectSocket();
    const authenticated = socketEvent(owner, 'auth_success');
    owner.emit('auth_dashboard', { token, username });
    await authenticated;
    const applied = socketEvent(owner, 'apply_page_settings');
    owner.emit('save_page_settings', { username, layoutId: 'minimal', themeId: 'soft', bgUrl: 'javascript:alert(1)' });
    const settings = await applied;
    assert.equal(settings.layoutId, 'minimal');
    assert.equal(settings.themeId, 'soft');
    assert.equal(settings.bgUrl, '');
    owner.disconnect();
});

test('Donate Preview applies temporary design choices but blocks all payment submission', async () => {
    const handlers = new Map();
    const fakeSocket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const fetchCalls = [];
    const html = fs.readFileSync(path.join(frontendPath, 'donate.html'), 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'dangerously', url: 'http://localhost/donate.html?u=preview-user&preview=1',
        beforeParse(window) {
            window.io = () => fakeSocket;
            window.alert = () => {};
            window.fetch = async (url, options) => {
                fetchCalls.push({ url: String(url), options });
                return { ok: true, json: async () => ({ username:'Preview', giftCatalog:[], paymentMethods:{}, layoutId:'ocean', themeId:'ocean' }) };
            };
        }
    });
    await delay(20);
    assert.equal(dom.window.document.getElementById('btn-submit-donate').disabled, true);
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        origin: 'http://localhost', source: dom.window,
        data: { type:'oceandonate-preview', settings:{ layoutId:'minimal', themeId:'soft', bio:'Preview bio' } }
    }));
    assert.equal(dom.window.document.body.dataset.layout, 'minimal');
    assert.equal(dom.window.document.body.dataset.theme, 'soft');
    await dom.window.openPaymentModal();
    assert.equal(fetchCalls.some(call => call.url.includes('/api/donations')), false);
    dom.window.close();
});
