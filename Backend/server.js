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

const JWT_SECRET = process.env.JWT_SECRET || 'ocean_donate_super_secret_jwt_key_2026_xyz';

app.use(cors());
app.use(express.json());
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
        name: String, 
        amount: Number, 
        message: String, 
        imageUrl: { type: String, default: "" },
        date: { type: Date, default: Date.now } 
    }]
});

const User = mongoose.model('User', UserSchema);

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
            paymentMethods: user.paymentMethods || {},
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

// Helper ส่งข้อมูลครบวงจรให้ Dashboard
function emitDashboardData(socket, user) {
    socket.emit('update_stats', user.stats);
    socket.emit('update_history', user.history);
    socket.emit('apply_page_settings', user.pageSettings);
    socket.emit('apply_payment', user.paymentMethods);
    socket.emit('apply_social', user.socialLinks || {});
    socket.emit('apply_banned_words', user.bannedWords || []);
    socket.emit('apply_security_settings', { widgetToken: user.widgetToken });
    
    // 1. ค่าเริ่มต้นของ Goal
    const goalData = (user.goalSettings && user.goalSettings.title) ? user.goalSettings : 
        { title: 'เป้าหมายโดเนท', target: 100, current: 0, barColor: '#0ea5e9', textColor: '#ffffff' };
    socket.emit('apply_goal', goalData);

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
    socket.emit('apply_settings', alertData);

    // 3. ค่าเริ่มต้นของ Top Donator
    const tdData = (user.topDonorSettings && user.topDonorSettings.title) ? user.topDonorSettings : 
        { title: '🏆 Top Donators', titleColor: '#5BC0EB', textColor: '#ffffff', boxColor: 'rgba(0, 0, 0, 0.6)', isTransparent: false, hasBorder: true, borderColor: '#3A86FF' };
    socket.emit('apply_top_donor', tdData);
    
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
        socket.join(decoded.username);

        const user = await User.findOne({ username: decoded.username });
        if (user) {
            emitDashboardData(socket, user);
            socket.emit('auth_success', { username: user.username });
        }
    });

    // 🟢 เชื่อมต่อสำหรับ OBS Widget (รองรับทั้ง secret token และ fallback username)
    socket.on('join_widget', async (param) => {
        let user = null;
        if (typeof param === 'object' && param.token) {
            user = await User.findOne({ widgetToken: param.token });
        } else if (typeof param === 'string') {
            user = await User.findOne({ $or: [{ widgetToken: param }, { username: param }] });
        }
        
        if (user) {
            socket.join(user.username);
            const alertData = (user.alertSettings && user.alertSettings.layout) ? user.alertSettings : 
                { layout: 'main', sound: 'boing', soundVol: 75, imgUrl: 'https://media.giphy.com/media/YaP3iYxN3T8nIEN5rD/giphy.gif', nameColor: '#f59e0b', amountColor: '#5BC0EB', textColor: '#ffffff' };
            socket.emit('apply_settings', alertData);

            const goalData = (user.goalSettings && user.goalSettings.title) ? user.goalSettings : 
                { title: 'เป้าหมายโดเนท', target: 100, current: 0, barColor: '#0ea5e9', textColor: '#ffffff' };
            socket.emit('apply_goal', goalData);

            const tdData = (user.topDonorSettings && user.topDonorSettings.title) ? user.topDonorSettings : 
                { title: '🏆 Top Donators', titleColor: '#5BC0EB', textColor: '#ffffff', boxColor: 'rgba(0, 0, 0, 0.6)', isTransparent: false };
            socket.emit('apply_top_donor', tdData);

            socket.emit('update_leaderboard', getTopDonators(user.history));
        }
    });

    // 🟢 หน้าโดเนทสาธารณะเชื่อมต่อเพื่อรับข้อมูลสตรีมเมอร์
    socket.on('join_profile', async (username) => {
        socket.join(username);
        const user = await User.findOne({ username });
        if (user) {
            if (user.pageSettings) socket.emit('apply_page_settings', user.pageSettings);
            if (user.paymentMethods) socket.emit('apply_payment', user.paymentMethods);
            if (user.socialLinks) socket.emit('apply_social', user.socialLinks);
            socket.emit('update_leaderboard', getTopDonators(user.history));
        }
    });

    // 🟢 ระบบบันทึกโดเนท + ตรวจคำหยาบ + จำกัดความยาว + รองรับรูปภาพ/GIF
    socket.on('new_donation', async (data) => {
        try {
            if (!data || !data.username) return;
            const user = await User.findOne({ username: data.username });
            if (!user) return socket.emit('donation_error', { message: 'ไม่พบสตรีมเมอร์' });

            const amount = parseFloat(data.amount);
            if (isNaN(amount) || amount <= 0) {
                return socket.emit('donation_rejected', { message: 'จำนวนเงินต้องมากกว่า 0 บาท' });
            }

            const name = (data.name || 'ผู้ไม่ประสงค์ออกนาม').trim().substring(0, 40);
            const maxLen = user.pageSettings?.maxMessageLength || 150;
            const message = (data.message || '').trim().substring(0, maxLen);

            // ตรวจสอบคำหยาบ (Profanity Filter)
            const bannedWords = user.bannedWords || [];
            const checkText = `${name} ${message}`.toLowerCase();
            const foundBanned = bannedWords.some(w => w && checkText.includes(w.toLowerCase().trim()));
            if (foundBanned) {
                return socket.emit('donation_rejected', { 
                    message: '⚠️ ขออภัยครับ ข้อความหรือชื่อของคุณมีคำที่ไม่เหมาะสม กรุณาแก้ไขก่อนทำรายการ' 
                });
            }

            // ตรวจสอบสิทธิ์การแนบรูปภาพ/GIF
            let imageUrl = '';
            if (data.imageUrl && typeof data.imageUrl === 'string') {
                const canUseImage = (user.pageSettings?.allowDonorImages !== false) && 
                                    (amount >= (user.pageSettings?.minAmountForImage || 0));
                if (canUseImage && (data.imageUrl.startsWith('http://') || data.imageUrl.startsWith('https://') || data.imageUrl.startsWith('data:image/'))) {
                    imageUrl = data.imageUrl.trim();
                }
            }

            const newDonation = { 
                name, 
                amount, 
                message, 
                imageUrl, 
                date: new Date() 
            };

            user.history.push(newDonation);
            user.stats.total += amount;
            user.stats.today += amount;
            
            // อัปเดตหลอด Goal
            if (user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = parseFloat(user.goalSettings.current) + amount;
                user.markModified('goalSettings');
            }

            await user.save();

            // แจ้งเตือน OBS Alert และหน้าเว็บแบบ Real-time
            io.to(data.username).emit('show_alert', newDonation); 
            io.to(data.username).emit('update_history', user.history);
            io.to(data.username).emit('update_stats', user.stats);
            io.to(data.username).emit('update_leaderboard', getTopDonators(user.history));
            if (user.goalSettings) io.to(data.username).emit('apply_goal', user.goalSettings);

            socket.emit('donation_success', { message: 'โดเนทสำเร็จเรียบร้อยแล้ว!' });
        } catch (err) {
            console.error("Donation processing error:", err);
            socket.emit('donation_error', { message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
        }
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
        io.to(data.username).emit('show_alert', testDonation);
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
        if (user && user.history && user.history[data.index] !== undefined) {
            const donationToDelete = user.history[data.index];
            
            user.stats.total -= donationToDelete.amount;
            user.stats.today -= donationToDelete.amount;
            if (user.stats.total < 0) user.stats.total = 0;
            if (user.stats.today < 0) user.stats.today = 0;

            if (user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = parseFloat(user.goalSettings.current) - donationToDelete.amount;
                if (user.goalSettings.current < 0) user.goalSettings.current = 0;
                user.markModified('goalSettings');
                io.to(data.username).emit('apply_goal', user.goalSettings);
            }

            user.history.splice(data.index, 1);
            await user.save();
            
            io.to(data.username).emit('update_history', user.history);
            io.to(data.username).emit('update_stats', user.stats);
            io.to(data.username).emit('update_leaderboard', getTopDonators(user.history));
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
            
            if (user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = 0;
                user.markModified('goalSettings');
                io.to(data.username).emit('apply_goal', user.goalSettings);
            }

            await user.save();
            io.to(data.username).emit('update_stats', user.stats);
            io.to(data.username).emit('update_history', user.history);
            io.to(data.username).emit('update_leaderboard', []);
        }
    });

    // 🟢 บันทึกการชำระเงิน
    socket.on('save_payment', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            if (!user.paymentMethods) user.paymentMethods = {};
            user.paymentMethods[data.type] = data.data; 
            user.markModified('paymentMethods'); 
            await user.save();
            io.to(data.username).emit('apply_payment', user.paymentMethods);
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
            io.to(data.username).emit('apply_page_settings', user.pageSettings);
        }
    });

    // 🟢 บันทึกโซเชียลมีเดีย
    socket.on('save_social', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.socialLinks = {
                youtube: data.youtube || "",
                facebook: data.facebook || "",
                twitch: data.twitch || ""
            };
            user.markModified('socialLinks');
            await user.save();
            io.to(data.username).emit('apply_social', user.socialLinks);
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
            user.goalSettings = data;
            user.markModified('goalSettings');
            await user.save();
            io.to(data.username).emit('apply_goal', user.goalSettings);
        }
    });

    // 🟢 บันทึกการตั้งค่า Alert (รูปแบบ, เสียง, สี, รูปภาพ)
    socket.on('update_alert', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.alertSettings = data;
            user.markModified('alertSettings');
            await user.save();
            io.to(data.username).emit('apply_settings', user.alertSettings);
        }
    });

    // 🟢 บันทึกการตั้งค่า Top Donator
    socket.on('update_top_donor', async (data) => {
        if (!await checkAuth(data)) return;
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.topDonorSettings = data;
            user.markModified('topDonorSettings');
            await user.save();
            io.to(data.username).emit('apply_top_donor', user.topDonorSettings);
        }
    });

});

// 📌 สั่งรันเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 OceanDonate Server running on port ${PORT}`);
});
