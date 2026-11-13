const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
if (process.env.RENDER) app.set('trust proxy', 1);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set before starting OceanDonate.');
}

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '../Frontendd')));

// 📌 1. เชื่อมต่อฐานข้อมูล MongoDB
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ocean_donate';
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log("✅ Connected to MongoDB:", MONGO_URI))
  .catch(err => {
      console.error("\n❌ MongoDB Connection Error: ไม่สามารถเชื่อมต่อ MongoDB ได้ที่ 127.0.0.1:27017");
      console.error("👉 วิธีเปิด: ให้เปิด Terminal แบบ Run as Administrator แล้วพิมพ์คำสั่ง: net start MongoDB\n");
  });

// ตรวจสอบสถานะ MongoDB ทันที ไม่ต้องรอ Buffer ค้าง 10 วินาที
app.use((req, res, next) => {
    if (req.path.startsWith('/api') && mongoose.connection.readyState !== 1) {
        return res.status(503).json({ 
            message: '⚠️ ยังไม่ได้เชื่อมต่อ MongoDB กรุณาเปิดบริการ MongoDB บนเครื่อง (รัน: net start MongoDB ใน Admin)' 
        });
    }
    next();
});

// 📌 2. Schema สำหรับเก็บข้อมูลผู้ใช้ (รองรับความปลอดภัย, Social, Banned words, Image donations)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    widgetToken: { 
        type: String, 
        unique: true, 
        default: () => crypto.randomBytes(16).toString('hex') 
    },
    stats: { 
        today: { type: Number, default: 0 }, 
        total: { type: Number, default: 0 }, 
        views: { type: Number, default: 0 } 
    },
    pageSettings: { 
        bio: { type: String, default: "ยินดีต้อนรับสู่ช่องของฉัน!" }, 
        thankMsg: { type: String, default: "ขอบคุณสำหรับการโดเนทครับ!" }, 
        bgUrl: { type: String, default: "" },
        maxMessageLength: { type: Number, default: 150 },
        allowDonorImages: { type: Boolean, default: true },
        minAmountForImage: { type: Number, default: 20 }
    },
    socialLinks: {
        youtube: { type: String, default: "" },
        facebook: { type: String, default: "" },
        twitch: { type: String, default: "" }
    },
    bannedWords: { 
        type: [String], 
        default: ['ควย', 'สัส', 'เหี้ย', 'เย็ด', 'มึง', 'กู', 'พนัน', 'คาสิโน', 'sex', 'fuck', 'shit', 'bitch'] 
    },
    paymentMethods: { type: Object, default: {} },
    goalSettings: { type: Object, default: {} },
    alertSettings: { type: Object, default: {} },
    topDonorSettings: { type: Object, default: {} },
    history: [{ 
        donationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation' },
        name: String, 
        amount: Number, 
        message: String, 
        imageUrl: { type: String, default: "" },
        date: { type: Date, default: Date.now } 
    }]
});

const User = mongoose.model('User', UserSchema);

const DonationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    username: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 40 },
    amount: { type: Number, required: true, min: 0.01 },
    message: { type: String, default: '', maxlength: 500 },
    imageUrl: { type: String, default: '' },
    paymentMethod: { type: String, enum: ['promptpay', 'bank', 'test'], required: true },
    receiverBankName: { type: String },
    receiverAccountNumber: { type: String },
    receiverAccountName: { type: String },
    receiverAccountId: { type: Number },
    status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'test', 'deleted'], default: 'pending', index: true },
    providerRef: { type: String },
    createdAt: { type: Date, default: Date.now },
    date: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date }
});
DonationSchema.index({ providerRef: 1 }, { unique: true, sparse: true });
DonationSchema.index({ userId: 1, date: -1 });
DonationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
const Donation = mongoose.model('Donation', DonationSchema);

const BANK_CODES = {
    'กรุงเทพ (BBL)': '002',
    'กสิกรไทย (KBANK)': '004',
    'กรุงไทย (KTB)': '006',
    'ทหารไทยธนชาต (TTB)': '011',
    'ไทยพาณิชย์ (SCB)': '014',
    'ซีไอเอ็มบีไทย (CIMBT)': '022',
    'ยูโอบี (UOBT)': '024',
    'กรุงศรีอยุธยา (BAY)': '025',
    'ออมสิน (GSB)': '030',
    'อาคารสงเคราะห์ (GHB)': '033',
    'เพื่อการเกษตรและสหกรณ์การเกษตร (BAAC)': '034',
    'เพื่อการส่งออกและนำเข้าแห่งประเทศไทย (EXIM)': '035',
    'ทิสโก้ (TISCO)': '067',
    'เกียรตินาคินภัทร (KKP)': '069',
    'ไอซีบีซี (ไทย) (ICBCT)': '070',
    'ไทยเครดิตเพื่อรายย่อย (TCD)': '071',
    'แลนด์ แอนด์ เฮ้าส์ (LHFG)': '073',
    'คลิกซ์ (CLICX)': '088',
    'พัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย (SME)': '098'
};

function cleanPaymentMethods(methods, includePrivate = false) {
    if (!methods || typeof methods !== 'object') return {};
    const result = {};
    if (methods.promptpay && typeof methods.promptpay === 'object') {
        result.promptpay = {
            active: Boolean(methods.promptpay.active),
            phone: String(methods.promptpay.phone || '')
        };
    }
    if (methods.bank && typeof methods.bank === 'object') {
        result.bank = {
            active: Boolean(methods.bank.active),
            bankName: String(methods.bank.bankName || ''),
            accountNumber: String(methods.bank.accountNumber || ''),
            accountName: String(methods.bank.accountName || '')
        };
        if (includePrivate) {
            result.bank.accountNameEn = String(methods.bank.accountNameEn || '');
            result.bank.verifiedAccountId = methods.bank.verifiedAccountId || null;
        }
    }
    return result;
}

function publicPaymentMethods(methods) {
    const safe = cleanPaymentMethods(methods);
    const receiverVerified = Boolean(methods?.bank?.verifiedAccountId && process.env.EASYSLIP_API_KEY);
    if (safe.promptpay) {
        safe.promptpay.active = Boolean(safe.promptpay.active && safe.promptpay.phone && receiverVerified);
        if (!safe.promptpay.active) safe.promptpay.phone = '';
    }
    if (safe.bank) {
        safe.bank.active = Boolean(safe.bank.active && receiverVerified);
        if (!safe.bank.active) safe.bank = { active: false };
    }
    if (!receiverVerified && safe.promptpay) safe.promptpay = { active: false, phone: '' };
    return safe;
}

async function registerEasySlipReceiver(bankSettings) {
    const bankCode = BANK_CODES[bankSettings.bankName];
    const bankNumber = normalizeAccountNumber(bankSettings.accountNumber);
    if (!bankCode || bankNumber.length < 8 || bankNumber.length > 16 || !bankSettings.accountName || !bankSettings.accountNameEn) {
        throw Object.assign(new Error('กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีภาษาไทย/อังกฤษให้ครบ'), { status: 400 });
    }
    const request = {
        bankCode,
        bankNumber,
        nameTh: String(bankSettings.accountName).trim().slice(0, 255),
        nameEn: String(bankSettings.accountNameEn).trim().slice(0, 255),
        type: 'NATURAL'
    };
    try {
        return await callEasySlip('/bank-accounts', request);
    } catch (error) {
        if (error.code !== 'BANK_ACCOUNT_DUPLICATE') throw error;

        // A previous save may have created the account before the response was lost.
        // Reuse and link the matching account instead of making the streamer fail every retry.
        let existing = null;
        let page = 1;
        let total = Infinity;
        while (!existing && (page - 1) * 100 < total && page <= 50) {
            const result = await callEasySlip(`/bank-accounts/all?page=${page}&limit=100`, undefined, 'GET');
            const accounts = Array.isArray(result?.items) ? result.items : [];
            total = Number(result?.total) || accounts.length;
            existing = accounts.find(account =>
                String(account.bankCode) === bankCode &&
                normalizeAccountNumber(account.bankNumber) === bankNumber &&
                normalizeAccountHolder(account.nameTh) === normalizeAccountHolder(request.nameTh) &&
                normalizeAccountHolder(account.nameEn) === normalizeAccountHolder(request.nameEn)
            ) || null;
            page++;
        }
        if (!existing?.id) {
            throw Object.assign(new Error('บัญชีนี้มีอยู่ใน EasySlip แล้ว แต่ไม่พบบัญชีชื่อ/เลขบัญชีเดียวกันในสาขานี้ กรุณาตรวจบัญชี EasySlip หรือให้ผู้ดูแลระบบช่วยตรวจ'), { status: 409, code: 'BANK_ACCOUNT_DUPLICATE' });
        }
        await callEasySlip(`/bank-accounts/${encodeURIComponent(existing.id)}/link`, undefined, 'POST');
        return existing;
    }
}

function normalizeAccountNumber(value) {
    return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeAccountHolder(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th-TH');
}

function easySlipErrorMessage(pathname, code, providerMessage) {
    const accountSetup = pathname.startsWith('/bank-accounts');
    const messages = accountSetup ? {
        MISSING_API_KEY: 'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY บนเซิร์ฟเวอร์',
        INVALID_API_KEY: 'EasySlip ปฏิเสธ API key กรุณาตรวจค่า EASYSLIP_API_KEY ใน Render',
        IP_NOT_ALLOWED: 'EasySlip ปฏิเสธ IP ของเซิร์ฟเวอร์ กรุณาตรวจ IP whitelist ในบัญชี EasySlip',
        BRANCH_INACTIVE: 'สาขา EasySlip ของ API key นี้ยังไม่เปิดใช้งาน',
        SERVICE_BANNED: 'บัญชีบริการ EasySlip ถูกระงับ กรุณาติดต่อ EasySlip',
        USER_BANNED: 'บัญชี EasySlip ถูกระงับ กรุณาติดต่อ EasySlip',
        QUOTA_EXCEEDED: 'ใช้โควตา EasySlip หมดแล้ว กรุณาตรวจแพ็กเกจหรือโควตา',
        INVALID_BANK_CODE: 'ธนาคารที่เลือกยังไม่รองรับโดย EasySlip กรุณาเลือกธนาคารอื่นหรือติดต่อผู้ดูแล',
        BANK_ACCOUNT_DUPLICATE: 'บัญชีนี้ลงทะเบียนใน EasySlip แล้ว แต่ระบบยังเชื่อมบัญชีนั้นกับสาขานี้ไม่ได้',
        VALIDATION_ERROR: 'EasySlip ไม่ยอมรับข้อมูลบัญชี กรุณาตรวจธนาคาร เลขบัญชี และชื่อบัญชีให้ตรงกับธนาคาร',
        API_SERVER_ERROR: 'EasySlip ขัดข้องชั่วคราว กรุณาลองใหม่ภายหลัง'
    } : {
        MISSING_API_KEY: 'ยังไม่ได้ตั้งค่า EasySlip API key',
        INVALID_API_KEY: 'EasySlip ปฏิเสธ API key กรุณาติดต่อผู้ดูแลระบบ',
        IP_NOT_ALLOWED: 'EasySlip ปฏิเสธ IP ของเซิร์ฟเวอร์ กรุณาตรวจ IP whitelist',
        BRANCH_INACTIVE: 'สาขา EasySlip ยังไม่เปิดใช้งาน',
        QUOTA_EXCEEDED: 'ใช้โควตาตรวจสลิป EasySlip หมดแล้ว กรุณาลองใหม่ภายหลัง',
        SLIP_NOT_FOUND: 'EasySlip ไม่พบรายการโอนจากธนาคาร',
        API_SERVER_ERROR: 'EasySlip ขัดข้องชั่วคราว กรุณาลองใหม่ภายหลัง'
    };
    if (messages[code]) return messages[code];
    const context = accountSetup ? 'ลงทะเบียนบัญชีรับเงินกับ EasySlip' : 'ตรวจสอบสลิปกับ EasySlip';
    const detail = String(providerMessage || '').trim().slice(0, 240);
    return `${context}ไม่สำเร็จ (${code})${detail ? `: ${detail}` : ''}`;
}

async function callEasySlip(pathname, body, method = 'POST') {
    const apiKey = process.env.EASYSLIP_API_KEY;
    if (!apiKey) throw Object.assign(new Error(easySlipErrorMessage(pathname, 'MISSING_API_KEY')), { status: 503, code: 'MISSING_API_KEY' });
    const configuredBase = process.env.NODE_ENV === 'test' && process.env.EASYSLIP_API_BASE_URL
        ? process.env.EASYSLIP_API_BASE_URL
        : 'https://api.easyslip.com/v2/';
    const baseUrl = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
    // A leading slash in pathname would reset the URL path and drop `/v2`.
    const url = new URL(String(pathname).replace(/^\/+/, ''), baseUrl);
    const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
        const code = result.error?.code || 'VERIFICATION_UNAVAILABLE';
        const error = new Error(easySlipErrorMessage(pathname, code, result.error?.message));
        error.status = response.status >= 500 || response.status === 429 ? 503 : 400;
        error.code = code;
        throw error;
    }
    return result.data;
}

function validateDonationInput(body) {
    let amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 50000 || Math.round(amount * 100) / 100 !== amount) {
        throw Object.assign(new Error('จำนวนเงินต้องอยู่ระหว่าง 1 ถึง 50,000 บาท (สูงสุด 2 ตำแหน่ง)'), { status: 400 });
    }
    amount = Math.round(amount * 100) / 100;
    const name = String(body?.name || 'ผู้ไม่ประสงค์ออกนาม').trim().slice(0, 40) || 'ผู้ไม่ประสงค์ออกนาม';
    const message = String(body?.message || '').trim().slice(0, 500);
    const imageUrl = safeHttpsUrl(body?.imageUrl || '');
    return { amount, name, message, imageUrl };
}

// ฟังก์ชันคำนวณ Top Donators (5 อันดับแรก)
function getTopDonators(history) {
    if (!history || !Array.isArray(history)) return [];
    const donors = {};
    history.forEach(h => {
        if (!h.name) return;
        if (!donors[h.name]) donors[h.name] = 0;
        donors[h.name] += (parseFloat(h.amount) || 0);
    });
    return Object.entries(donors)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5); 
}

// ตรวจสอบ JWT Token Helper
function verifyToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

function ownerRoom(username) { return `owner:${username}`; }
function widgetRoom(username) { return `widget:${username}`; }
function publicRoom(username) { return `public:${username}`; }

const settingFields = {
    goalSettings: ['title', 'target', 'current', 'barColor', 'textColor', 'font'],
    alertSettings: ['layout', 'sound', 'soundVol', 'ttsRate', 'ttsPitch', 'ttsVol', 'ttsNameToggle', 'ttsMsgToggle', 'imgUrl', 'nameColor', 'amountColor', 'textColor', 'font'],
    topDonorSettings: ['title', 'titleColor', 'textColor', 'boxColor', 'isTransparent', 'hasBorder', 'borderColor']
};

function cleanSettings(type, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const allowed = settingFields[type] || [];
    return Object.fromEntries(allowed
        .filter(key => value[key] !== undefined)
        .map(key => [key, value[key]]));
}

function safeHttpsUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        return new URL(value).protocol === 'https:' ? value : '';
    } catch {
        return '';
    }
}

// 📌 3. API สมัครและเข้าสู่ระบบแบบเข้ารหัส ปลอดภัย 100%
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        }

        const cleanUsername = username.trim();
        const existing = await User.findOne({ 
            $or: [{ username: cleanUsername }, { email: email.trim().toLowerCase() }] 
        });
        if (existing) return res.status(400).json({ message: 'มีคนใช้ชื่อหรืออีเมลนี้แล้ว' });

        // เข้ารหัสรหัสผ่านด้วย bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);
        const widgetToken = crypto.randomBytes(16).toString('hex');

        const newUser = new User({ 
            username: cleanUsername, 
            email: email.trim().toLowerCase(), 
            password: hashedPassword,
            widgetToken: widgetToken
        });
        await newUser.save();
        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ!' });
    } catch (err) { 
        console.error("Register Error:", err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' }); 
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'กรุณากรอกอีเมลและรหัสผ่าน' });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase() });
        if (!user) return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

        // ตรวจสอบรหัสผ่าน รองรับทั้งแบบ Bcrypt และข้อความเดิม (Auto-migration)
        let isMatch = false;
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            // บัญชีเดิมที่ยังไม่ได้แฮช -> ตรวจสอบแล้วแฮชบันทึกใหม่
            isMatch = (user.password === password);
            if (isMatch) {
                user.password = await bcrypt.hash(password, 10);
                await user.save();
            }
        }

        if (!isMatch) return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

        // สร้าง JWT Token อายุ 7 วัน
        const token = jwt.sign(
            { id: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // ตรวจสอบว่ามี widgetToken หรือไม่ ถ้าไม่มีให้เจนใหม่
        if (!user.widgetToken) {
            user.widgetToken = crypto.randomBytes(16).toString('hex');
            await user.save();
        }

        res.json({ 
            success: true, 
            token, 
            username: user.username,
            widgetToken: user.widgetToken
        });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
});

// ตรวจสอบสิทธิ์ Token เพื่อป้องกัน Dashboard
app.get('/api/verify', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ valid: false, message: 'ไม่มี Token ยืนยันตัวตน' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ valid: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' });

    const user = await User.findOne({ username: decoded.username });
    if (!user) return res.status(404).json({ valid: false, message: 'ไม่พบผู้ใช้' });

    res.json({
        valid: true,
        username: user.username,
        widgetToken: user.widgetToken
    });
});

// ดึงข้อมูลสำหรับหน้า Donate (Public Profile)
app.get('/api/streamer/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ message: 'ไม่พบสตรีมเมอร์ท่านนี้' });

        res.json({
            username: user.username,
            bio: user.pageSettings?.bio || "ยินดีต้อนรับสู่ช่องของฉัน!",
            thankMsg: user.pageSettings?.thankMsg || "ขอบคุณสำหรับการโดเนทครับ!",
            bgUrl: user.pageSettings?.bgUrl || "",
            maxMessageLength: user.pageSettings?.maxMessageLength || 150,
            allowDonorImages: user.pageSettings?.allowDonorImages !== false,
            minAmountForImage: user.pageSettings?.minAmountForImage || 20,
            socialLinks: user.socialLinks || {},
            paymentMethods: publicPaymentMethods(user.paymentMethods),
            topDonator: getTopDonators(user.history)[0] || null,
            bannedWords: user.bannedWords || []
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/streamers', async (req, res) => {
    try {
        const users = await User.find({}, 'username pageSettings.bio');
        res.json(users);
    } catch (e) {
        res.json([]);
    }
});

const donationRateBuckets = new Map();
function rateLimitDonation(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = donationRateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= 60_000) {
        donationRateBuckets.set(key, { startedAt: now, count: 1 });
        if (donationRateBuckets.size > 10000) {
            for (const [entryKey, entry] of donationRateBuckets) if (now - entry.startedAt >= 60_000) donationRateBuckets.delete(entryKey);
        }
        return next();
    }
    if (bucket.count >= 12) return res.status(429).json({ message: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' });
    bucket.count += 1;
    next();
}

function donationTextIsBanned(user, name, message) {
    const checkText = `${name} ${message}`.toLowerCase();
    return (user.bannedWords || []).some(word => word && checkText.includes(String(word).toLowerCase().trim()));
}

async function dashboardHistory(user) {
    const tests = await Donation.find({ userId: user._id, status: 'test' })
        .sort({ date: -1 }).limit(50).lean();
    const combined = [
        ...(user.history || []).map(item => ({ ...item.toObject?.() || item, status: 'confirmed' })),
        ...tests.map(item => ({ ...item, isTest: true }))
    ];
    return combined.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

app.post('/api/donations', rateLimitDonation, async (req, res) => {
    try {
        if (!process.env.EASYSLIP_API_KEY) return res.status(503).json({ message: 'ระบบตรวจสลิปยังไม่พร้อมใช้งาน' });
        const { username, paymentMethod } = req.body || {};
        if (!['promptpay', 'bank'].includes(paymentMethod)) return res.status(400).json({ message: 'ช่องทางชำระเงินไม่ถูกต้อง' });
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'ไม่พบสตรีมเมอร์' });
        const method = user.paymentMethods?.[paymentMethod];
        const receiver = user.paymentMethods?.bank;
        if (!method?.active || !receiver?.verifiedAccountId || !receiver?.accountNumber) {
            return res.status(400).json({ message: 'สตรีมเมอร์ยังตั้งค่าบัญชีรับเงินที่ตรวจสอบแล้วไม่ครบ' });
        }
        if (paymentMethod === 'promptpay' && !/^\d{10}$|^\d{13}$/.test(normalizeAccountNumber(method.phone))) {
            return res.status(400).json({ message: 'สตรีมเมอร์ยังไม่ได้ตั้งค่า PromptPay ที่ถูกต้อง' });
        }

        const parsed = validateDonationInput(req.body);
        parsed.message = parsed.message.slice(0, Number(user.pageSettings?.maxMessageLength) || 150);
        if (donationTextIsBanned(user, parsed.name, parsed.message)) {
            return res.status(400).json({ message: 'ชื่อหรือข้อความมีคำที่ไม่เหมาะสม' });
        }
        const donation = await Donation.create({
            userId: user._id,
            username: user.username,
            ...parsed,
            paymentMethod,
            receiverBankName: receiver.bankName,
            receiverAccountNumber: normalizeAccountNumber(receiver.accountNumber),
            receiverAccountName: receiver.accountName,
            receiverAccountId: receiver.verifiedAccountId,
            status: 'pending',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        });
        const response = { donationId: donation._id, amount: donation.amount, expiresAt: donation.expiresAt };
        if (paymentMethod === 'promptpay') {
            const phone = normalizeAccountNumber(method.phone);
            response.qrUrl = `https://promptpay.io/${phone}/${donation.amount.toFixed(2)}.png`;
            response.receiverName = receiver.accountName;
        } else {
            response.bank = {
                bankName: receiver.bankName,
                accountNumber: receiver.accountNumber,
                accountName: receiver.accountName
            };
        }
        res.status(201).json(response);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.status ? err.message : 'สร้างรายการโดเนทไม่สำเร็จ' });
    }
});

app.post('/api/donations/:id/slip', rateLimitDonation, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'ไม่พบรายการโดเนท' });
        const base64 = req.body?.base64;
        const imageMatch = typeof base64 === 'string' && base64.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
        if (!imageMatch || Buffer.from(imageMatch[2], 'base64').length > 4 * 1024 * 1024) {
            return res.status(400).json({ message: 'กรุณาแนบไฟล์ภาพสลิป JPG, PNG, WebP หรือ GIF ขนาดไม่เกิน 4 MB' });
        }
        const donation = await Donation.findOne({ _id: req.params.id, status: 'pending', expiresAt: { $gt: new Date() } });
        if (!donation) return res.status(404).json({ message: 'รายการหมดอายุหรือไม่พบรายการโดเนท' });
        const user = await User.findById(donation.userId);
        if (!user || !donation.receiverAccountId) return res.status(503).json({ message: 'ข้อมูลบัญชีรับเงินยังตรวจสอบไม่ได้' });

        const verified = await callEasySlip('/verify/bank', {
            base64,
            matchAccount: true,
            matchAmount: donation.amount,
            checkDuplicate: true,
            remark: `DONATION_${donation._id}`
        });
        const expectedBankCode = BANK_CODES[donation.receiverBankName];
        const matchedAccount = verified.matchedAccount;
        const raw = verified.rawSlip;
        const slipDate = raw?.date ? new Date(raw.date) : null;
        const now = Date.now();
        const dateIsForThisRequest = slipDate && Number.isFinite(slipDate.getTime()) &&
            slipDate.getTime() >= donation.createdAt.getTime() - 2 * 60 * 1000 &&
            slipDate.getTime() <= now + 2 * 60 * 1000;
        const receivedAmount = Number(verified.amountInSlip ?? raw?.amount?.amount);
        const matchedBankCode = matchedAccount?.bankCode || matchedAccount?.bank?.code || matchedAccount?.bank?.id;
        const exactReceiverMatch = matchedAccount &&
            normalizeAccountNumber(matchedAccount.bankNumber) === normalizeAccountNumber(donation.receiverAccountNumber) &&
            matchedBankCode === expectedBankCode &&
            normalizeAccountHolder(matchedAccount.nameTh || matchedAccount.name?.th) === normalizeAccountHolder(donation.receiverAccountName);
        const exactAmountMatch = Number.isFinite(receivedAmount) && Math.round(receivedAmount * 100) === Math.round(donation.amount * 100) && verified.isAmountMatched !== false;
        if (!raw?.transRef || verified.isDuplicate || !exactReceiverMatch || !exactAmountMatch || !dateIsForThisRequest) {
            return res.status(400).json({ message: 'สลิปไม่ผ่านการตรวจ: บัญชีผู้รับ ยอดเงิน เวลา หรือสถานะรายการไม่ตรง' });
        }

        let confirmed;
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                confirmed = await Donation.findOneAndUpdate(
                    { _id: donation._id, status: 'pending', expiresAt: { $gt: new Date() } },
                    { $set: { status: 'confirmed', providerRef: String(raw.transRef), date: slipDate }, $unset: { expiresAt: 1 } },
                    { new: true, session }
                );
                if (!confirmed) throw Object.assign(new Error('รายการนี้ได้รับการยืนยันไปแล้วหรือหมดอายุ'), { status: 409 });

                const owner = await User.findById(donation.userId).session(session);
                if (!owner) throw Object.assign(new Error('ไม่พบสตรีมเมอร์'), { status: 404 });
                owner.history.push({ donationId: confirmed._id, name: donation.name, amount: donation.amount, message: donation.message, imageUrl: donation.imageUrl, date: confirmed.date });
                owner.stats.total = (Number(owner.stats.total) || 0) + donation.amount;
                owner.stats.today = (Number(owner.stats.today) || 0) + donation.amount;
                if (owner.goalSettings && owner.goalSettings.current !== undefined) {
                    owner.goalSettings.current = (Number(owner.goalSettings.current) || 0) + donation.amount;
                    owner.markModified('goalSettings');
                }
                await owner.save({ session });
            });
        } finally {
            await session.endSession();
        }

        const owner = await User.findById(donation.userId);
        const newDonation = { name: confirmed.name, amount: confirmed.amount, message: confirmed.message, imageUrl: confirmed.imageUrl, date: confirmed.date };
        io.to(widgetRoom(owner.username)).emit('show_alert', newDonation);
        io.to(ownerRoom(owner.username)).emit('update_history', await dashboardHistory(owner));
        io.to(ownerRoom(owner.username)).emit('update_stats', owner.stats);
        const leaderboard = getTopDonators(owner.history);
        io.to(ownerRoom(owner.username)).emit('update_leaderboard', leaderboard);
        io.to(widgetRoom(owner.username)).emit('update_leaderboard', leaderboard);
        io.to(publicRoom(owner.username)).emit('update_leaderboard', leaderboard);
        if (owner.goalSettings) {
            const goal = cleanSettings('goalSettings', owner.goalSettings);
            io.to(ownerRoom(owner.username)).emit('apply_goal', goal);
            io.to(widgetRoom(owner.username)).emit('apply_goal', goal);
        }
        res.json({ success: true, status: 'confirmed', message: 'ตรวจสอบสลิปและยืนยันโดเนทแล้ว' });
    } catch (err) {
        const status = err.status || (err.code === 11000 ? 409 : 500);
        res.status(status).json({ message: err.status ? err.message : status === 409 ? 'สลิปนี้ถูกใช้ยืนยันไปแล้ว' : 'ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่' });
    }
});

app.post('/api/donations/test', rateLimitDonation, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body?.username });
        if (!user) return res.status(404).json({ message: 'ไม่พบสตรีมเมอร์' });
        const parsed = validateDonationInput(req.body);
        parsed.message = parsed.message.slice(0, Number(user.pageSettings?.maxMessageLength) || 150);
        if (donationTextIsBanned(user, parsed.name, parsed.message)) return res.status(400).json({ message: 'ชื่อหรือข้อความมีคำที่ไม่เหมาะสม' });
        const testDonation = await Donation.create({ userId: user._id, username: user.username, ...parsed, paymentMethod: 'test', status: 'test' });
        const alert = { name: testDonation.name, amount: testDonation.amount, message: testDonation.message, imageUrl: testDonation.imageUrl, date: testDonation.date, isTest: true };
        io.to(widgetRoom(user.username)).emit('show_alert', alert);
        io.to(ownerRoom(user.username)).emit('update_history', await dashboardHistory(user));
        res.status(201).json({ success: true, status: 'test', message: 'ส่งการทดสอบแล้ว' });
    } catch (err) {
        res.status(err.status || 500).json({ message: err.status ? err.message : 'ส่งการทดสอบไม่สำเร็จ' });
    }
});

// Helper ส่งข้อมูลครบวงจรให้ Dashboard
async function emitDashboardData(socket, user) {
    socket.emit('update_stats', user.stats);
    socket.emit('update_history', await dashboardHistory(user));
    socket.emit('apply_page_settings', user.pageSettings);
    socket.emit('apply_payment', cleanPaymentMethods(user.paymentMethods, true));
    socket.emit('apply_social', user.socialLinks || {});
    socket.emit('apply_banned_words', user.bannedWords || []);
    socket.emit('apply_security_settings', { widgetToken: user.widgetToken });
    
    // 1. ค่าเริ่มต้นของ Goal
    const goalData = (user.goalSettings && user.goalSettings.title) ? user.goalSettings : 
        { title: 'เป้าหมายโดเนท', target: 100, current: 0, barColor: '#0ea5e9', textColor: '#ffffff' };
    socket.emit('apply_goal', cleanSettings('goalSettings', goalData));

    // 2. ค่าเริ่มต้นของ Alert
    const alertData = (user.alertSettings && user.alertSettings.layout) ? user.alertSettings : 
        { 
            layout: 'main', 
            sound: 'boing', 
            soundVol: 75,
            ttsRate: 1.0,
            ttsPitch: 1.0,
            ttsVol: 100,
            ttsNameToggle: true,
            ttsMsgToggle: true,
            imgUrl: 'https://media.giphy.com/media/YaP3iYxN3T8nIEN5rD/giphy.gif', 
            nameColor: '#f59e0b', 
            amountColor: '#5BC0EB', 
            textColor: '#ffffff',
            font: "'Kanit', sans-serif"
        };
    socket.emit('apply_settings', cleanSettings('alertSettings', alertData));

    // 3. ค่าเริ่มต้นของ Top Donator
    const tdData = (user.topDonorSettings && user.topDonorSettings.title) ? user.topDonorSettings : 
        { title: '🏆 Top Donators', titleColor: '#5BC0EB', textColor: '#ffffff', boxColor: 'rgba(0, 0, 0, 0.6)', isTransparent: false, hasBorder: true, borderColor: '#3A86FF' };
    socket.emit('apply_top_donor', cleanSettings('topDonorSettings', tdData));
    
    // ส่งตารางอันดับ
    socket.emit('update_leaderboard', getTopDonators(user.history));
}

// 📌 4. ระบบ Socket.io ครบวงจรพร้อม Authentication & Authorization
io.on('connection', (socket) => {

    // 🟢 สตรีมเมอร์เชื่อมต่อจากหน้า Dashboard พร้อมยืนยัน Token
    socket.on('auth_dashboard', async ({ token, username }) => {
        const decoded = verifyToken(token);
        if (!decoded || (username && decoded.username !== username)) {
            return socket.emit('auth_error', { message: 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
        }

        socket.authenticatedUser = decoded.username;
        socket.join(ownerRoom(decoded.username));

        const user = await User.findOne({ username: decoded.username });
        if (user) {
            await emitDashboardData(socket, user);
            socket.emit('auth_success', { username: user.username });
        }
    });

    // 🟢 เชื่อมต่อสำหรับ OBS Widget ด้วย widget token เท่านั้น
    socket.on('join_widget', async (param) => {
        if (!param || typeof param !== 'object' || typeof param.token !== 'string' || !param.token) {
            return socket.emit('auth_error', { message: 'ต้องใช้ Widget token เพื่อเชื่อมต่อ' });
        }
        const user = await User.findOne({ widgetToken: param.token });
        if (!user) {
            return socket.emit('auth_error', { message: 'Widget token ไม่ถูกต้อง' });
        }

        socket.authenticatedWidget = user.username;
        socket.join(widgetRoom(user.username));
        const alertData = (user.alertSettings && user.alertSettings.layout) ? user.alertSettings :
            { layout: 'main', sound: 'boing', soundVol: 75, imgUrl: 'https://media.giphy.com/media/YaP3iYxN3T8nIEN5rD/giphy.gif', nameColor: '#f59e0b', amountColor: '#5BC0EB', textColor: '#ffffff' };
        socket.emit('apply_settings', cleanSettings('alertSettings', alertData));

        const goalData = (user.goalSettings && user.goalSettings.title) ? user.goalSettings :
            { title: 'เป้าหมายโดเนท', target: 100, current: 0, barColor: '#0ea5e9', textColor: '#ffffff' };
        socket.emit('apply_goal', cleanSettings('goalSettings', goalData));

        const tdData = (user.topDonorSettings && user.topDonorSettings.title) ? user.topDonorSettings :
            { title: '🏆 Top Donators', titleColor: '#5BC0EB', textColor: '#ffffff', boxColor: 'rgba(0, 0, 0, 0.6)', isTransparent: false };
        socket.emit('apply_top_donor', cleanSettings('topDonorSettings', tdData));

        socket.emit('update_leaderboard', getTopDonators(user.history));
    });

    // 🟢 หน้าโดเนทสาธารณะเชื่อมต่อเพื่อรับข้อมูลสตรีมเมอร์
    socket.on('join_profile', async (username) => {
        const user = await User.findOne({ username });
        if (user) {
            socket.join(publicRoom(user.username));
            if (user.pageSettings) socket.emit('apply_page_settings', user.pageSettings);
            if (user.paymentMethods) socket.emit('apply_payment', publicPaymentMethods(user.paymentMethods));
            if (user.socialLinks) socket.emit('apply_social', user.socialLinks);
            socket.emit('update_leaderboard', getTopDonators(user.history));
        }
    });

    // 🟢 ระบบบันทึกโดเนท + ตรวจคำหยาบ + จำกัดความยาว + รองรับรูปภาพ/GIF
    // ปิดช่องทางเดิมที่เพิ่มยอดโดยไม่ตรวจสอบการจ่าย
    let legacyDonationAttempts = 0;
    socket.on('new_donation', () => {
        legacyDonationAttempts += 1;
        if (legacyDonationAttempts > 3) return socket.disconnect(true);
        socket.emit('donation_rejected', { message: 'กรุณาสร้างรายการและส่งสลิปเพื่อยืนยันการชำระเงิน' });
    });

    // Helper ตรวจสอบสิทธิ์คำสั่งหลังบ้าน
    async function checkAuth(data) {
        if (socket.authenticatedUser && socket.authenticatedUser === data.username) return true;
        const decoded = verifyToken(data.token);
        if (decoded && decoded.username === data.username) return true;
        socket.emit('auth_error', { message: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้' });
        return false;
    }

    // 🟢 ทดสอบการแจ้งเตือนจาก Dashboard ไปยัง OBS
    socket.on('test_alert', async (data) => {
        if (!await checkAuth(data)) return;
        const testDonation = {
            name: data.name || 'โทนี่',
            amount: parseFloat(data.amount) || 500,
            message: data.message || 'ทดสอบการแจ้งเตือนและระบบอ่านออกเสียง!',
            imageUrl: data.imageUrl || '',
            isTest: true,
            date: new Date()
        };
        io.to(widgetRoom(data.username)).emit('show_alert', testDonation);
    });

    // 🟢 สร้าง Token ลิงก์ OBS ใหม่
    socket.on('regenerate_widget_token', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.widgetToken = crypto.randomBytes(16).toString('hex');
            await user.save();
            socket.emit('apply_security_settings', { widgetToken: user.widgetToken });
            socket.emit('notify_success', 'สร้าง OBS Stream Key ใหม่เรียบร้อยแล้ว!');
        }
    });

    // 🟢 ลบประวัติโดเนท (ต้องเป็นเจ้าของบัญชีเท่านั้น)
    socket.on('delete_donation', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        const donationIndex = user?.history?.findIndex(item => String(item._id) === String(data.id));
        if (user && user.history && donationIndex >= 0) {
            const donationToDelete = user.history[donationIndex];
            
            user.stats.total -= donationToDelete.amount;
            user.stats.today -= donationToDelete.amount;
            if (user.stats.total < 0) user.stats.total = 0;
            if (user.stats.today < 0) user.stats.today = 0;

            if (user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = parseFloat(user.goalSettings.current) - donationToDelete.amount;
                if (user.goalSettings.current < 0) user.goalSettings.current = 0;
                user.markModified('goalSettings');
                const goal = cleanSettings('goalSettings', user.goalSettings);
                io.to(ownerRoom(data.username)).emit('apply_goal', goal);
                io.to(widgetRoom(data.username)).emit('apply_goal', goal);
            }

            user.history.splice(donationIndex, 1);
            await user.save();
            if (donationToDelete.donationId) {
                await Donation.updateOne({ _id: donationToDelete.donationId, userId: user._id }, { $set: { status: 'deleted' } });
            }
            
            io.to(ownerRoom(data.username)).emit('update_history', await dashboardHistory(user));
            io.to(ownerRoom(data.username)).emit('update_stats', user.stats);
            const leaderboard = getTopDonators(user.history);
            io.to(ownerRoom(data.username)).emit('update_leaderboard', leaderboard);
            io.to(widgetRoom(data.username)).emit('update_leaderboard', leaderboard);
            io.to(publicRoom(data.username)).emit('update_leaderboard', leaderboard);
        }
    });

    // 🟢 รีเซ็ตข้อมูลทั้งหมด
    socket.on('reset_stats', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.stats.today = 0;
            user.stats.total = 0;
            user.history = []; 
            await Donation.updateMany({ userId: user._id, status: { $in: ['confirmed', 'test', 'pending'] } }, { $set: { status: 'deleted' }, $unset: { expiresAt: 1 } });
            
            if (user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = 0;
                user.markModified('goalSettings');
                const goal = cleanSettings('goalSettings', user.goalSettings);
                io.to(ownerRoom(data.username)).emit('apply_goal', goal);
                io.to(widgetRoom(data.username)).emit('apply_goal', goal);
            }

            await user.save();
            io.to(ownerRoom(data.username)).emit('update_stats', user.stats);
            io.to(ownerRoom(data.username)).emit('update_history', await dashboardHistory(user));
            io.to(ownerRoom(data.username)).emit('update_leaderboard', []);
            io.to(widgetRoom(data.username)).emit('update_leaderboard', []);
            io.to(publicRoom(data.username)).emit('update_leaderboard', []);
        }
    });

    // 🟢 บันทึกการชำระเงิน
    socket.on('save_payment', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (!user || !['promptpay', 'bank'].includes(data?.type) || !data.data || typeof data.data !== 'object') return;
        try {
            if (!user.paymentMethods) user.paymentMethods = {};
            if (data.type === 'promptpay') {
                const phone = normalizeAccountNumber(data.data.phone);
                if (phone && !/^\d{10}$|^\d{13}$/.test(phone)) throw Object.assign(new Error('PromptPay ต้องเป็นเบอร์ 10 หลักหรือเลขประจำตัว 13 หลัก'), { status: 400 });
                user.paymentMethods.promptpay = { active: Boolean(data.data.active), phone };
            } else {
                const old = user.paymentMethods.bank || {};
                const bank = {
                    active: Boolean(data.data.active),
                    bankName: String(data.data.bankName || '').trim(),
                    accountNumber: String(data.data.accountNumber || '').trim(),
                    accountName: String(data.data.accountName || '').trim(),
                    accountNameEn: String(data.data.accountNameEn || '').trim(),
                    verifiedAccountId: null
                };
                const sameReceiver = old.bankName === bank.bankName && normalizeAccountNumber(old.accountNumber) === normalizeAccountNumber(bank.accountNumber) && old.accountName === bank.accountName && old.accountNameEn === bank.accountNameEn;
                if (sameReceiver && old.verifiedAccountId) {
                    bank.verifiedAccountId = old.verifiedAccountId;
                } else {
                    try {
                        const registered = await registerEasySlipReceiver(bank);
                        bank.verifiedAccountId = registered.id;
                    } catch (error) {
                        bank.active = false;
                        user.paymentMethods.bank = bank;
                        user.markModified('paymentMethods');
                        await user.save();
                        socket.emit('payment_error', { message: error.status === 503 ? 'ตั้งค่ารับเงินไว้แล้ว แต่ต้องตั้ง EASYSLIP_API_KEY และบันทึกอีกครั้งก่อนเปิดรับเงินจริง' : error.message });
                        io.to(ownerRoom(data.username)).emit('apply_payment', cleanPaymentMethods(user.paymentMethods, true));
                        io.to(publicRoom(data.username)).emit('apply_payment', publicPaymentMethods(user.paymentMethods));
                        return;
                    }
                }
                user.paymentMethods.bank = bank;
            }
            user.markModified('paymentMethods');
            await user.save();
            io.to(ownerRoom(data.username)).emit('apply_payment', cleanPaymentMethods(user.paymentMethods, true));
            io.to(publicRoom(data.username)).emit('apply_payment', publicPaymentMethods(user.paymentMethods));
            socket.emit('notify_success', 'บันทึกช่องทางรับเงินแล้ว');
        } catch (error) {
            socket.emit('payment_error', { message: error.message || 'บันทึกช่องทางรับเงินไม่สำเร็จ' });
        }
    });

    // 🟢 บันทึกข้อมูลโปรไฟล์และการตั้งค่าหน้าโดเนท
    socket.on('save_page_settings', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            if (!user.pageSettings) user.pageSettings = {};
            if (data.bio !== undefined) user.pageSettings.bio = data.bio;
            if (data.bgUrl !== undefined) user.pageSettings.bgUrl = data.bgUrl;
            if (data.thankMsg !== undefined) user.pageSettings.thankMsg = data.thankMsg;
            if (data.maxMessageLength !== undefined) user.pageSettings.maxMessageLength = parseInt(data.maxMessageLength) || 150;
            if (data.allowDonorImages !== undefined) user.pageSettings.allowDonorImages = Boolean(data.allowDonorImages);
            if (data.minAmountForImage !== undefined) user.pageSettings.minAmountForImage = parseFloat(data.minAmountForImage) || 0;
            
            user.markModified('pageSettings');
            await user.save();
            io.to(ownerRoom(data.username)).emit('apply_page_settings', user.pageSettings);
            io.to(publicRoom(data.username)).emit('apply_page_settings', user.pageSettings);
        }
    });

    // 🟢 บันทึกโซเชียลมีเดีย
    socket.on('save_social', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.socialLinks = {
                youtube: safeHttpsUrl(data.youtube),
                facebook: safeHttpsUrl(data.facebook),
                twitch: safeHttpsUrl(data.twitch)
            };
            user.markModified('socialLinks');
            await user.save();
            io.to(ownerRoom(data.username)).emit('apply_social', user.socialLinks);
            io.to(publicRoom(data.username)).emit('apply_social', user.socialLinks);
        }
    });

    // 🟢 บันทึกคำหยาบ (Banned Words)
    socket.on('save_banned_words', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            let list = [];
            if (Array.isArray(data.words)) {
                list = data.words;
            } else if (typeof data.words === 'string') {
                list = data.words.split(',').map(w => w.trim()).filter(w => w.length > 0);
            }
            user.bannedWords = list;
            user.markModified('bannedWords');
            await user.save();
            socket.emit('apply_banned_words', user.bannedWords);
        }
    });

    // 🟢 บันทึกการตั้งค่า Goal
    socket.on('update_goal', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.goalSettings = cleanSettings('goalSettings', data);
            user.markModified('goalSettings');
            await user.save();
            const goal = cleanSettings('goalSettings', user.goalSettings);
            io.to(ownerRoom(data.username)).emit('apply_goal', goal);
            io.to(widgetRoom(data.username)).emit('apply_goal', goal);
        }
    });

    // 🟢 บันทึกการตั้งค่า Alert (รูปแบบ, เสียง, สี, รูปภาพ)
    socket.on('update_alert', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.alertSettings = cleanSettings('alertSettings', data);
            user.markModified('alertSettings');
            await user.save();
            const settings = cleanSettings('alertSettings', user.alertSettings);
            io.to(ownerRoom(data.username)).emit('apply_settings', settings);
            io.to(widgetRoom(data.username)).emit('apply_settings', settings);
        }
    });

    // 🟢 บันทึกการตั้งค่า Top Donator
    socket.on('update_top_donor', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.topDonorSettings = cleanSettings('topDonorSettings', data);
            user.markModified('topDonorSettings');
            await user.save();
            const settings = cleanSettings('topDonorSettings', user.topDonorSettings);
            io.to(ownerRoom(data.username)).emit('apply_top_donor', settings);
            io.to(widgetRoom(data.username)).emit('apply_top_donor', settings);
        }
    });

});

// 📌 สั่งรันเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 OceanDonate Server running on port ${PORT}`);
});
