const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const { JSDOM } = require('jsdom');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const { io } = require('socket.io-client');

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
        env: { ...process.env, PORT: String(port), MONGODB_URI: mongoUri, JWT_SECRET: jwtSecret, NODE_ENV: 'test', EASYSLIP_API_KEY: 'test-easyslip-key', EASYSLIP_API_BASE_URL: `http://127.0.0.1:${slipApiPort}` },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
    serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });
    const startedAt = Date.now();
    while (!output.includes('Server running on port')) {
        if (serverProcess.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
        if (Date.now() - startedAt > 15000) throw new Error(`Test server did not start:\n${output}`);
        await delay(50);
    }

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
    assert.equal(await dbConnection.collection('donations').countDocuments({ username, status: 'pending' }), 1);

    await dbConnection.collection('users').updateOne({ username }, { $set: { 'paymentMethods.bank.accountNumber': '999-9-99999-9', 'paymentMethods.bank.accountName': 'บัญชีใหม่' } });
    const confirmed = await request(baseUrl).post(`/api/donations/${order.body.donationId}/slip`).send({ base64: 'data:image/png;base64,SLIPREUSED00001' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal((await showAlert).name, 'Verified donor');
    await dbConnection.collection('users').updateOne({ username }, { $set: { 'paymentMethods.bank.accountNumber': '123-4-56789-0', 'paymentMethods.bank.accountName': 'ผู้รับทดสอบ' } });
    user = await dbConnection.collection('users').findOne({ username });
    assert.equal(user.stats.total, 25.5);
    assert.equal(user.stats.today, 25.5);

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

test('test donations create a log and OBS alert without changing totals or leaderboard', async () => {
    const beforeUser = await dbConnection.collection('users').findOne({ username });
    const widget = await connectSocket();
    const initialSettings = socketEvent(widget, 'apply_settings');
    widget.emit('join_widget', { token: widgetToken });
    await initialSettings;
    const alert = socketEvent(widget, 'show_alert');
    const result = await request(baseUrl).post('/api/donations/test').send({ username, amount: 999, name: 'Test only', message: 'OBS test' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal((await alert).isTest, true);
    const afterUser = await dbConnection.collection('users').findOne({ username });
    assert.equal(afterUser.stats.total, beforeUser.stats.total);
    assert.equal(afterUser.stats.today, beforeUser.stats.today);
    assert.equal(afterUser.goalSettings.current, beforeUser.goalSettings.current);
    const testEntry = await dbConnection.collection('donations').findOne({ username, status: 'test', name: 'Test only' });
    assert.ok(testEntry);
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
