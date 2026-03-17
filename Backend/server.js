const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../Frontendd')));

// 📌 1. เชื่อมต่อฐานข้อมูล MongoDB (รองรับทั้งเครื่องเราและ Cloud)
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ocean_donate';
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// 📌 2. สร้าง Schema สำหรับเก็บข้อมูลผู้ใช้
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    stats: { today: { type: Number, default: 0 }, total: { type: Number, default: 0 }, views: { type: Number, default: 0 } },
    pageSettings: { bio: { type: String, default: "ยินดีต้อนรับสู่ช่องของฉัน!" }, thankMsg: { type: String, default: "ขอบคุณสำหรับการโดเนทครับ!" }, bgUrl: { type: String, default: "" } },
    paymentMethods: { type: Object, default: {} },
    goalSettings: { type: Object, default: {} },       // 🟢 พื้นที่เก็บข้อมูล Donate Goal
    alertSettings: { type: Object, default: {} },      // 🟢 พื้นที่เก็บข้อมูล Alert Box
    topDonorSettings: { type: Object, default: {} },   // 🟢 พื้นที่เก็บข้อมูล Top Donator
    history: [{ name: String, amount: Number, message: String, date: { type: Date, default: Date.now } }]
});

const User = mongoose.model('User', UserSchema);

// ฟังก์ชันคำนวณ Top Donators (5 อันดับแรก)
function getTopDonators(history) {
    const donors = {};
    history.forEach(h => {
        if(!donors[h.name]) donors[h.name] = 0;
        donors[h.name] += h.amount;
    });
    return Object.entries(donors)
        .map(([name, amount]) => ({name, amount}))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5); 
}

// 📌 3. API สมัครและเข้าสู่ระบบ
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existing = await User.findOne({ $or: [{ username }, { email }] });
        if (existing) return res.status(400).json({ message: 'มีคนใช้ชื่อหรืออีเมลนี้แล้ว' });

        const newUser = new User({ username, email, password });
        await newUser.save();
        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ!' });
    } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) res.json({ success: true, username: user.username });
    else res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
});

app.get('/api/streamers', async (req, res) => {
    const users = await User.find({}, 'username pageSettings.bio');
    res.json(users);
});

// 📌 4. ระบบ Socket.io แบบครบวงจรสำหรับทุก Widget
io.on('connection', (socket) => {
    console.log('🔗 A user connected');

    socket.on('join_profile', async (username) => {
        socket.join(username);
        const user = await User.findOne({ username });
        if (user) {
            socket.emit('update_stats', user.stats);
            socket.emit('update_history', user.history);
            if (user.pageSettings) socket.emit('apply_page_settings', user.pageSettings);
            if (user.paymentMethods) socket.emit('apply_payment', user.paymentMethods);
            
            // 🟢 เพิ่มความฉลาด: ถ้ายังไม่มีข้อมูล ให้ส่ง "ค่าเริ่มต้น" ไปให้ OBS แทน (แก้ปัญหา undefined)
            
            // 1. ค่าเริ่มต้นของ Goal
            const goalData = (user.goalSettings && user.goalSettings.title) ? user.goalSettings : 
                { title: 'เป้าหมายโดเนท', target: 100, current: 0, barColor: '#ff0000', textColor: '#ffffff' };
            socket.emit('apply_goal', goalData);

            // 2. ค่าเริ่มต้นของ Alert
            const alertData = (user.alertSettings && user.alertSettings.layout) ? user.alertSettings : 
                { layout: 'main', sound: '', nameColor: '#3A86FF', amountColor: '#10b981', textColor: '#ffffff' };
            socket.emit('apply_settings', alertData);

            // 3. ค่าเริ่มต้นของ Top Donator
            const tdData = (user.topDonorSettings && user.topDonorSettings.title) ? user.topDonorSettings : 
                { title: 'Top Donator', titleColor: '#f5a623', textColor: '#ffffff', boxColor: '#050811', isTransparent: false };
            socket.emit('apply_top_donor', tdData);
            
            // ส่งตารางอันดับ
            socket.emit('update_leaderboard', getTopDonators(user.history));
        }
    });
    // 🟢 ระบบบันทึกโดเนท + อัปเดตวิดเจ็ตอัตโนมัติ
    socket.on('new_donation', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            const newDonation = { name: data.name, amount: data.amount, message: data.message, date: new Date() };
            user.history.push(newDonation);
            user.stats.total += data.amount;
            user.stats.today += data.amount;
            
            // อัปเดตหลอด Goal อัตโนมัติเวลาคนโดเนท
            if(user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = parseFloat(user.goalSettings.current) + data.amount;
                user.markModified('goalSettings');
            }

            await user.save();

            // สั่งเด้ง Alert, อัปเดต Goal, และอัปเดต Top Donor แบบ Real-time
            io.to(data.username).emit('show_alert', newDonation); 
            io.to(data.username).emit('update_history', user.history);
            io.to(data.username).emit('update_stats', user.stats);
            io.to(data.username).emit('update_leaderboard', getTopDonators(user.history));
            if(user.goalSettings) io.to(data.username).emit('apply_goal', user.goalSettings); 
        }
    });

    //// 🟢 ระบบลบประวัติโดเนท (ท่าไม้ตาย: ลบด้วยตำแหน่งลำดับ Index แม่นยำ 100%)
    socket.on('delete_donation', async (data) => {
        const user = await User.findOne({ username: data.username });
        // เช็คว่ามีข้อมูลผู้ใช้ และตำแหน่งลำดับ (index) ที่ส่งมามีข้อมูลอยู่จริง
        if (user && user.history && user.history[data.index] !== undefined) {
            const donationToDelete = user.history[data.index];
            
            // หักยอดเงิน
            user.stats.total -= donationToDelete.amount;
            user.stats.today -= donationToDelete.amount;
            if (user.stats.total < 0) user.stats.total = 0;
            if (user.stats.today < 0) user.stats.today = 0;

            // หักยอดออกจากหลอด Goal
            if(user.goalSettings && user.goalSettings.current !== undefined) {
                user.goalSettings.current = parseFloat(user.goalSettings.current) - donationToDelete.amount;
                if(user.goalSettings.current < 0) user.goalSettings.current = 0;
                user.markModified('goalSettings');
                io.to(data.username).emit('apply_goal', user.goalSettings);
            }

            // ลบข้อมูลออกจากตาราง (ลบ 1 ตัว ที่ตำแหน่ง data.index)
            user.history.splice(data.index, 1);
            
            await user.save();
            
            // ส่งข้อมูลอัปเดตกลับไปให้หน้าเว็บ
            io.to(data.username).emit('update_history', user.history);
            io.to(data.username).emit('update_stats', user.stats);
            io.to(data.username).emit('update_leaderboard', getTopDonators(user.history));
        }
    });
    // รีเซ็ตข้อมูลทั้งหมด
    socket.on('reset_stats', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.stats.today = 0;
            user.stats.total = 0;
            user.history = []; 
            
            // รีเซ็ตหลอด Goal กลับไปเป็น 0 ด้วย
            if(user.goalSettings && user.goalSettings.current !== undefined) {
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

    socket.on('save_payment', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            if (!user.paymentMethods) user.paymentMethods = {};
            user.paymentMethods[data.type] = data.data; 
            user.markModified('paymentMethods'); 
            await user.save();
            io.to(data.username).emit('apply_payment', user.paymentMethods);
        }
    });

    socket.on('save_page_settings', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            if (!user.pageSettings) user.pageSettings = {};
            if (data.bio !== undefined) user.pageSettings.bio = data.bio;
            if (data.bgUrl !== undefined) user.pageSettings.bgUrl = data.bgUrl; 
            await user.save();
            io.to(data.username).emit('apply_page_settings', user.pageSettings);
        }
    });

    // 🟢 ระบบบันทึกการตั้งค่าวิดเจ็ตลง Database
    socket.on('update_goal', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.goalSettings = data;
            user.markModified('goalSettings');
            await user.save();
            io.to(data.username).emit('apply_goal', user.goalSettings);
        }
    });

    socket.on('update_alert', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.alertSettings = data;
            user.markModified('alertSettings');
            await user.save();
            io.to(data.username).emit('apply_settings', user.alertSettings);
        }
    });

    socket.on('update_top_donor', async (data) => {
        const user = await User.findOne({ username: data.username });
        if (user) {
            user.topDonorSettings = data;
            user.markModified('topDonorSettings');
            await user.save();
            io.to(data.username).emit('apply_top_donor', user.topDonorSettings);
        }
    });

});

// 📌 สั่งรันเซิร์ฟเวอร์ (รองรับ Port อัตโนมัติจาก Render)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});