const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');
const { JSDOM } = require('jsdom');

const dashboardHtml = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/dashboard.html'), 'utf8');
const donateHtml = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/donate.html'), 'utf8');
const timerHtml = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/timer.html'), 'utf8');
const themedPages = ['index.html', 'auth.html', 'dashboard.html', 'donate.html'];
const openDoms = [];
after(() => openDoms.forEach(dom => dom.window.close()));

test('public pages share the dark-first design system and expose a theme switch', () => {
    for (const page of themedPages) {
        const html = fs.readFileSync(path.resolve(__dirname, `../../Frontendd/${page}`), 'utf8');
        assert.match(html, /href=["']design-tokens\.css["']/i, `${page} should load shared design tokens`);
        assert.match(html, /src=["']theme\.js["']/i, `${page} should load the shared theme controller`);
        assert.match(html, /data-theme-toggle/, `${page} should expose a theme switch`);
    }
});

test('OBS overlays share the Ocean palette and preserve transparent canvases', () => {
    for (const page of ['widget.html', 'timer.html', 'goal.html', 'top-donator.html']) {
        const html = fs.readFileSync(path.resolve(__dirname, `../../Frontendd/${page}`), 'utf8');
        assert.match(html, /class=["'][^"']*obs-overlay/i, `${page} should identify itself as a transparent OBS overlay`);
        assert.match(html, /href=["']design-tokens\.css["']/i, `${page} should load the shared brand tokens`);
    }
    const tokens = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/design-tokens.css'), 'utf8');
    assert.match(tokens, /html\.obs-overlay,\s*html\.obs-overlay body\s*\{\s*background:\s*transparent\s*!important/i,
        'brand styles must not paint over the OBS canvas');
    assert.match(tokens, /--od-color-wave:\s*#38d6ef/i);
});

test('theme switch defaults to Dark and remembers Light across page loads', () => {
    const themePath = path.resolve(__dirname, '../../Frontendd/theme.js');
    assert.equal(fs.existsSync(themePath), true, 'shared theme controller should exist');
    const themeScript = fs.readFileSync(themePath, 'utf8');
    const createThemedPage = savedTheme => {
        const dom = new JSDOM('<!doctype html><html><body><button type="button" data-theme-toggle aria-label="Switch theme"><span class="theme-toggle-label">Dark</span></button></body></html>', {
            runScripts: 'outside-only',
            url: 'http://localhost/',
            beforeParse(window) { if (savedTheme) window.localStorage.setItem('oceandonate_theme', savedTheme); }
        });
        openDoms.push(dom);
        dom.window.eval(themeScript);
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
        return dom;
    };
    const firstPage = createThemedPage(null);
    assert.equal(firstPage.window.document.documentElement.dataset.theme, 'dark');
    const toggle = firstPage.window.document.querySelector('[data-theme-toggle]');
    toggle.click();
    assert.equal(firstPage.window.document.documentElement.dataset.theme, 'light');
    assert.equal(firstPage.window.localStorage.getItem('oceandonate_theme'), 'light');
    const nextPage = createThemedPage(firstPage.window.localStorage.getItem('oceandonate_theme'));
    assert.equal(nextPage.window.document.documentElement.dataset.theme, 'light');
    assert.equal(nextPage.window.document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'), 'true');
});

test('dashboard groups core tasks into clear destinations without losing existing settings', () => {
    const { dom } = createDashboard();
    const { document } = dom.window;
    const destinations = [...document.querySelectorAll('.tab-link')].map(link => link.dataset.tab);
    for (const destination of ['overview', 'donations', 'payment', 'page-settings', 'widgets', 'account']) {
        assert.ok(destinations.includes(destination), `dashboard should include ${destination} navigation`);
        assert.ok(document.getElementById(destination), `${destination} navigation should resolve to a section`);
    }
    assert.equal(document.getElementById('dash-history-list').closest('.tab-content')?.id, 'donations');
    assert.equal(document.getElementById('auth-identity-status').closest('.tab-content')?.id, 'account');
    const paymentLink = [...document.querySelectorAll('.tab-link')].find(link => link.dataset.tab === 'payment');
    paymentLink.click();
    assert.equal(document.getElementById('payment').classList.contains('active'), true);
    assert.equal(document.getElementById('overview').classList.contains('active'), false);
    dom.window.close();
});

function createDashboard() {
    const handlers = new Map();
    const emitted = [];
    const alerts = [];
    const confirms = [];
    const copiedText = [];
    const socket = {
        on: (name, callback) => handlers.set(name, callback),
        emit: (...args) => emitted.push(args)
    };
    const dom = new JSDOM(dashboardHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost/dashboard.html?u=testuser',
        beforeParse(window) {
            window.localStorage.setItem('ocean_token', 'test-token');
            window.localStorage.setItem('ocean_user', 'testuser');
            window.io = () => socket;
            window.alert = message => alerts.push(String(message));
            window.confirm = message => { confirms.push(String(message)); return false; };
            Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: value => { copiedText.push(String(value)); return Promise.resolve(); } } });
            window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ providers: [] }) });
        }
    });
    openDoms.push(dom);
    return { dom, handlers, emitted, alerts, confirms, copiedText };
}

test('Timer preview updates immediately from unsaved duration and appearance inputs', () => {
    const { dom } = createDashboard();
    const { document, Event } = dom.window;
    const hours = document.getElementById('timer-initial-hours');
    hours.value = '2';
    hours.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(document.getElementById('timer-current').textContent, '02:00:00');

    const color = document.getElementById('timer-color');
    color.value = '#ff55aa';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(document.getElementById('timer-current').style.color, 'rgb(255, 85, 170)');
});

test('Timer adjustment button label follows add or subtract selection', () => {
    const { dom } = createDashboard();
    const { document, Event } = dom.window;
    const action = document.getElementById('timer-adjust-action');
    action.value = 'subtract';
    action.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.getElementById('timer-adjust-submit').textContent.trim(), 'ลดเวลา');
    action.value = 'add';
    action.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.getElementById('timer-adjust-submit').textContent.trim(), 'เพิ่มเวลา');
    dom.window.close();
});

test('duplicate gift preset uses a non-modal toast instead of browser alert', () => {
    const { dom, handlers, alerts } = createDashboard();
    handlers.get('apply_gifts')([{ giftId: 'existing-flower', name: 'ดอกไม้', price: 80, iconId: 'flower', effectId: 'confetti', active: true, timerAction: 'none', seconds: 0 }]);
    [...dom.window.document.querySelectorAll('#gift-preset-gallery button')]
        .find(button => button.textContent.includes('ดอกไม้ · 80 บาท')).click();
    assert.deepEqual(alerts, []);
    assert.equal(dom.window.document.querySelector('[role="status"] .app-toast').textContent, 'ของขวัญนี้อยู่ในรายการแล้ว');
    dom.window.close();
});

test('donation gift cards show their preview before selection and select fixed price', () => {
    const handlers = new Map();
    const socket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const dom = new JSDOM(donateHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost/donate.html?u=testuser',
        beforeParse(window) {
            window.io = () => socket;
            window.fetch = async () => ({ ok: false, status: 404 });
            window.alert = () => {};
        }
    });
    openDoms.push(dom);
    handlers.get('apply_gifts')([{ giftId: 'flower-80', name: 'ดอกไม้', price: 80, iconId: 'flower', effectId: 'confetti', active: true, timerAction: 'none' }]);
    const giftCard = [...dom.window.document.querySelectorAll('.gift-option')].find(card => card.dataset.giftId === 'flower-80');
    assert.ok(giftCard);
    const picker = dom.window.document.getElementById('gift-picker-disclosure');
    assert.equal(picker.open, false, 'gift choices should be collapsed until the donor wants to browse');
    picker.open = true;
    assert.equal(giftCard.querySelector('.gift-option-art').textContent, '🌸');
    assert.match(giftCard.textContent, /เอฟเฟกต์กระดาษสี/);
    giftCard.click();
    const preview = dom.window.document.getElementById('gift-selected-preview');
    assert.equal(preview.classList.contains('is-visible'), true);
    assert.equal(dom.window.document.getElementById('gift-selected-name').textContent, 'ดอกไม้');
    assert.equal(dom.window.document.getElementById('gift-selected-icon').textContent, '🌸');
    assert.match(dom.window.document.getElementById('gift-selected-meta').textContent, /80\.00 บาท · เอฟเฟกต์กระดาษสี/);
    assert.equal(dom.window.document.getElementById('input-amount').value, '80.00');
    assert.equal(picker.open, false, 'selecting a gift should collapse the long gallery again');
    dom.window.selectGift('');
    assert.equal(preview.classList.contains('is-visible'), false);
});

test('OBS URLs stay hidden until requested but can be copied while hidden', () => {
    const { dom, handlers, copiedText } = createDashboard();
    const details = dom.window.document.getElementById('obs-links-details');
    assert.equal(details.open, false);
    handlers.get('apply_security_settings')({ widgetToken: 'private-widget-token' });
    const copyButton = dom.window.document.querySelector('[data-copy-widget="obs-alert-url"]');
    assert.ok(copyButton);
    assert.equal(copyButton.closest('details'), null, 'copy action must remain outside the collapsed links');
    details.querySelector('summary').click();
    assert.equal(details.open, true, 'the owner should be able to reveal the private URLs on demand');
    details.querySelector('summary').click();
    assert.equal(details.open, false);
    copyButton.click();
    assert.deepEqual(copiedText, ['http://localhost/widget.html?token=private-widget-token']);
});

test('reset confirmation uses the OceanDonate dialog and only resets after approval', async () => {
    const { dom, emitted, confirms } = createDashboard();
    const pending = dom.window.resetStats();
    const dialog = dom.window.document.querySelector('[data-confirm-dialog]');
    assert.ok(dialog);
    assert.equal(dialog.getAttribute('role'), 'alertdialog');
    assert.match(dialog.textContent, /รีเซ็ตยอดเงินและประวัติทั้งหมด/);
    dialog.querySelector('[data-confirm-cancel]').click();
    assert.equal(await pending, false);
    assert.equal(emitted.some(([event]) => event === 'reset_stats'), false);
    assert.deepEqual(confirms, []);

    const approved = dom.window.resetStats();
    dom.window.document.querySelector('[data-confirm-accept]').click();
    assert.equal(await approved, true);
    assert.equal(emitted.some(([event]) => event === 'reset_stats'), true);
});

test('skip feedback explains whether a live alert was actually skipped', () => {
    const { dom, handlers } = createDashboard();
    handlers.get('alert_control_result')({ action: 'skip', skipped: true });
    assert.match(dom.window.document.querySelector('.app-toast').textContent, /ข้ามแจ้งเตือนที่กำลังเล่นแล้ว/);
    handlers.get('alert_control_result')({ action: 'skip', skipped: false });
    assert.match(dom.window.document.querySelectorAll('.app-toast')[1].textContent, /ไม่มีแจ้งเตือนที่กำลังเล่น/);
});

test('live alert controls send pause, resume, and skip commands and show server confirmation', () => {
    const { dom, emitted, handlers } = createDashboard();
    const { document } = dom.window;
    document.getElementById('pause-alert-minutes').value = '10';
    document.querySelector('#live-controls-card button[onclick="pauseAlerts()"]')?.click();
    document.querySelector('#live-controls-card button[onclick="resumeAlerts()"]')?.click();
    document.querySelector('#live-controls-card button[onclick="skipCurrentAlert()"]')?.click();
    const controlEvents = emitted.filter(([event]) => ['pause_alerts', 'resume_alerts', 'skip_current_alert'].includes(event));
    assert.deepEqual(controlEvents.map(([event]) => event), ['pause_alerts', 'resume_alerts', 'skip_current_alert']);
    assert.equal(controlEvents[0][1].minutes, 10);
    controlEvents.forEach(([, , acknowledge]) => acknowledge({ ok: true }));
    handlers.get('alert_control_result')({ action: 'pause', ok: true });
    handlers.get('alert_control_result')({ action: 'resume', ok: true });
    assert.match(document.querySelectorAll('.app-toast')[0].textContent, /พักแจ้งเตือนแล้ว/);
    assert.match(document.querySelectorAll('.app-toast')[1].textContent, /เล่นแจ้งเตือนต่อแล้ว/);
    const note = document.querySelector('#live-controls-card small').textContent;
    assert.match(note, /หยุด Alert ที่กำลังเล่น/);
    assert.match(note, /โดเนทยังรับได้ตามปกติ/);
});

test('donation history sorts by time or amount and can hide test donations without changing delete targets', () => {
    const { dom, handlers } = createDashboard();
    const { document, Event } = dom.window;
    const entries = [
        { _id: 'old-id', name: 'Oldest', amount: 10, date: '2026-01-01T00:00:00.000Z' },
        { _id: 'middle-id', name: 'Middle', amount: 20, date: '2026-03-01T00:00:00.000Z' },
        { _id: 'new-id', name: 'Newest', amount: 30, date: '2026-05-01T00:00:00.000Z' },
        { _id: 'test-id', name: 'Test donor', amount: 500, date: '2026-04-01T00:00:00.000Z', isTest: true }
    ];
    handlers.get('update_history')(entries);
    const names = () => [...document.querySelectorAll('#dash-history-list tr td:nth-child(2)')].map(cell => cell.textContent);
    assert.deepEqual(names(), ['Newest', 'Test donor (ทดสอบ)', 'Middle', 'Oldest']);

    const deleted = [];
    dom.window.deleteHistory = id => deleted.push(id);
    const sort = document.getElementById('history-sort-order');
    sort.value = 'oldest';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(names(), ['Oldest', 'Middle', 'Test donor (ทดสอบ)', 'Newest']);
    sort.value = 'amount-high';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(names(), ['Test donor (ทดสอบ)', 'Newest', 'Middle', 'Oldest']);
    sort.value = 'amount-low';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(names(), ['Oldest', 'Middle', 'Newest', 'Test donor (ทดสอบ)']);
    const showTests = document.getElementById('history-show-tests');
    showTests.checked = false;
    showTests.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(names(), ['Oldest', 'Middle', 'Newest']);
    showTests.checked = true;
    showTests.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(names(), ['Oldest', 'Middle', 'Newest', 'Test donor (ทดสอบ)']);
    document.querySelector('#dash-history-list tr button').click();
    assert.deepEqual(deleted, ['old-id']);
    dom.window.close();
});

test('timer amount range includes its displayed upper bound and rejects touching inclusive ranges', () => {
    const { dom, alerts } = createDashboard();
    const { document } = dom.window;
    document.getElementById('timer-rule-min').value = '10';
    document.getElementById('timer-rule-max').value = '50';
    dom.window.addTimerRule();
    assert.equal(document.querySelectorAll('#timer-rules-list li').length, 1);
    document.getElementById('timer-rule-min').value = '50';
    document.getElementById('timer-rule-max').value = '100';
    dom.window.addTimerRule();
    assert.equal(document.querySelectorAll('#timer-rules-list li').length, 1);
    assert.match([...document.querySelectorAll('.app-toast')].at(-1).textContent, /ช่วงยอดเงินของกฎห้ามทับซ้อนกัน/);
    assert.match(document.querySelector('#timer-pane-rules p').textContent, /รวมยอดเริ่มต้นและยอดปลายช่วง/);
    dom.window.close();
});

test('saving timer rules waits for the server acknowledgement and confirms persistence', () => {
    const { dom, emitted } = createDashboard();
    dom.window.saveTimerSettings();
    const save = emitted.find(([event]) => event === 'timer_config');
    assert.ok(save);
    assert.equal(typeof save[2], 'function');
    save[2]({ ok: true });
    assert.match(dom.window.document.querySelector('.app-toast').textContent, /บันทึกการตั้งค่า Timer และกฎสำเร็จ/);
    dom.window.close();
});

test('Donate preview has desktop and phone layouts and applies background changes before save', () => {
    const { dom } = createDashboard();
    const { document, Event } = dom.window;
    const frame = document.getElementById('donate-preview-frame');
    const sent = [];
    Object.defineProperty(frame.contentWindow, 'postMessage', { configurable: true, value: (data, origin) => sent.push({ data, origin }) });
    const mobileButton = document.querySelector('[data-donate-preview-device="mobile"]');
    mobileButton.click();
    assert.equal(frame.dataset.device, 'mobile');
    assert.equal(dom.window.getComputedStyle(frame).width, '390px');
    document.getElementById('donate-layout').value = 'neon';
    document.getElementById('donate-palette').value = 'soft';
    const backgroundPreset = document.getElementById('dash-theme-preset');
    backgroundPreset.value = 'custom';
    backgroundPreset.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('dash-bg').value = 'https://images.example.test/background.png';
    document.getElementById('dash-bio').value = 'Preview biography';
    document.getElementById('dash-bg').dispatchEvent(new Event('input', { bubbles: true }));
    dom.window.updateDonatePreview();
    assert.equal(sent.at(-1).data.settings.layoutId, 'neon');
    assert.equal(sent.at(-1).data.settings.themeId, 'soft');
    assert.equal(sent.at(-1).data.settings.bio, 'Preview biography');
    assert.equal(sent.at(-1).data.settings.bgUrl, 'https://images.example.test/background.png');
    dom.window.close();
});

test('OBS Timer shows the next round starting time and banked donation bonus while stopped', () => {
    const handlers = new Map();
    const fakeSocket = { on: (name, callback) => handlers.set(name, callback), emit() {} };
    const dom = new JSDOM(timerHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost/timer.html?token=widget-token',
        beforeParse(window) { window.io = () => fakeSocket; }
    });
    openDoms.push(dom);
    handlers.get('apply_timer')({
        isRunning: false,
        remainingSeconds: 0,
        initialSeconds: 3600,
        bankedSeconds: 3660,
        appearance: { color: '#22c55e', font: "'Kanit', sans-serif", message: 'โดเนทเพื่อเพิ่มเวลา!', position: 'center', animation: 'none' }
    });
    assert.equal(dom.window.document.getElementById('timer').textContent, '02:01:00');
    assert.match(dom.window.document.getElementById('status').textContent, /โบนัส.*รอบถัดไป/);
    handlers.get('apply_timer')({ isRunning: true, hasEnded: false, endsAt: new Date(Date.now() + 60_000).toISOString(), remainingSeconds: 60, initialSeconds: 3600, bankedSeconds: 0 });
    const liveTime = dom.window.document.getElementById('timer').textContent.split(':').map(Number);
    assert.ok(liveTime[0] * 3600 + liveTime[1] * 60 + liveTime[2] >= 55, `running timer should show server time, got ${liveTime.join(':')}`);
    assert.equal(dom.window.document.getElementById('status').textContent, '');
    handlers.get('apply_timer')({ isRunning: false, hasEnded: true, endsAt: null, remainingSeconds: 0, initialSeconds: 3600, bankedSeconds: 0 });
    assert.equal(dom.window.document.getElementById('timer').textContent, '00:00:00');
    assert.equal(dom.window.document.getElementById('status').textContent, 'หมดเวลา');
    dom.window.close();
});
