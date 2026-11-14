const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');
const { JSDOM } = require('jsdom');

const dashboardHtml = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/dashboard.html'), 'utf8');
const donateHtml = fs.readFileSync(path.resolve(__dirname, '../../Frontendd/donate.html'), 'utf8');
const openDoms = [];
after(() => openDoms.forEach(dom => dom.window.close()));

function createDashboard() {
    const handlers = new Map();
    const emitted = [];
    const alerts = [];
    const confirms = [];
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
            window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ providers: [] }) });
        }
    });
    openDoms.push(dom);
    return { dom, handlers, emitted, alerts, confirms };
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
    assert.equal(giftCard.querySelector('.gift-option-art').textContent, '🌸');
    assert.match(giftCard.textContent, /เอฟเฟกต์กระดาษสี/);
    giftCard.click();
    const preview = dom.window.document.getElementById('gift-selected-preview');
    assert.equal(preview.classList.contains('is-visible'), true);
    assert.equal(dom.window.document.getElementById('gift-selected-name').textContent, 'ดอกไม้');
    assert.equal(dom.window.document.getElementById('gift-selected-icon').textContent, '🌸');
    assert.match(dom.window.document.getElementById('gift-selected-meta').textContent, /80\.00 บาท · เอฟเฟกต์กระดาษสี/);
    assert.equal(dom.window.document.getElementById('input-amount').value, '80.00');
    dom.window.selectGift('');
    assert.equal(preview.classList.contains('is-visible'), false);
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
